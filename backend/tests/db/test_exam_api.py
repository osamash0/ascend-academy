"""Integration tests for the Exam Mode API (backend/api/v1/exams.py) against a
REAL Postgres (testcontainers + all migrations) — mirrors test_review_api.py's
approach and its rationale for httpx.ASGITransport over TestClient (asyncpg
connections are loop-bound; TestClient's sync-bridge runs the app on a
different loop than this test, which breaks the shared pool).

Course access (`_student_visible_course_ids`, courses.py) reads through
`supabase_admin` — the in-memory `patch_supabase` fake, not the testcontainers
Postgres — so course_enrollments needed for authorization are seeded into the
fake client directly, separately from quiz/lecture data seeded into the real
DB via `db_conn`/asyncpg fixtures.

Gated behind `db` (needs Docker + testcontainers).
"""
from __future__ import annotations

import json
import uuid
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.db

NUM_QUESTIONS = 20


@pytest.fixture
async def wired_pool(pg_dsn, applied_migrations):
    """Point the app's global asyncpg pool at the throwaway container."""
    import asyncpg
    import backend.core.database as core

    pool = await asyncpg.create_pool(pg_dsn, min_size=1, max_size=4, statement_cache_size=0)
    old = core.db_pool
    core.db_pool = pool
    try:
        yield pool
    finally:
        core.db_pool = old
        await pool.close()


def _student_user(uid: uuid.UUID) -> SimpleNamespace:
    return SimpleNamespace(id=str(uid), app_metadata={"role": "student"}, user_metadata={})


def _client_as(app, student_uid: uuid.UUID) -> AsyncClient:
    from backend.core.auth_middleware import verify_token

    app.dependency_overrides[verify_token] = lambda: _student_user(student_uid)
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _enroll_in_course(patch_supabase, student_id: uuid.UUID, course_id: uuid.UUID) -> None:
    # `.seed()` REPLACES the whole table, so a second call would wipe out an
    # earlier enrollment (e.g. a two-student test) — append directly instead.
    patch_supabase.tables.setdefault("course_enrollments", []).append(
        {"id": str(uuid.uuid4()), "user_id": str(student_id), "course_id": str(course_id)},
    )


def _seed_course_with_questions(
    db_conn, make_lecture, prof, course_id: uuid.UUID, *, num_questions=NUM_QUESTIONS, concepts=None,
):
    """Insert one lecture (assigned to `course_id`) with `num_questions` slides,
    each carrying one quiz question. `concepts` cycles across questions so
    coverage/weighting has something to group on; correct_answer is always
    index 0 so a test can control right/wrong by submitting 0 or not-0."""
    concepts = concepts or ["Recursion", "Loops", "Pointers", "Big-O"]
    lec = make_lecture(prof)
    with db_conn.cursor() as cur:
        cur.execute("UPDATE public.lectures SET course_id = %s WHERE id = %s", (str(course_id), str(lec)))
        question_ids = []
        for i in range(num_questions):
            sid = uuid.uuid4()
            cur.execute(
                "INSERT INTO public.slides (id, lecture_id, slide_number, title, content_text) "
                "VALUES (%s, %s, %s, %s, %s)",
                (str(sid), str(lec), i + 1, f"Slide {i + 1}", "body"),
            )
            qid = uuid.uuid4()
            concept = concepts[i % len(concepts)]
            cur.execute(
                """
                INSERT INTO public.quiz_questions
                    (id, slide_id, question_text, options, correct_answer, metadata)
                VALUES (%s, %s, %s, %s::jsonb, 0, %s::jsonb)
                """,
                (
                    str(qid), str(sid), f"Q{i}?", json.dumps(["right", "wrong1", "wrong2", "wrong3"]),
                    json.dumps({"concept": concept, "difficulty": "medium"}),
                ),
            )
            question_ids.append(str(qid))
    return lec, question_ids


# ── generate ───────────────────────────────────────────────────────────────

