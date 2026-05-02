"""
DB / RLS regression tests for the weekly-assignments feature
(`20260503000009_assignments.sql`).

Gated behind the `db` marker so it runs nightly with the rest of the
RLS suite. These tests boot a real Postgres via testcontainers, apply
every migration, and assert visibility/mutation rules at the policy
layer — not just at the FastAPI layer.

Invariants checked:
  - Professor A cannot read or write Professor B's assignments / lectures /
    enrollments.
  - An UNenrolled student sees zero assignments and cannot SELECT the
    assignment_lectures join rows for them.
  - A newly enrolled student (no progress yet) sees the assignment
    immediately — this is the regression test for the "engagement proxy"
    visibility bug.
  - A student cannot enroll themselves into an assignment.
  - assignment_enrollments is keyed (assignment_id, user_id) — duplicate
    enrollment is rejected.
  - Cascading delete: removing an assignment removes its lectures /
    enrollments join rows.
"""
from __future__ import annotations

import uuid

import psycopg
import pytest

pytestmark = pytest.mark.db


# ── Local helpers (mirror the patterns in test_rls_policies.py) ────────────

def _as_user(cur, uid: uuid.UUID) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute(
        "SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",)
    )


def _reset_user(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def _mk_assignment(cur, professor_id: uuid.UUID, title: str = "A") -> uuid.UUID:
    aid = uuid.uuid4()
    cur.execute(
        """
        INSERT INTO public.assignments
            (id, professor_id, title, due_at)
        VALUES (%s, %s, %s, now() + interval '7 days')
        """,
        (str(aid), str(professor_id), title),
    )
    return aid


def _enroll(cur, assignment_id: uuid.UUID, user_id: uuid.UUID) -> None:
    cur.execute(
        """
        INSERT INTO public.assignment_enrollments (assignment_id, user_id)
        VALUES (%s, %s)
        """,
        (str(assignment_id), str(user_id)),
    )


def _link_lecture(cur, assignment_id: uuid.UUID, lecture_id: uuid.UUID) -> None:
    cur.execute(
        """
        INSERT INTO public.assignment_lectures (assignment_id, lecture_id)
        VALUES (%s, %s)
        """,
        (str(assignment_id), str(lecture_id)),
    )


# ── Cross-professor isolation ──────────────────────────────────────────────

def test_professor_cannot_read_or_modify_other_professors_assignment(
    db_conn, make_user, make_lecture
):
    prof_a = make_user(role="professor")
    prof_b = make_user(role="professor")
    lec_b = make_lecture(prof_b)

    with db_conn.cursor() as cur:
        aid = _mk_assignment(cur, prof_b, title="B's homework")
        _link_lecture(cur, aid, lec_b)

        _as_user(cur, prof_a)
        try:
            # SELECT: professor A is not the owner and is not enrolled, so
            # they must see zero rows for B's assignment.
            cur.execute("SELECT id FROM public.assignments WHERE id = %s", (str(aid),))
            assert cur.fetchall() == [], "professor A leaked B's assignment"

            # UPDATE: silently affects 0 rows under RLS.
            cur.execute(
                "UPDATE public.assignments SET title = 'pwned' WHERE id = %s",
                (str(aid),),
            )
            assert cur.rowcount == 0

            # DELETE: same.
            cur.execute("DELETE FROM public.assignments WHERE id = %s", (str(aid),))
            assert cur.rowcount == 0
        finally:
            _reset_user(cur)

    # Confirm B's assignment is intact.
    with db_conn.cursor() as cur:
        cur.execute("SELECT title FROM public.assignments WHERE id = %s", (str(aid),))
        row = cur.fetchone()
    assert row == ("B's homework",)


# ── Student visibility: unenrolled vs newly enrolled ───────────────────────

def test_unenrolled_student_cannot_see_assignment(
    db_conn, make_user, make_lecture
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)

    with db_conn.cursor() as cur:
        aid = _mk_assignment(cur, prof)
        _link_lecture(cur, aid, lec)

        _as_user(cur, student)
        try:
            cur.execute("SELECT id FROM public.assignments WHERE id = %s", (str(aid),))
            assert cur.fetchall() == [], (
                "RLS leak: unenrolled student saw an assignment"
            )
            cur.execute(
                "SELECT 1 FROM public.assignment_lectures WHERE assignment_id = %s",
                (str(aid),),
            )
            assert cur.fetchall() == [], (
                "RLS leak: unenrolled student saw an assignment_lectures row"
            )
        finally:
            _reset_user(cur)


def test_newly_enrolled_student_sees_assignment_with_no_progress(
    db_conn, make_user, make_lecture
):
    """
    Regression test for the previous engagement-proxy bug: an enrolled
    student with zero student_progress rows must still see the assignment.
    """
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)

    with db_conn.cursor() as cur:
        aid = _mk_assignment(cur, prof)
        _link_lecture(cur, aid, lec)
        _enroll(cur, aid, student)

        _as_user(cur, student)
        try:
            cur.execute(
                "SELECT id FROM public.assignments WHERE id = %s", (str(aid),)
            )
            visible = [row[0] for row in cur.fetchall()]
            assert visible == [aid], (
                f"newly enrolled student should see the assignment, "
                f"got {visible!r}"
            )
            cur.execute(
                "SELECT lecture_id FROM public.assignment_lectures "
                "WHERE assignment_id = %s",
                (str(aid),),
            )
            assert cur.fetchall() == [(lec,)]
        finally:
            _reset_user(cur)


