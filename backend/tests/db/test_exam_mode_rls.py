"""DB / RLS regression tests for Exam Mode (20260710020000_exam_mode.sql).

The FastAPI layer goes through a service-role connection (bypasses RLS) and
enforces course-access in Python — but RLS is the defense-in-depth layer for
any direct (anon/authenticated-key) client access. These tests assert the
policy itself at the Postgres layer:

  - exam_attempts_own: a student can only read/write their own attempt rows;
    a forged INSERT under another user's id is rejected by Postgres, not
    silently accepted.
  - Professors get ZERO row-level access — unlike review_cards (which does
    have a student-enrolled SELECT policy), exam_attempts has no professor
    policy at all. Professors only see aggregates via a separate
    service-role analytics endpoint, never row access through this table.

Gated behind the `db` marker (boots a real Postgres via testcontainers).
"""
from __future__ import annotations

import uuid

import psycopg
import pytest

pytestmark = pytest.mark.db


# ── role / claim helpers (mirror test_review_engine_rls.py) ──────────────────

def _as_user(cur, uid: uuid.UUID) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",))


def _reset_user(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


# ── seed helpers (run as superuser → bypass RLS) ──────────────────────────────

def _mk_attempt(cur, user_id, course_id, *, question_ids=None, score=None):
    aid = uuid.uuid4()
    question_ids = question_ids or [str(uuid.uuid4())]
    cur.execute(
        """
        INSERT INTO public.exam_attempts (id, user_id, course_id, question_ids, time_limit_s, seed, score)
        VALUES (%s, %s, %s, %s, 1800, 42, %s)
        """,
        (str(aid), str(user_id), str(course_id), question_ids, score),
    )
    return aid


# ── own-row isolation ──────────────────────────────────────────────────────────

def test_student_sees_only_own_attempts(db_conn, make_user, make_course):
    prof = make_user(role="professor")
    student_a = make_user(role="student")
    student_b = make_user(role="student")
    course = make_course(prof)
    with db_conn.cursor() as cur:
        attempt_a = _mk_attempt(cur, student_a, course)
        attempt_b = _mk_attempt(cur, student_b, course)

        _as_user(cur, student_a)
        cur.execute("SELECT id FROM exam_attempts")
        visible = {r[0] for r in cur.fetchall()}
        _reset_user(cur)

    assert visible == {attempt_a}
    assert attempt_b not in visible


def test_student_cannot_insert_attempt_as_another_student(db_conn, make_user, make_course):
    prof = make_user(role="professor")
    student_a = make_user(role="student")
    student_b = make_user(role="student")
    course = make_course(prof)
    with db_conn.cursor() as cur:
        _as_user(cur, student_a)
        # Forging an attempt row under student_b's id must be blocked by the
        # WITH CHECK on exam_attempts_own (user_id = auth.uid()).
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(
                """
                INSERT INTO exam_attempts (user_id, course_id, question_ids, time_limit_s, seed)
                VALUES (%s, %s, %s, 1800, 1)
                """,
                (str(student_b), str(course), [str(uuid.uuid4())]),
            )
        _reset_user(cur)


def test_student_cannot_update_another_students_attempt(db_conn, make_user, make_course):
    prof = make_user(role="professor")
    student_a = make_user(role="student")
    student_b = make_user(role="student")
    course = make_course(prof)
    with db_conn.cursor() as cur:
        attempt_b = _mk_attempt(cur, student_b, course)

        _as_user(cur, student_a)
        cur.execute(
            "UPDATE exam_attempts SET score = 100 WHERE id = %s",
            (str(attempt_b),),
        )
        # RLS makes the target row invisible to student_a, so the UPDATE
        # matches zero rows rather than raising — assert it had no effect.
        assert cur.rowcount == 0
        _reset_user(cur)

    with db_conn.cursor() as cur:
        cur.execute("SELECT score FROM exam_attempts WHERE id = %s", (str(attempt_b),))
        assert cur.fetchone()[0] is None


# ── professor has zero row-level access ───────────────────────────────────────

def test_professor_sees_no_attempt_rows(db_conn, make_user, make_course):
    prof = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(prof)
    with db_conn.cursor() as cur:
        _mk_attempt(cur, student, course)

        _as_user(cur, prof)
        cur.execute("SELECT id FROM exam_attempts")
        rows = cur.fetchall()
        _reset_user(cur)

    assert rows == []


def test_professor_cannot_insert_attempt_for_a_student(db_conn, make_user, make_course):
    prof = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(prof)
    with db_conn.cursor() as cur:
        _as_user(cur, prof)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(
                """
                INSERT INTO exam_attempts (user_id, course_id, question_ids, time_limit_s, seed)
                VALUES (%s, %s, %s, 1800, 1)
                """,
                (str(student), str(course), [str(uuid.uuid4())]),
            )
        _reset_user(cur)


# ── badge catalog seeded correctly ─────────────────────────────────────────────

def test_exam_ready_badge_is_seeded(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT metric, xp_reward FROM badge_definitions WHERE key = %s",
            ("Exam Ready",),
        )
        row = cur.fetchone()
    assert row is not None, "the 'Exam Ready' row must exist or awardBadge() silently no-ops"
    metric, xp_reward = row
    assert metric is None  # event badge, not swept by evaluate_badges()
    assert xp_reward == 50
