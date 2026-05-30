"""
Parser v3 schema regression tests — gated behind `pytest -m db` (nightly).

Pins the contract of the four tables introduced by
`supabase/migrations/20260503000008_parser_v3_schema.sql`:

    parse_runs      — run-level state machine
    parse_pages     — per-slide checkpoint
    slide_chunks    — grounded-tutor retrieval store (pgvector)
    tutor_messages  — tutor conversation log

The point of this test module is to make any future migration that drops a
column, weakens an RLS policy, or changes the embedding dimension fail loudly
in CI rather than silently in production.
"""
from __future__ import annotations

import psycopg
import pytest

pytestmark = pytest.mark.db


V3_TABLES = ("parse_runs", "parse_pages", "slide_chunks", "tutor_messages")


# ── Existence + RLS ─────────────────────────────────────────────────────────


def test_v3_tables_exist(db_conn):
    """All four parser v3 tables must be present in the public schema."""
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.relname
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relkind = 'r'
               AND c.relname = ANY(%s)
            """,
            (list(V3_TABLES),),
        )
        present = {row[0] for row in cur.fetchall()}
    missing = set(V3_TABLES) - present
    assert not missing, f"parser v3 tables missing from public schema: {missing!r}"


def test_v3_tables_have_rls_enabled(db_conn):
    """
    RLS must be enabled on every v3 table. The defense-in-depth check in
    test_rls_policies.test_all_public_tables_have_rls_enabled would also
    catch this, but pinning it here makes the v3 contract explicit.
    """
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.relname, c.relrowsecurity
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relname = ANY(%s)
            """,
            (list(V3_TABLES),),
        )
        rls_state = dict(cur.fetchall())
    for table in V3_TABLES:
        assert rls_state.get(table) is True, (
            f"RLS not enabled on public.{table} — backend-only invariant violated"
        )


# ── pgvector + embedding dimension ─────────────────────────────────────────


def test_pgvector_extension_installed(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
        assert cur.fetchone() is not None, (
            "vector extension missing — the v3 schema migration's "
            "CREATE EXTENSION IF NOT EXISTS vector did not take effect"
        )


def test_slide_chunks_embedding_is_384d(db_conn):
    """
    The grounded tutor uses FastEmbed bge-small-en-v1.5 (384-d). If this
    dimension changes, every existing embedding becomes unusable, so it
    must be a deliberate schema change — not an accident.
    """
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT format_type(a.atttypid, a.atttypmod)
              FROM pg_attribute a
              JOIN pg_class c     ON c.oid = a.attrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relname = 'slide_chunks'
               AND a.attname = 'embedding'
               AND a.attnum > 0
               AND NOT a.attisdropped
            """
        )
        row = cur.fetchone()
    assert row is not None, "slide_chunks.embedding column not found"
    assert row[0] == "vector(384)", (
        f"slide_chunks.embedding is {row[0]!r}, expected vector(384). "
        "Changing the dimension invalidates every stored embedding."
    )


def test_slide_chunks_ivfflat_index_present(db_conn):
    """The IVFFlat cosine index is the production retrieval path."""
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT indexdef
              FROM pg_indexes
             WHERE schemaname = 'public'
               AND tablename = 'slide_chunks'
               AND indexname = 'idx_slide_chunks_vec'
            """
        )
        row = cur.fetchone()
    assert row is not None, "idx_slide_chunks_vec missing"
    indexdef = row[0].lower()
    assert "ivfflat" in indexdef and "vector_cosine_ops" in indexdef, (
        f"idx_slide_chunks_vec is not an IVFFlat cosine index: {indexdef!r}"
    )


# ── parse_runs uniqueness contract ─────────────────────────────────────────


