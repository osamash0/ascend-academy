"""DB / RLS regression tests for the SRS review engine (20260710010000_review_engine.sql).

The FastAPI layer goes through a service-role connection (bypasses RLS) and
enforces access in Python — but RLS is the defense-in-depth layer for any
direct (anon/authenticated-key) client access. These tests assert the
policies themselves at the Postgres layer:

  - review_cards_student_enrolled: a student sees cards for a lecture ONLY
    when enrolled (via assignment) on it; an unenrolled student sees none.
  - review_schedule_own / review_log_own: a student can only read their own
    schedule/log rows, and a forged INSERT under another user's id is
    rejected by Postgres, not silently accepted.

Gated behind the `db` marker (boots a real Postgres via testcontainers).
"""
from __future__ import annotations

import uuid

import psycopg
import pytest

pytestmark = pytest.mark.db


# ── role / claim helpers (mirror test_practice_sheets_rls.py) ────────────────

def _as_user(cur, uid: uuid.UUID) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",))


def _reset_user(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


# ── seed helpers (run as superuser → bypass RLS) ──────────────────────────────

def _mk_card(cur, lecture_id, *, content_hash=None, source_type="quiz_question"):
    cid = uuid.uuid4()
    content_hash = content_hash or str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO public.review_cards (id, lecture_id, source_type, front, back, content_hash)
        VALUES (%s, %s, %s, '{"q": "?"}'::jsonb, '{"a": "!"}'::jsonb, %s)
        """,
        (str(cid), str(lecture_id), source_type, content_hash),
    )
    return cid


def _mk_schedule(cur, user_id, card_id):
    cur.execute(
        "INSERT INTO public.review_schedule (user_id, card_id) VALUES (%s, %s)",
        (str(user_id), str(card_id)),
    )


def _mk_log(cur, user_id, card_id, *, rating=3):
    cur.execute(
        "INSERT INTO public.review_log (user_id, card_id, rating) VALUES (%s, %s, %s)",
        (str(user_id), str(card_id), rating),
    )


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


# ── card visibility ───────────────────────────────────────────────────────────

def test_enrolled_student_sees_cards(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)
    with db_conn.cursor() as cur:
        card = _mk_card(cur, lec)
        _enroll_via_assignment(cur, prof, lec, student)

        _as_user(cur, student)
        cur.execute("SELECT id FROM review_cards")
        visible = {r[0] for r in cur.fetchall()}
        _reset_user(cur)

    assert card in visible


def test_unenrolled_student_sees_no_cards(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)
    with db_conn.cursor() as cur:
        _mk_card(cur, lec)  # exists, but student is NOT enrolled

        _as_user(cur, student)
        cur.execute("SELECT id FROM review_cards")
        rows = cur.fetchall()
        _reset_user(cur)

    assert rows == []


# ── schedule / log isolation ──────────────────────────────────────────────────

def test_student_cannot_read_another_students_schedule(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    student_a = make_user(role="student")
    student_b = make_user(role="student")
    lec = make_lecture(prof)
    with db_conn.cursor() as cur:
        card = _mk_card(cur, lec)
        _mk_schedule(cur, student_a, card)
        _mk_schedule(cur, student_b, card)

        _as_user(cur, student_a)
        cur.execute("SELECT user_id FROM review_schedule")
        visible = {r[0] for r in cur.fetchall()}
        _reset_user(cur)

    assert visible == {student_a}          # only own row visible
    assert student_b not in visible        # the other student's row is hidden


def test_student_cannot_insert_schedule_as_another_student(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    student_a = make_user(role="student")
    student_b = make_user(role="student")
    lec = make_lecture(prof)
    with db_conn.cursor() as cur:
        card = _mk_card(cur, lec)

        _as_user(cur, student_a)
        # Forging a schedule row under student_b's id must be blocked by the
        # WITH CHECK on review_schedule_own (user_id = auth.uid()).
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(
                "INSERT INTO review_schedule (user_id, card_id) VALUES (%s, %s)",
                (str(student_b), str(card)),
            )
        _reset_user(cur)


def test_student_cannot_read_another_students_log(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    student_a = make_user(role="student")
    student_b = make_user(role="student")
    lec = make_lecture(prof)
    with db_conn.cursor() as cur:
        card = _mk_card(cur, lec)
        _mk_log(cur, student_a, card)
        _mk_log(cur, student_b, card)

        _as_user(cur, student_a)
        cur.execute("SELECT user_id FROM review_log")
        visible = {r[0] for r in cur.fetchall()}
        _reset_user(cur)

    assert visible == {student_a}
    assert student_b not in visible


def test_student_cannot_insert_log_as_another_student(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    student_a = make_user(role="student")
    student_b = make_user(role="student")
    lec = make_lecture(prof)
    with db_conn.cursor() as cur:
        card = _mk_card(cur, lec)

        _as_user(cur, student_a)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(
                "INSERT INTO review_log (user_id, card_id, rating) VALUES (%s, %s, 3)",
                (str(student_b), str(card)),
            )
        _reset_user(cur)