async def test_generate_returns_questions_without_correct_answer(
    wired_pool, db_conn, make_user, make_lecture, make_course, app, patch_supabase,
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(prof)
    _seed_course_with_questions(db_conn, make_lecture, prof, course)
    _enroll_in_course(patch_supabase, student, course)

    async with _client_as(app, student) as client:
        r = await client.post(f"/api/v1/exams/course/{course}/generate", json={"num_questions": 20})
        assert r.status_code == 200
        body = r.json()
        assert len(body["questions"]) == 20
        assert "exam_id" in body
        for q in body["questions"]:
            assert "correct_answer" not in q
            assert "options" in q


async def test_generate_rejects_unenrolled_student(
    wired_pool, db_conn, make_user, make_lecture, make_course, app, patch_supabase,
):
    prof = make_user(role="professor")
    outsider = make_user(role="student")
    course = make_course(prof)
    _seed_course_with_questions(db_conn, make_lecture, prof, course)
    # outsider is never enrolled

    async with _client_as(app, outsider) as client:
        r = await client.post(f"/api/v1/exams/course/{course}/generate", json={"num_questions": 20})
        assert r.status_code == 403


async def test_generate_rejects_too_few_questions(
    wired_pool, db_conn, make_user, make_lecture, make_course, app, patch_supabase,
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(prof)
    _seed_course_with_questions(db_conn, make_lecture, prof, course, num_questions=5)
    _enroll_in_course(patch_supabase, student, course)

    async with _client_as(app, student) as client:
        r = await client.post(f"/api/v1/exams/course/{course}/generate", json={"num_questions": 20})
        assert r.status_code == 400


# ── get / answer autosave ──────────────────────────────────────────────────

async def test_get_exam_returns_own_attempt(
    wired_pool, db_conn, make_user, make_lecture, make_course, app, patch_supabase,
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(prof)
    _seed_course_with_questions(db_conn, make_lecture, prof, course)
    _enroll_in_course(patch_supabase, student, course)

    async with _client_as(app, student) as client:
        gen = (await client.post(f"/api/v1/exams/course/{course}/generate", json={"num_questions": 20})).json()
        exam_id = gen["exam_id"]

        r = await client.get(f"/api/v1/exams/{exam_id}")
        assert r.status_code == 200
        assert r.json()["exam_id"] == exam_id
        assert len(r.json()["questions"]) == 20


async def test_get_exam_hides_other_students_attempt(
    wired_pool, db_conn, make_user, make_lecture, make_course, app, patch_supabase,
):
    prof = make_user(role="professor")
    student_a = make_user(role="student")
    student_b = make_user(role="student")
    course = make_course(prof)
    _seed_course_with_questions(db_conn, make_lecture, prof, course)
    _enroll_in_course(patch_supabase, student_a, course)
    _enroll_in_course(patch_supabase, student_b, course)

    async with _client_as(app, student_a) as client_a:
        gen = (await client_a.post(f"/api/v1/exams/course/{course}/generate", json={"num_questions": 20})).json()
        exam_id = gen["exam_id"]

    async with _client_as(app, student_b) as client_b:
        r = await client_b.get(f"/api/v1/exams/{exam_id}")
        assert r.status_code == 404


async def test_answer_autosave_persists_and_is_returned_by_get(
    wired_pool, db_conn, make_user, make_lecture, make_course, app, patch_supabase,
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(prof)
    _seed_course_with_questions(db_conn, make_lecture, prof, course)
    _enroll_in_course(patch_supabase, student, course)

    async with _client_as(app, student) as client:
        gen = (await client.post(f"/api/v1/exams/course/{course}/generate", json={"num_questions": 20})).json()
        exam_id = gen["exam_id"]
        qid = gen["questions"][0]["id"]

        r = await client.post(f"/api/v1/exams/{exam_id}/answer", json={"question_id": qid, "selected": 2})
        assert r.status_code == 200

        got = (await client.get(f"/api/v1/exams/{exam_id}")).json()
        assert got["answers"][qid] == 2


# ── submit / grading ────────────────────────────────────────────────────────

async def test_submit_grades_correctly_and_ranks_weakest_concept(
    wired_pool, db_conn, make_user, make_lecture, make_course, app, patch_supabase,
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(prof)
    _seed_course_with_questions(db_conn, make_lecture, prof, course, concepts=["Recursion", "Loops"])
    _enroll_in_course(patch_supabase, student, course)

    async with _client_as(app, student) as client:
        gen = (await client.post(f"/api/v1/exams/course/{course}/generate", json={"num_questions": 20})).json()
        exam_id = gen["exam_id"]

        # correct_answer is always index 0 (see _seed_course_with_questions).
        # Get every "Recursion" question wrong, every "Loops" question right —
        # requires knowing concept per question, which the API deliberately
        # doesn't expose, so fetch it straight from the DB for test setup.
        with db_conn.cursor() as cur:
            cur.execute(
                "SELECT id, metadata->>'concept' FROM quiz_questions WHERE id = ANY(%s::uuid[])",
                ([q["id"] for q in gen["questions"]],),
            )
            concept_by_id = {str(k): v for k, v in cur.fetchall()}

        answers = {}
        for q in gen["questions"]:
            answers[q["id"]] = 1 if concept_by_id[q["id"]] == "Recursion" else 0  # 1 = wrong, 0 = correct

        r = await client.post(f"/api/v1/exams/{exam_id}/submit", json={"answers": answers})
        assert r.status_code == 200
        body = r.json()
        assert body["submitted_at"] is not None
        assert body["expired"] is False
        num_recursion = sum(1 for c in concept_by_id.values() if c == "Recursion")
        num_correct = 20 - num_recursion
        assert body["score"] == pytest.approx(round(100.0 * num_correct / 20, 1))
        weakest = body["report"]["weakest_concepts"]
        assert weakest[0]["concept"] == "Recursion"
        assert weakest[0]["miss_rate"] == 1.0


async def test_submit_is_idempotent_on_double_call(
    wired_pool, db_conn, make_user, make_lecture, make_course, app, patch_supabase,
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(prof)
    _seed_course_with_questions(db_conn, make_lecture, prof, course)
    _enroll_in_course(patch_supabase, student, course)

    async with _client_as(app, student) as client:
        gen = (await client.post(f"/api/v1/exams/course/{course}/generate", json={"num_questions": 20})).json()
        exam_id = gen["exam_id"]

        first = (await client.post(f"/api/v1/exams/{exam_id}/submit", json={"answers": {}})).json()
        second = (await client.post(f"/api/v1/exams/{exam_id}/submit", json={"answers": {}})).json()
        assert first["score"] == second["score"]
        assert first["submitted_at"] == second["submitted_at"]


async def test_professor_role_cannot_read_exam_attempts_directly(
    wired_pool, db_conn, make_user, make_lecture, make_course, app, patch_supabase,
):
    """No exam-attempt row-level endpoint accepts a professor at all — the
    router itself is Depends(require_student) end to end."""
    prof = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(prof)
    _seed_course_with_questions(db_conn, make_lecture, prof, course)
    _enroll_in_course(patch_supabase, student, course)

    async with _client_as(app, student) as client:
        gen = (await client.post(f"/api/v1/exams/course/{course}/generate", json={"num_questions": 20})).json()
        exam_id = gen["exam_id"]

    def _prof_user(uid):
        return SimpleNamespace(id=str(uid), app_metadata={"role": "professor"}, user_metadata={})

    from backend.core.auth_middleware import verify_token
    app.dependency_overrides[verify_token] = lambda: _prof_user(prof)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/api/v1/exams/{exam_id}")
        assert r.status_code == 403


# ── send misses to review ──────────────────────────────────────────────────

async def test_send_misses_to_review_creates_cards_and_is_idempotent(
    wired_pool, db_conn, make_user, make_lecture, make_course, app, patch_supabase,
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(prof)
    _seed_course_with_questions(db_conn, make_lecture, prof, course, concepts=["Recursion"])
    _enroll_in_course(patch_supabase, student, course)

    async with _client_as(app, student) as client:
        gen = (await client.post(f"/api/v1/exams/course/{course}/generate", json={"num_questions": 20})).json()
        exam_id = gen["exam_id"]
        # get everything wrong so every question is a "miss"
        answers = {q["id"]: 3 for q in gen["questions"]}
        await client.post(f"/api/v1/exams/{exam_id}/submit", json={"answers": answers})

        r1 = await client.post(f"/api/v1/exams/{exam_id}/send-misses-to-review")
        assert r1.status_code == 200
        assert r1.json()["cards_created"] == 20
        assert r1.json()["cards_activated"] == 20

        r2 = await client.post(f"/api/v1/exams/{exam_id}/send-misses-to-review")
        assert r2.status_code == 200
        assert r2.json()["cards_created"] == 0  # already exist — no duplicates
        assert r2.json()["cards_activated"] == 0  # schedule rows already exist

    with db_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM review_cards")
        assert cur.fetchone()[0] == 20
        cur.execute("SELECT count(*) FROM review_schedule WHERE user_id = %s", (str(student),))
        assert cur.fetchone()[0] == 20


async def test_send_misses_to_review_requires_submitted_exam(
    wired_pool, db_conn, make_user, make_lecture, make_course, app, patch_supabase,
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(prof)
    _seed_course_with_questions(db_conn, make_lecture, prof, course)
    _enroll_in_course(patch_supabase, student, course)

    async with _client_as(app, student) as client:
        gen = (await client.post(f"/api/v1/exams/course/{course}/generate", json={"num_questions": 20})).json()
        exam_id = gen["exam_id"]

        r = await client.post(f"/api/v1/exams/{exam_id}/send-misses-to-review")
        assert r.status_code == 400
