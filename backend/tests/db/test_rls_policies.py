"""
DB / RLS regression tests — gated behind `pytest -m db` (nightly).

These confirm the security-critical invariants we rely on across the codebase:
  - Migrations apply cleanly in lexicographic order (incl. all the late
    fix-* migrations from May 2026).
  - Every `public` table has RLS enabled (catches a future migration that
    forgets `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, which would
    otherwise be silently world-writable to authenticated users).
  - user_roles inserts are locked down — only the SECURITY DEFINER signup
    trigger may write, even from the `authenticated` role.
  - has_role() returns the documented boolean for known role keys.
  - Cross-tenant isolation: Professor A cannot UPDATE/DELETE Professor B's
    lectures (the SELECT side is intentionally public — students browse
    the catalog); Student A cannot SELECT Student B's progress.
  - Lecture deletes cascade to slides / quiz_questions / student_progress.
  - student_progress (user_id, lecture_id) UNIQUE is enforced.
  - Out-of-band cache tables (pdf_parse_cache) have the documented permissive
    policy — this is a known wart and the test exists so a future tightening
    is explicit and detectable.
"""
from __future__ import annotations

import psycopg
import pytest

pytestmark = pytest.mark.db


# ── Migration sanity ────────────────────────────────────────────────────────


def test_migrations_apply_cleanly(applied_migrations):
    assert len(applied_migrations) > 0
    assert all(p.suffix == ".sql" for p in applied_migrations)


# ── Defense-in-depth: every public table must have RLS enabled ──────────────


# Tables created by the bootstrap that intentionally model out-of-band
# cache state. These are documented as permissive in
# 20260501000001_fix_cache_rls.sql; the dedicated
# `test_pdf_parse_cache_documented_permissive_policy` test pins that wart.
# We still REQUIRE rowsecurity=true on them (the cache_rls migration enables
# it), so they aren't actually exempt — they pass the rls_enabled check.
# This list exists only as documentation for future maintainers.
_KNOWN_PERMISSIVE_TABLES = {"pdf_parse_cache", "slide_embeddings"}


