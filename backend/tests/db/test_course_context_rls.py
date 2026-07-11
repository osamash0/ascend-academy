"""DB / RLS regression tests for course_context
(20260711000000_course_context.sql, Roadmap Phase 3.1 "course brain").

course_context is a 1:1 companion table to `courses`, so its RLS is designed
to mirror courses' own visibility exactly: the owning professor can read/write
their course's context; a student can read it only if they can already see the
course (via course_enrollments OR assignment-derived enrollment — the same
two branches courses itself uses). These tests assert the policies at the
Postgres layer, independent of the FastAPI service-role bypass.

Gated behind the `db` marker (boots a real Postgres via testcontainers).
"""
from __future__ import annotations

import uuid

import psycopg
import pytest

pytestmark = pytest.mark.db


def _as_user(cur, uid: uuid.UUID) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",))


def _reset_user(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def _make_context(cur, course_id: uuid.UUID, instructor: str = "Prof. Ada") -> None:
    cur.execute(
        "INSERT INTO public.course_context (course_id, instructor) VALUES (%s, %s)",
        (str(course_id), instructor),
    )


def _make_assignment_enrollment(
    cur, professor_id: uuid.UUID, user_id: uuid.UUID, lecture_id: uuid.UUID
) -> None:
    """Enroll a student in a lecture via the legacy assignment path (mirrors
    the pattern in test_student_uploads_rls.py / test_rls_policies.py)."""
    aid = uuid.uuid4()
    cur.execute(
        "INSERT INTO public.assignments (id, professor_id, title, due_at) "
        "VALUES (%s, %s, 'A', now() + interval '7 days')",
        (str(aid), str(professor_id)),
    )
    cur.execute(
        "INSERT INTO public.assignment_lectures (assignment_id, lecture_id) VALUES (%s, %s)",
        (str(aid), str(lecture_id)),
    )
    cur.execute(
        "INSERT INTO public.assignment_enrollments (assignment_id, user_id) VALUES (%s, %s)",
        (str(aid), str(user_id)),
    )


# ── professor (owner) ────────────────────────────────────────────────────────

def test_owner_sees_own_course_context(db_conn, make_user, make_course):
    prof = make_user(role="professor")
    course = make_course(prof)
    with db_conn.cursor() as cur:
        _make_context(cur, course)
        _as_user(cur, prof)
        cur.execute("SELECT instructor FROM course_context WHERE course_id = %s", (str(course),))
        rows = cur.fetchall()
        _reset_user(cur)
    assert rows == [("Prof. Ada",)]


def test_owner_can_update_own_course_context(db_conn, make_user, make_course):
    prof = make_user(role="professor")
    course = make_course(prof)
    with db_conn.cursor() as cur:
        _make_context(cur, course)
        _as_user(cur, prof)
        cur.execute(
            "UPDATE course_context SET instructor = 'Dr. Grace' WHERE course_id = %s",
            (str(course),),
        )
        updated = cur.rowcount
        _reset_user(cur)
    assert updated == 1


def test_other_professor_cannot_see_or_update_course_context(db_conn, make_user, make_course):
    owner = make_user(role="professor")
    other = make_user(role="professor")
    course = make_course(owner)
    with db_conn.cursor() as cur:
        _make_context(cur, course)
        _as_user(cur, other)
        cur.execute("SELECT instructor FROM course_context WHERE course_id = %s", (str(course),))
        visible = cur.fetchall()
        cur.execute(
            "UPDATE course_context SET instructor = 'Forged' WHERE course_id = %s",
            (str(course),),
        )
        updated = cur.rowcount
        _reset_user(cur)
    assert visible == []
    assert updated == 0


def test_professor_cannot_insert_context_for_another_professors_course(
    db_conn, make_user, make_course
):
    owner = make_user(role="professor")
    other = make_user(role="professor")
    course = make_course(owner)
    with db_conn.cursor() as cur:
        _as_user(cur, other)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(
                "INSERT INTO course_context (course_id, instructor) VALUES (%s, 'Forged')",
                (str(course),),
            )
        _reset_user(cur)


# ── students ──────────────────────────────────────────────────────────────────

def test_student_sees_context_via_course_enrollment(
    db_conn, make_user, make_course, make_course_enrollment
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(prof)
    make_course_enrollment(student, course)
    with db_conn.cursor() as cur:
        _make_context(cur, course)
        _as_user(cur, student)
        cur.execute("SELECT instructor FROM course_context WHERE course_id = %s", (str(course),))
        rows = cur.fetchall()
        _reset_user(cur)
    assert rows == [("Prof. Ada",)]


def test_student_sees_context_via_assignment_enrollment(
    db_conn, make_user, make_course, make_lecture
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(prof)
    lecture = make_lecture(prof)
    with db_conn.cursor() as cur:
        cur.execute("UPDATE lectures SET course_id = %s WHERE id = %s", (str(course), str(lecture)))
        _make_assignment_enrollment(cur, prof, student, lecture)
        _make_context(cur, course)
        _as_user(cur, student)
        cur.execute("SELECT instructor FROM course_context WHERE course_id = %s", (str(course),))
        rows = cur.fetchall()
        _reset_user(cur)
    assert rows == [("Prof. Ada",)]


def test_unenrolled_student_cannot_see_course_context(db_conn, make_user, make_course):
    prof = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(prof)
    with db_conn.cursor() as cur:
        _make_context(cur, course)
        _as_user(cur, student)
        cur.execute("SELECT instructor FROM course_context WHERE course_id = %s", (str(course),))
        rows = cur.fetchall()
        _reset_user(cur)
    assert rows == []


def test_student_cannot_write_course_context(db_conn, make_user, make_course, make_course_enrollment):
    prof = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(prof)
    make_course_enrollment(student, course)
    with db_conn.cursor() as cur:
        _make_context(cur, course)
        _as_user(cur, student)
        cur.execute(
            "UPDATE course_context SET instructor = 'Forged' WHERE course_id = %s",
            (str(course),),
        )
        updated = cur.rowcount
        _reset_user(cur)
    assert updated == 0


# ── cascade ───────────────────────────────────────────────────────────────────

def test_deleting_course_cascades_to_context(db_conn, make_user, make_course):
    prof = make_user(role="professor")
    course = make_course(prof)
    with db_conn.cursor() as cur:
        _make_context(cur, course)
        cur.execute("DELETE FROM courses WHERE id = %s", (str(course),))
        cur.execute("SELECT 1 FROM course_context WHERE course_id = %s", (str(course),))
        remaining = cur.fetchall()
    assert remaining == []