def test_parse_runs_unique_pdf_hash_pipeline_version(db_conn, make_user, make_lecture):
    """
    UNIQUE (pdf_hash, pipeline_version) is what makes a pipeline_version bump
    invalidate every cached run for free. A duplicate insert at the same
    version must raise UniqueViolation.
    """
    professor = make_user(role="professor")
    lecture = make_lecture(professor)
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.parse_runs (pdf_hash, lecture_id, pipeline_version, status)
            VALUES (%s, %s, %s, %s)
            """,
            ("abc123", str(lecture), "3", "queued"),
        )
        with pytest.raises(psycopg.errors.UniqueViolation):
            cur.execute(
                """
                INSERT INTO public.parse_runs (pdf_hash, lecture_id, pipeline_version, status)
                VALUES (%s, %s, %s, %s)
                """,
                ("abc123", str(lecture), "3", "queued"),
            )


def test_parse_runs_allows_new_row_on_pipeline_version_bump(
    db_conn, make_user, make_lecture
):
    """Same pdf_hash + different pipeline_version is allowed (free invalidation)."""
    professor = make_user(role="professor")
    lecture = make_lecture(professor)
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.parse_runs (pdf_hash, lecture_id, pipeline_version, status)
            VALUES (%s, %s, %s, %s)
            """,
            ("dup-hash", str(lecture), "3", "completed"),
        )
        # Different version → must succeed.
        cur.execute(
            """
            INSERT INTO public.parse_runs (pdf_hash, lecture_id, pipeline_version, status)
            VALUES (%s, %s, %s, %s)
            """,
            ("dup-hash", str(lecture), "4", "queued"),
        )
        cur.execute(
            "SELECT count(*) FROM public.parse_runs WHERE pdf_hash = %s",
            ("dup-hash",),
        )
        assert cur.fetchone()[0] == 2


# ── Cascade contract ────────────────────────────────────────────────────────


def test_parse_pages_cascades_from_parse_runs(db_conn, make_user, make_lecture):
    """Deleting a parse_runs row removes its parse_pages — required for resume cleanup."""
    professor = make_user(role="professor")
    lecture = make_lecture(professor)
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.parse_runs (pdf_hash, lecture_id, pipeline_version, status)
            VALUES (%s, %s, %s, %s)
            RETURNING run_id
            """,
            ("cascade-hash", str(lecture), "3", "queued"),
        )
        run_id = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO public.parse_pages (run_id, page_index, status)
            VALUES (%s, %s, %s)
            """,
            (str(run_id), 0, "pending"),
        )
        cur.execute("DELETE FROM public.parse_runs WHERE run_id = %s", (str(run_id),))
        cur.execute(
            "SELECT count(*) FROM public.parse_pages WHERE run_id = %s",
            (str(run_id),),
        )
        assert cur.fetchone()[0] == 0


def test_slide_chunks_cascades_from_lecture(db_conn, make_user, make_lecture):
    """Deleting a lecture removes its slide_chunks (no orphan retrieval rows)."""
    professor = make_user(role="professor")
    lecture = make_lecture(professor)
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.slide_chunks
                (lecture_id, page_index, chunk_index, text, pipeline_version)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (str(lecture), 0, 0, "hello world", "3"),
        )
        cur.execute("DELETE FROM public.lectures WHERE id = %s", (str(lecture),))
        cur.execute(
            "SELECT count(*) FROM public.slide_chunks WHERE lecture_id = %s",
            (str(lecture),),
        )
        assert cur.fetchone()[0] == 0


# ── tutor_messages role + per-student RLS ──────────────────────────────────


def test_tutor_messages_role_check(db_conn, make_user, make_lecture):
    """role must be 'student' or 'tutor' — anything else raises CheckViolation."""
    professor = make_user(role="professor")
    student = make_user(role="student")
    lecture = make_lecture(professor)
    with db_conn.cursor() as cur:
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute(
                """
                INSERT INTO public.tutor_messages (lecture_id, user_id, role, content)
                VALUES (%s, %s, %s, %s)
                """,
                (str(lecture), str(student), "professor", "hi"),
            )


