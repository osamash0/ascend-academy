"""DB / RLS regression tests for student self-serve uploads
(20260710040000_student_uploads.sql, Roadmap Phase 3.1 "My Materials").

The FastAPI layer goes through a service-role connection (bypasses RLS) and
enforces access in Python — but RLS is the defense-in-depth layer for any
direct (anon/authenticated-key) client access. These tests assert the
policies themselves at the Postgres layer:

  - A private lecture is visible/manageable only to its student owner —
    not to another student, not to any professor.
  - slides/quiz_questions (previously "Anyone can view", USING (true)) now
    respect private visibility while a `visibility='course'` lecture's
    slides/questions remain visible to any authenticated user (regression
    guard for the existing open-course behavior).
  - review_cards for a private lecture are readable by its owner.
  - upload_quotas rows are own-row-only and cannot be forged via direct
    client writes (no INSERT/UPDATE policy exists — only the SECURITY
    DEFINER RPC can write them).

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


def _make_private_lecture(cur, student_id: uuid.UUID, title: str = "My Notes") -> uuid.UUID:
    lid = uuid.uuid4()
    cur.execute(
        """
        INSERT INTO public.lectures (id, title, professor_id, student_owner_id, visibility, total_slides)
        VALUES (%s, %s, NULL, %s, 'private_student', 1)
        """,
        (str(lid), title, str(student_id)),
    )
    return lid


def _make_slide(cur, lecture_id: uuid.UUID) -> uuid.UUID:
    sid = uuid.uuid4()
    cur.execute(
        "INSERT INTO public.slides (id, lecture_id, slide_number, title, content_text) VALUES (%s, %s, 1, 'S', 'body')",
        (str(sid), str(lecture_id)),
    )
    return sid


def _make_quiz(cur, slide_id: uuid.UUID) -> uuid.UUID:
    qid = uuid.uuid4()
    cur.execute(
        """
        INSERT INTO public.quiz_questions (id, slide_id, question_text, options, correct_answer)
        VALUES (%s, %s, '2+2?', '["1","2","3","4"]'::jsonb, 3)
        """,
        (str(qid), str(slide_id)),
    )
    return qid


def _make_card(cur, lecture_id: uuid.UUID) -> uuid.UUID:
    cid = uuid.uuid4()
    cur.execute(
        """
        INSERT INTO public.review_cards (id, lecture_id, source_type, front, back, content_hash)
        VALUES (%s, %s, 'quiz_question', '{"q": "?"}'::jsonb, '{"a": "!"}'::jsonb, %s)
        """,
        (str(cid), str(lecture_id), str(uuid.uuid4())),
    )
    return cid


# ── owner-consistency CHECK constraint ───────────────────────────────────────

def test_owner_consistency_rejects_dual_ownership(db_conn, make_user):
    student = make_user(role="student")
    prof = make_user(role="professor")
    with db_conn.cursor() as cur:
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute(
                """
                INSERT INTO public.lectures (id, title, professor_id, student_owner_id, visibility)
                VALUES (%s, 'bad', %s, %s, 'private_student')
                """,
                (str(uuid.uuid4()), str(prof), str(student)),
            )


def test_owner_consistency_rejects_course_id_on_private_lecture(db_conn, make_user, make_course):
    student = make_user(role="student")
    prof = make_user(role="professor")
    course = make_course(prof)
    with db_conn.cursor() as cur:
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute(
                """
                INSERT INTO public.lectures (id, title, student_owner_id, visibility, course_id)
                VALUES (%s, 'bad', %s, 'private_student', %s)
                """,
                (str(uuid.uuid4()), str(student), str(course)),
            )


# ── lectures visibility ───────────────────────────────────────────────────────

def test_owner_sees_own_private_lecture(db_conn, make_user):
    student = make_user(role="student")
    with db_conn.cursor() as cur:
        lec = _make_private_lecture(cur, student)
        _as_user(cur, student)
        cur.execute("SELECT id FROM lectures WHERE id = %s", (str(lec),))
        visible = cur.fetchall()
        _reset_user(cur)
    assert len(visible) == 1


def test_other_student_cannot_see_private_lecture(db_conn, make_user):
    owner = make_user(role="student")
    other = make_user(role="student")
    with db_conn.cursor() as cur:
        lec = _make_private_lecture(cur, owner)
        _as_user(cur, other)
        cur.execute("SELECT id FROM lectures WHERE id = %s", (str(lec),))
        visible = cur.fetchall()
        _reset_user(cur)
    assert visible == []


def test_professor_cannot_see_private_lecture(db_conn, make_user):
    owner = make_user(role="student")
    prof = make_user(role="professor")
    with db_conn.cursor() as cur:
        lec = _make_private_lecture(cur, owner)
        _as_user(cur, prof)
        cur.execute("SELECT id FROM lectures WHERE id = %s", (str(lec),))
        visible = cur.fetchall()
        _reset_user(cur)
    assert visible == []


def test_student_cannot_insert_private_lecture_as_another_student(db_conn, make_user):
    student_a = make_user(role="student")
    student_b = make_user(role="student")
    with db_conn.cursor() as cur:
        _as_user(cur, student_a)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(
                """
                INSERT INTO public.lectures (id, title, student_owner_id, visibility)
                VALUES (%s, 'forged', %s, 'private_student')
                """,
                (str(uuid.uuid4()), str(student_b)),
            )
        _reset_user(cur)


def test_owner_can_delete_own_private_lecture(db_conn, make_user):
    student = make_user(role="student")
    with db_conn.cursor() as cur:
        lec = _make_private_lecture(cur, student)
        _as_user(cur, student)
        cur.execute("DELETE FROM lectures WHERE id = %s", (str(lec),))
        deleted = cur.rowcount
        _reset_user(cur)
    assert deleted == 1


def test_other_student_cannot_delete_private_lecture(db_conn, make_user):
    owner = make_user(role="student")
    other = make_user(role="student")
    with db_conn.cursor() as cur:
        lec = _make_private_lecture(cur, owner)
        _as_user(cur, other)
        cur.execute("DELETE FROM lectures WHERE id = %s", (str(lec),))
        deleted = cur.rowcount
        _reset_user(cur)
        # Row-level policy silently filters rather than erroring — assert it survived.
        cur.execute("SELECT id FROM lectures WHERE id = %s", (str(lec),))
        still_there = cur.fetchall()
    assert deleted == 0
    assert len(still_there) == 1


# ── slides / quiz_questions visibility ───────────────────────────────────────

def test_other_student_cannot_see_private_lecture_slides(db_conn, make_user):
    owner = make_user(role="student")
    other = make_user(role="student")
    with db_conn.cursor() as cur:
        lec = _make_private_lecture(cur, owner)
        slide = _make_slide(cur, lec)
        _make_quiz(cur, slide)

        _as_user(cur, other)
        cur.execute("SELECT id FROM slides WHERE lecture_id = %s", (str(lec),))
        slides_visible = cur.fetchall()
        cur.execute(
            "SELECT id FROM quiz_questions WHERE slide_id = %s", (str(slide),)
        )
        quizzes_visible = cur.fetchall()
        _reset_user(cur)
    assert slides_visible == []
    assert quizzes_visible == []


def test_owner_sees_own_private_lecture_slides_and_quizzes(db_conn, make_user):
    owner = make_user(role="student")
    with db_conn.cursor() as cur:
        lec = _make_private_lecture(cur, owner)
        slide = _make_slide(cur, lec)
        quiz = _make_quiz(cur, slide)

        _as_user(cur, owner)
        cur.execute("SELECT id FROM slides WHERE id = %s", (str(slide),))
        slides_visible = cur.fetchall()
        cur.execute("SELECT id FROM quiz_questions WHERE id = %s", (str(quiz),))
        quizzes_visible = cur.fetchall()
        _reset_user(cur)
    assert len(slides_visible) == 1
    assert len(quizzes_visible) == 1


def test_course_lecture_slides_still_open_to_any_authenticated_user(
    db_conn, make_user, make_lecture, make_slide, make_quiz
):
    """Regression guard: tightening the private-lecture branch must not
    change today's open-course behavior for visibility='course' lectures."""
    prof = make_user(role="professor")
    any_student = make_user(role="student")
    lec = make_lecture(prof)
    slide = make_slide(lec)
    quiz = make_quiz(slide)

    with db_conn.cursor() as cur:
        _as_user(cur, any_student)
        cur.execute("SELECT id FROM slides WHERE id = %s", (str(slide),))
        slides_visible = cur.fetchall()
        cur.execute("SELECT id FROM quiz_questions WHERE id = %s", (str(quiz),))
        quizzes_visible = cur.fetchall()
        _reset_user(cur)
    assert len(slides_visible) == 1
    assert len(quizzes_visible) == 1


