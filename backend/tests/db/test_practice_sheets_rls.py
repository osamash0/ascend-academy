"""DB / RLS regression tests for practice sheets (20260503000019_practice_sheets.sql).

The FastAPI layer goes through supabase_admin (service role, bypasses RLS) and
enforces access in Python — but RLS is the defense-in-depth layer for any direct
(anon/authenticated-key) client access. These tests assert the policies
themselves at the Postgres layer:

  - practice_sheets_professor_all: a professor only sees their own sheets.
  - practice_sheets_student_published: a student sees a published sheet ONLY when
    enrolled (via assignment) on its lecture; never a draft; unenrolled sees none.
  - practice_sheet_questions_select: questions follow the same visibility.
  - practice_attempts_own: a student can only read their own attempts.

Gated behind the `db` marker (boots a real Postgres via testcontainers).
"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db


# ── role / claim helpers (mirror test_assignments_rls.py) ─────────────────────

def _as_user(cur, uid: uuid.UUID) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",))


def _reset_user(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


# ── seed helpers (run as superuser → bypass RLS) ──────────────────────────────

def _mk_sheet(cur, lecture_id, created_by, *, status="published", kind="manual", title="Sheet"):
    sid = uuid.uuid4()
    cur.execute(
        """
        INSERT INTO public.practice_sheets (id, lecture_id, kind, title, status, created_by)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (str(sid), str(lecture_id), kind, title, status, str(created_by)),
    )
    return sid


def _mk_question(cur, sheet_id, *, prompt="Q?"):
    qid = uuid.uuid4()
    cur.execute(
        """
        INSERT INTO public.practice_sheet_questions (id, sheet_id, order_index, type, prompt, correct_answer)
        VALUES (%s, %s, 0, 'short_answer', %s, '4')
        """,
        (str(qid), str(sheet_id), prompt),
    )
    return qid


def _mk_attempt(cur, sheet_id, student_id, *, score=100.0):
    aid = uuid.uuid4()
    cur.execute(
        """
        INSERT INTO public.practice_attempts (id, sheet_id, student_id, answers, score)
        VALUES (%s, %s, %s, '{}'::jsonb, %s)
        """,
        (str(aid), str(sheet_id), str(student_id), score),
    )
    return aid


def _enroll_via_assignment(cur, professor_id, lecture_id, student_id):
    """Grant a student visibility on a lecture the only way the RLS allows:
    an assignment that links the lecture and enrolls the student."""
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
        (str(aid), str(student_id)),
    )
    return aid


# ── professor isolation ───────────────────────────────────────────────────────

def test_professor_sees_only_own_sheets(db_conn, make_user, make_lecture):
    prof_a = make_user(role="professor")
    prof_b = make_user(role="professor")
    lec_a = make_lecture(prof_a)
    with db_conn.cursor() as cur:
        sheet_a = _mk_sheet(cur, lec_a, prof_a, status="draft")

        _as_user(cur, prof_a)
        cur.execute("SELECT id FROM practice_sheets")
        assert {r[0] for r in cur.fetchall()} == {sheet_a}
        _reset_user(cur)

        # Professor B must not see professor A's sheet at all.
        _as_user(cur, prof_b)
        cur.execute("SELECT id FROM practice_sheets WHERE id = %s", (str(sheet_a),))
        assert cur.fetchall() == []
        _reset_user(cur)


# ── student published-only visibility ─────────────────────────────────────────

def test_enrolled_student_sees_published_but_not_draft(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)
    with db_conn.cursor() as cur:
        pub = _mk_sheet(cur, lec, prof, status="published")
        draft = _mk_sheet(cur, lec, prof, status="draft", kind="auto")
        _enroll_via_assignment(cur, prof, lec, student)

        _as_user(cur, student)
        cur.execute("SELECT id FROM practice_sheets")
        visible = {r[0] for r in cur.fetchall()}
        _reset_user(cur)

    assert pub in visible          # published + enrolled -> visible
    assert draft not in visible    # draft -> never visible to a student


def test_unenrolled_student_sees_no_sheets(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)
    with db_conn.cursor() as cur:
        _mk_sheet(cur, lec, prof, status="published")  # published but student NOT enrolled

        _as_user(cur, student)
        cur.execute("SELECT id FROM practice_sheets")
        rows = cur.fetchall()
        _reset_user(cur)

    assert rows == []


def test_questions_follow_sheet_visibility(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    enrolled = make_user(role="student")
    outsider = make_user(role="student")
    lec = make_lecture(prof)
    with db_conn.cursor() as cur:
        pub = _mk_sheet(cur, lec, prof, status="published")
        q = _mk_question(cur, pub)
        _enroll_via_assignment(cur, prof, lec, enrolled)

        _as_user(cur, enrolled)
        cur.execute("SELECT id FROM practice_sheet_questions WHERE id = %s", (str(q),))
        seen_by_enrolled = cur.fetchall()
        _reset_user(cur)

        _as_user(cur, outsider)
        cur.execute("SELECT id FROM practice_sheet_questions WHERE id = %s", (str(q),))
        seen_by_outsider = cur.fetchall()
        _reset_user(cur)

    assert len(seen_by_enrolled) == 1
    assert seen_by_outsider == []


# ── attempt isolation ─────────────────────────────────────────────────────────

def test_student_cannot_read_another_students_attempt(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    student_s = make_user(role="student")
    student_t = make_user(role="student")
    lec = make_lecture(prof)
    with db_conn.cursor() as cur:
        sheet = _mk_sheet(cur, lec, prof, status="published")
        attempt_s = _mk_attempt(cur, sheet, student_s)
        attempt_t = _mk_attempt(cur, sheet, student_t)

        _as_user(cur, student_s)
        cur.execute("SELECT id FROM practice_attempts")
        visible = {r[0] for r in cur.fetchall()}
        _reset_user(cur)

    assert attempt_s in visible        # own attempt visible
    assert attempt_t not in visible    # another student's attempt hidden


def test_student_cannot_insert_attempt_as_another_student(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    student_s = make_user(role="student")
    student_t = make_user(role="student")
    lec = make_lecture(prof)
    import psycopg
    with db_conn.cursor() as cur:
        sheet = _mk_sheet(cur, lec, prof, status="published")

        _as_user(cur, student_s)
        # Forging an attempt under student_t's id must be blocked by the
        # WITH CHECK on practice_attempts_own (student_id = auth.uid()).
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(
                "INSERT INTO practice_attempts (sheet_id, student_id, answers) "
                "VALUES (%s, %s, '{}'::jsonb)",
                (str(sheet), str(student_t)),
            )
        _reset_user(cur)