def test_tutor_messages_student_cannot_read_other_students(
    db_conn, make_user, make_lecture
):
    """
    Per-student RLS: a student must only see their own tutor_messages rows.
    The policy is `auth.uid() = user_id`. A leak here would expose private
    tutor conversations across students.
    """
    professor = make_user(role="professor")
    student_a = make_user(role="student")
    student_b = make_user(role="student")
    lecture = make_lecture(professor)

    with db_conn.cursor() as cur:
        # Seed as superuser (bypasses RLS).
        cur.execute(
            """
            INSERT INTO public.tutor_messages
                (lecture_id, user_id, role, content)
            VALUES
                (%s, %s, 'student', 'A asks'),
                (%s, %s, 'student', 'B asks')
            """,
            (str(lecture), str(student_a), str(lecture), str(student_b)),
        )

        cur.execute("SET ROLE authenticated")
        cur.execute(
            "SELECT set_config('request.jwt.claim.sub', %s, false)", (str(student_a),)
        )
        cur.execute(
            "SELECT set_config('request.jwt.claim.role', %s, false)",
            ("authenticated",),
        )
        try:
            cur.execute("SELECT user_id FROM public.tutor_messages")
            visible = {row[0] for row in cur.fetchall()}
        finally:
            cur.execute("RESET ROLE")
            cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
            cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")

    assert student_a in visible, (
        f"student {student_a} cannot see their own tutor messages"
    )
    assert student_b not in visible, (
        f"RLS leak: student {student_a} can see student {student_b}'s tutor messages"
    )


def _set_authenticated(cur, uid):
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute(
        "SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",)
    )


def _reset_role(cur):
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def test_tutor_messages_student_can_insert_own_student_row(
    db_conn, make_user, make_lecture
):
    """
    Positive case: the INSERT policy must ALLOW a student posting their own
    'student'-role message. Without this, the chat UI's optimistic insert
    path would always 403.
    """
    professor = make_user(role="professor")
    student = make_user(role="student")
    lecture = make_lecture(professor)

    with db_conn.cursor() as cur:
        _set_authenticated(cur, student)
        try:
            cur.execute(
                """
                INSERT INTO public.tutor_messages
                    (lecture_id, user_id, role, content)
                VALUES (%s, %s, 'student', 'why is k-NN slow on big N?')
                RETURNING id
                """,
                (str(lecture), str(student)),
            )
            new_id = cur.fetchone()[0]
            assert new_id is not None
        finally:
            _reset_role(cur)


def test_tutor_messages_student_cannot_insert_as_tutor(
    db_conn, make_user, make_lecture
):
    """
    The INSERT policy requires role='student'. A student trying to inject
    a tutor-authored message must be rejected so they can't fabricate
    fake citations.
    """
    professor = make_user(role="professor")
    student = make_user(role="student")
    lecture = make_lecture(professor)

    with db_conn.cursor() as cur:
        _set_authenticated(cur, student)
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(
                    """
                    INSERT INTO public.tutor_messages
                        (lecture_id, user_id, role, content)
                    VALUES (%s, %s, 'tutor', 'fake answer')
                    """,
                    (str(lecture), str(student)),
                )
        finally:
            _reset_role(cur)


def test_tutor_messages_student_cannot_insert_for_another_user(
    db_conn, make_user, make_lecture
):
    """
    Closely related leak: even with role='student', a student must not be
    able to write a message under another user's user_id (the policy's
    `auth.uid() = user_id` clause). This pins the cross-user write boundary.
    """
    professor = make_user(role="professor")
    student_a = make_user(role="student")
    student_b = make_user(role="student")
    lecture = make_lecture(professor)

    with db_conn.cursor() as cur:
        _set_authenticated(cur, student_a)
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(
                    """
                    INSERT INTO public.tutor_messages
                        (lecture_id, user_id, role, content)
                    VALUES (%s, %s, 'student', 'impersonating B')
                    """,
                    (str(lecture), str(student_b)),
                )
        finally:
            _reset_role(cur)