def test_student_cannot_enroll_themselves(db_conn, make_user):
    """
    Roster management is professor-only — a student must not be able to
    insert their own enrollment row.
    """
    prof = make_user(role="professor")
    student = make_user(role="student")

    with db_conn.cursor() as cur:
        aid = _mk_assignment(cur, prof)

        _as_user(cur, student)
        try:
            with pytest.raises(
                (
                    psycopg.errors.InsufficientPrivilege,
                    psycopg.errors.RaiseException,
                    psycopg.errors.CheckViolation,
                )
            ):
                cur.execute(
                    "INSERT INTO public.assignment_enrollments "
                    "(assignment_id, user_id) VALUES (%s, %s)",
                    (str(aid), str(student)),
                )
        finally:
            _reset_user(cur)


# ── Mutation rules ─────────────────────────────────────────────────────────

def test_enrollment_pkey_blocks_duplicates(db_conn, make_user):
    prof = make_user(role="professor")
    student = make_user(role="student")
    with db_conn.cursor() as cur:
        aid = _mk_assignment(cur, prof)
        _enroll(cur, aid, student)
        with pytest.raises(psycopg.errors.UniqueViolation):
            _enroll(cur, aid, student)


def test_assignment_delete_cascades(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)
    with db_conn.cursor() as cur:
        aid = _mk_assignment(cur, prof)
        _link_lecture(cur, aid, lec)
        _enroll(cur, aid, student)

        cur.execute("DELETE FROM public.assignments WHERE id = %s", (str(aid),))
        assert cur.rowcount == 1

        cur.execute(
            "SELECT 1 FROM public.assignment_lectures WHERE assignment_id = %s",
            (str(aid),),
        )
        assert cur.fetchone() is None
        cur.execute(
            "SELECT 1 FROM public.assignment_enrollments WHERE assignment_id = %s",
            (str(aid),),
        )
        assert cur.fetchone() is None


def test_assignment_lectures_rejects_other_professors_lecture(
    db_conn, make_user, make_lecture
):
    """
    Defense-in-depth trigger: even if a professor satisfies the
    `assignment_lectures` INSERT policy (parent assignment is theirs),
    the trigger must block linking a lecture owned by a different
    professor.
    """
    prof_a = make_user(role="professor")
    prof_b = make_user(role="professor")
    lec_b = make_lecture(prof_b)
    with db_conn.cursor() as cur:
        aid = _mk_assignment(cur, prof_a)
        with pytest.raises(psycopg.errors.CheckViolation):
            _link_lecture(cur, aid, lec_b)


def test_min_quiz_score_check_constraint(db_conn, make_user):
    prof = make_user(role="professor")
    with db_conn.cursor() as cur:
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute(
                """
                INSERT INTO public.assignments
                    (professor_id, title, due_at, min_quiz_score)
                VALUES (%s, %s, now() + interval '1 day', %s)
                """,
                (str(prof), "bad", 150),
            )