# ── review_cards private-owner branch ─────────────────────────────────────────

def test_owner_sees_own_private_lecture_review_cards(db_conn, make_user):
    owner = make_user(role="student")
    with db_conn.cursor() as cur:
        lec = _make_private_lecture(cur, owner)
        card = _make_card(cur, lec)

        _as_user(cur, owner)
        cur.execute("SELECT id FROM review_cards WHERE id = %s", (str(card),))
        visible = cur.fetchall()
        _reset_user(cur)
    assert len(visible) == 1


def test_other_student_cannot_see_private_lecture_review_cards(db_conn, make_user):
    owner = make_user(role="student")
    other = make_user(role="student")
    with db_conn.cursor() as cur:
        lec = _make_private_lecture(cur, owner)
        card = _make_card(cur, lec)

        _as_user(cur, other)
        cur.execute("SELECT id FROM review_cards WHERE id = %s", (str(card),))
        visible = cur.fetchall()
        _reset_user(cur)
    assert visible == []


# ── upload_quotas ─────────────────────────────────────────────────────────────

def test_student_sees_own_quota_row_only(db_conn, make_user):
    student_a = make_user(role="student")
    student_b = make_user(role="student")
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO upload_quotas (user_id, period, uploads_used) VALUES (%s, '2026-07', 2)",
            (str(student_a),),
        )
        cur.execute(
            "INSERT INTO upload_quotas (user_id, period, uploads_used) VALUES (%s, '2026-07', 4)",
            (str(student_b),),
        )
        _as_user(cur, student_a)
        cur.execute("SELECT user_id FROM upload_quotas")
        visible = {r[0] for r in cur.fetchall()}
        _reset_user(cur)
    assert visible == {student_a}


def test_student_cannot_directly_insert_quota_row(db_conn, make_user):
    student = make_user(role="student")
    with db_conn.cursor() as cur:
        _as_user(cur, student)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(
                "INSERT INTO upload_quotas (user_id, period, uploads_used, quota_limit) VALUES (%s, '2026-07', 0, 999)",
                (str(student),),
            )
        _reset_user(cur)


def test_increment_upload_quota_rpc_enforces_limit(db_conn, make_user):
    student = make_user(role="student")
    with db_conn.cursor() as cur:
        for _ in range(3):
            cur.execute(
                "SELECT allowed, uploads_used, quota_limit FROM increment_upload_quota(%s, '2026-08', 3)",
                (str(student),),
            )
            allowed, used, limit = cur.fetchone()
            assert allowed is True
        cur.execute(
            "SELECT allowed, uploads_used, quota_limit FROM increment_upload_quota(%s, '2026-08', 3)",
            (str(student),),
        )
        allowed, used, limit = cur.fetchone()
    assert allowed is False
    assert used == 3
    assert limit == 3