def test_all_public_tables_have_rls_enabled(db_conn, applied_migrations):
    """
    Catch the failure mode where a future migration creates a new table in
    `public` but forgets `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. With
    Supabase's default grants on `public`, an RLS-disabled table is wide
    open to any authenticated user.
    """
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.relname
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relkind = 'r'
               AND c.relrowsecurity = false
             ORDER BY c.relname
            """
        )
        unprotected = [row[0] for row in cur.fetchall()]
    assert not unprotected, (
        "These public tables ship without RLS enabled, which would expose "
        "them to every authenticated user via Supabase's default grants. "
        f"Add `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in a migration: "
        f"{unprotected!r}"
    )


# ── user_roles lockdown (the May 2026 hardening) ────────────────────────────


def test_user_roles_insert_locked_down_anon(db_conn):
    """anon must never be able to write to user_roles."""
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(
                    "INSERT INTO public.user_roles (user_id, role) "
                    "VALUES (gen_random_uuid(), 'student')"
                )
        finally:
            cur.execute("RESET ROLE")


def test_user_roles_insert_locked_down_authenticated(db_conn, make_user):
    """
    authenticated users cannot insert into user_roles either — the
    'No client writes to user_roles' policy in 20260502000003 must
    short-circuit even when the user supplies their own auth.uid().
    """
    uid = make_user(role="student")
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE authenticated")
        cur.execute(
            "SELECT set_config('request.jwt.claim.sub', %s, true)", (str(uid),)
        )
        try:
            with pytest.raises(
                (psycopg.errors.InsufficientPrivilege, psycopg.errors.RaiseException)
            ):
                cur.execute(
                    "INSERT INTO public.user_roles (user_id, role) "
                    "VALUES (%s, 'professor')",
                    (str(uid),),
                )
        finally:
            cur.execute("RESET ROLE")


def test_signup_trigger_assigns_role_from_metadata(db_conn, make_user):
    """The SECURITY DEFINER trigger must still create the role row."""
    uid = make_user(role="professor")
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT role::text FROM public.user_roles WHERE user_id = %s",
            (str(uid),),
        )
        roles = [r[0] for r in cur.fetchall()]
    assert "professor" in roles, f"trigger did not insert role row, got {roles!r}"


# ── has_role() ──────────────────────────────────────────────────────────────


def test_has_role_function_returns_false_for_unknown_user(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT public.has_role(gen_random_uuid(), 'student')")
        assert cur.fetchone()[0] is False


def test_has_role_function_returns_true_for_assigned_role(db_conn, make_user):
    uid = make_user(role="professor")
    with db_conn.cursor() as cur:
        cur.execute("SELECT public.has_role(%s, 'professor')", (str(uid),))
        assert cur.fetchone()[0] is True
        cur.execute("SELECT public.has_role(%s, 'student')", (str(uid),))
        assert cur.fetchone()[0] is False


# ── Cascading deletes ───────────────────────────────────────────────────────


def test_lecture_delete_cascades(
    db_conn, make_user, make_lecture, make_slide, make_quiz, make_progress
):
    """
    Deleting a lecture must cascade to slides, quiz_questions, and
    student_progress. These FKs back the assumption made all over the
    professor-side analytics code that no orphan rows exist.
    """
    professor = make_user(role="professor")
    student = make_user(role="student")
    lecture = make_lecture(professor)
    slide = make_slide(lecture, slide_number=1)
    quiz = make_quiz(slide)
    progress = make_progress(student, lecture)

    # Sanity: rows exist before delete.
    with db_conn.cursor() as cur:
        for table, row_id in (
            ("slides", slide),
            ("quiz_questions", quiz),
            ("student_progress", progress),
        ):
            cur.execute(f"SELECT 1 FROM public.{table} WHERE id = %s", (str(row_id),))
            assert cur.fetchone() is not None, f"{table} fixture row missing"

        cur.execute("DELETE FROM public.lectures WHERE id = %s", (str(lecture),))

        for table, row_id in (
            ("slides", slide),
            ("quiz_questions", quiz),
            ("student_progress", progress),
        ):
            cur.execute(f"SELECT 1 FROM public.{table} WHERE id = %s", (str(row_id),))
            assert (
                cur.fetchone() is None
            ), f"{table}.id={row_id} survived parent lecture delete"


# ── Cross-tenant isolation (the central RLS contract) ──────────────────────


def _as_user(cur, uid):
    """
    Switch the current cursor to act as `authenticated` with auth.uid()=uid.

    NOTE on the third arg to `set_config`: we pass `false` (session-scoped),
    not `true` (transaction-scoped). With autocommit each statement runs in
    its own transaction, so transaction-scoped GUCs would vanish before the
    next statement and `auth.uid()` would return NULL. Session scope is
    safe because `db_conn` is per-test (function fixture) — a fresh
    connection per test prevents cross-test bleed.
    """
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute(
        "SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",)
    )


def _reset_user(cur):
    """Undo `_as_user` — drop the role and clear the JWT-claim GUCs."""
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def test_professor_cannot_modify_other_professors_lectures(
    db_conn, make_user, make_lecture
):
    """
    The 'Anyone can view lectures' SELECT policy is intentional (students
    browse the lecture catalog), but the UPDATE / DELETE policies must
    restrict mutation to the owning professor. A leak here would let any
    professor rewrite or destroy a colleague's lecture.
    """
    prof_a = make_user(role="professor")
    prof_b = make_user(role="professor")
    lec_b = make_lecture(prof_b, title="B's lecture")

    with db_conn.cursor() as cur:
        _as_user(cur, prof_a)
        try:
            # UPDATE: a row that doesn't satisfy the policy is invisible to
            # the predicate, so UPDATE silently affects 0 rows.
            cur.execute(
                "UPDATE public.lectures SET title = 'pwned' WHERE id = %s",
                (str(lec_b),),
            )
            assert cur.rowcount == 0, (
                f"RLS leak: professor {prof_a} updated professor {prof_b}'s "
                f"lecture {lec_b} (rowcount={cur.rowcount})"
            )

            # DELETE: same — 0 rows deleted.
            cur.execute("DELETE FROM public.lectures WHERE id = %s", (str(lec_b),))
            assert cur.rowcount == 0, (
                f"RLS leak: professor {prof_a} deleted professor {prof_b}'s "
                f"lecture {lec_b} (rowcount={cur.rowcount})"
            )
        finally:
            _reset_user(cur)

    # Sanity: verify B's lecture is still intact when read as superuser.
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT title FROM public.lectures WHERE id = %s", (str(lec_b),)
        )
        row = cur.fetchone()
    assert row is not None and row[0] == "B's lecture", (
        f"professor B's lecture was modified or deleted: {row!r}"
    )


def test_student_cannot_see_other_students_progress(
    db_conn, make_user, make_lecture, make_progress
):
    """
    Each student must only see their own student_progress rows. A leak
    here would expose XP, completion state, and study patterns of every
    other student in the system. The policy is `auth.uid() = user_id`.
    """
    professor = make_user(role="professor")
    student_a = make_user(role="student")
    student_b = make_user(role="student")
    lecture = make_lecture(professor)

    progress_a = make_progress(student_a, lecture, xp=42)
    progress_b = make_progress(student_b, lecture, xp=99)

    with db_conn.cursor() as cur:
        _as_user(cur, student_a)
        try:
            cur.execute("SELECT id FROM public.student_progress")
            visible = {row[0] for row in cur.fetchall()}
        finally:
            _reset_user(cur)

    assert progress_a in visible, (
        f"student {student_a} cannot see their own progress row {progress_a}"
    )
    assert progress_b not in visible, (
        f"RLS leak: student {student_a} can see student {student_b}'s "
        f"progress row {progress_b}"
    )


# ── student_progress uniqueness ─────────────────────────────────────────────


def test_student_progress_unique(db_conn, make_user, make_lecture, make_progress):
    """A given (user_id, lecture_id) pair may have at most one progress row."""
    professor = make_user(role="professor")
    student = make_user(role="student")
    lecture = make_lecture(professor)

    make_progress(student, lecture, xp=5)

    with pytest.raises(psycopg.errors.UniqueViolation):
        make_progress(student, lecture, xp=99)


# ── Out-of-band cache tables ────────────────────────────────────────────────


def test_pdf_parse_cache_documented_permissive_policy(db_conn):
    """
    pdf_parse_cache currently ships with a permissive RLS policy
    (see 20260501000001_fix_cache_rls.sql) because the backend used
    the anon key for cache writes. This test pins that documented
    behavior so any future tightening is explicit and intentional.
    If/when SUPABASE_SERVICE_ROLE_KEY becomes mandatory we can flip
    this assertion and add a separate "anon is blocked" test.
    """
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            cur.execute(
                "INSERT INTO public.pdf_parse_cache (pdf_hash, slides) "
                "VALUES (%s, %s::jsonb)",
                ("test-hash", "[]"),
            )
            cur.execute(
                "SELECT 1 FROM public.pdf_parse_cache WHERE pdf_hash = %s",
                ("test-hash",),
            )
            assert cur.fetchone() is not None
        finally:
            cur.execute("RESET ROLE")
            cur.execute("DELETE FROM public.pdf_parse_cache WHERE pdf_hash = %s", ("test-hash",))
