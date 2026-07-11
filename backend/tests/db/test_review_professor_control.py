"""Integration tests for the professor-facing review-card control endpoints
(Roadmap Phase 4.1): GET .../cards, POST .../hide, POST .../unhide.

Same real-Postgres + ASGITransport rationale as test_review_api.py (asyncpg
connections are loop-bound; TestClient's portal would deadlock them).

Gated behind `db` (needs Docker + testcontainers).
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

from backend.services.review.card_factory import generate_review_cards

pytestmark = pytest.mark.db


@pytest.fixture
async def wired_pool(pg_dsn, applied_migrations):
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


def _student_user(uid) -> SimpleNamespace:
    return SimpleNamespace(id=str(uid), app_metadata={"role": "student"}, user_metadata={})


def _professor_user(uid) -> SimpleNamespace:
    return SimpleNamespace(id=str(uid), app_metadata={"role": "professor"}, user_metadata={})


def _enroll(db_conn, professor_id, lecture_id, student_id):
    aid = uuid.uuid4()
    with db_conn.cursor() as cur:
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


def _client_as(app, user: SimpleNamespace) -> AsyncClient:
    from backend.core.auth_middleware import verify_token, require_professor, require_student

    app.dependency_overrides[verify_token] = lambda: user
    if user.app_metadata.get("role") == "professor":
        app.dependency_overrides[require_professor] = lambda: user
        app.dependency_overrides.pop(require_student, None)
    else:
        app.dependency_overrides[require_student] = lambda: user
        app.dependency_overrides.pop(require_professor, None)
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_owner_lists_lecture_cards(
    wired_pool, db_conn, make_user, make_lecture, make_slide, make_quiz, app, patch_supabase,
):
    prof = make_user(role="professor")
    lec = make_lecture(prof)
    slide = make_slide(lec)
    make_quiz(slide)
    await generate_review_cards({}, str(lec))

    async with _client_as(app, _professor_user(prof)) as client:
        r = await client.get(f"/api/v1/review/lecture/{lec}/cards")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 1
        assert body["cards"][0]["source_type"] == "quiz_question"
        assert body["cards"][0]["hidden"] is False


async def test_non_owner_professor_gets_403_on_list(
    wired_pool, db_conn, make_user, make_lecture, make_slide, make_quiz, app, patch_supabase,
):
    owner = make_user(role="professor")
    other = make_user(role="professor")
    lec = make_lecture(owner)
    slide = make_slide(lec)
    make_quiz(slide)
    await generate_review_cards({}, str(lec))

    async with _client_as(app, _professor_user(other)) as client:
        r = await client.get(f"/api/v1/review/lecture/{lec}/cards")
        assert r.status_code == 403


async def test_hiding_a_card_removes_it_from_student_queue(
    wired_pool, db_conn, make_user, make_lecture, make_slide, make_quiz, app, patch_supabase,
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)
    slide = make_slide(lec)
    make_quiz(slide)
    _enroll(db_conn, prof, lec, student)
    await generate_review_cards({}, str(lec))

    async with _client_as(app, _professor_user(prof)) as client:
        cards = (await client.get(f"/api/v1/review/lecture/{lec}/cards")).json()["cards"]
        card_id = cards[0]["card_id"]
        r = await client.post(f"/api/v1/review/cards/{card_id}/hide")
        assert r.status_code == 200
        assert r.json() == {"card_id": card_id, "hidden": True}

    async with _client_as(app, _student_user(student)) as client:
        r = await client.get("/api/v1/review/queue")
        assert r.json()["total_due"] == 0


async def test_hiding_a_card_preserves_existing_student_progress(
    wired_pool, db_conn, make_user, make_lecture, make_slide, make_quiz, app, patch_supabase,
):
    """The core safety property of soft-hide over hard-delete: a student who
    already graded the card keeps their review_schedule/review_log rows."""
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)
    slide = make_slide(lec)
    make_quiz(slide)
    _enroll(db_conn, prof, lec, student)
    await generate_review_cards({}, str(lec))

    async with _client_as(app, _student_user(student)) as client:
        queue = (await client.get("/api/v1/review/queue")).json()
        card_id = queue["cards"][0]["card_id"]
        await client.post(f"/api/v1/review/{card_id}/grade", json={"rating": 3})

    async with _client_as(app, _professor_user(prof)) as client:
        await client.post(f"/api/v1/review/cards/{card_id}/hide")

    with db_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM review_log WHERE card_id = %s", (card_id,))
        assert cur.fetchone()[0] == 1
        cur.execute("SELECT reps FROM review_schedule WHERE card_id = %s", (card_id,))
        assert cur.fetchone()[0] == 1
        cur.execute("SELECT hidden_at IS NOT NULL FROM review_cards WHERE id = %s", (card_id,))
        assert cur.fetchone()[0] is True


async def test_unhide_restores_card_to_queue(
    wired_pool, db_conn, make_user, make_lecture, make_slide, make_quiz, app, patch_supabase,
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)
    slide = make_slide(lec)
    make_quiz(slide)
    _enroll(db_conn, prof, lec, student)
    await generate_review_cards({}, str(lec))

    async with _client_as(app, _professor_user(prof)) as client:
        cards = (await client.get(f"/api/v1/review/lecture/{lec}/cards")).json()["cards"]
        card_id = cards[0]["card_id"]
        await client.post(f"/api/v1/review/cards/{card_id}/hide")
        r = await client.post(f"/api/v1/review/cards/{card_id}/unhide")
        assert r.json() == {"card_id": card_id, "hidden": False}

    async with _client_as(app, _student_user(student)) as client:
        r = await client.get("/api/v1/review/queue")
        assert r.json()["total_due"] == 1


async def test_hidden_card_never_activates_for_a_new_student(
    wired_pool, db_conn, make_user, make_lecture, make_slide, make_quiz, app, patch_supabase,
):
    """A card hidden before a student ever sees it must not be lazily
    activated into their schedule either (the _activate_new_cards path)."""
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)
    slide = make_slide(lec)
    make_quiz(slide)
    _enroll(db_conn, prof, lec, student)
    await generate_review_cards({}, str(lec))

    async with _client_as(app, _professor_user(prof)) as client:
        cards = (await client.get(f"/api/v1/review/lecture/{lec}/cards")).json()["cards"]
        card_id = cards[0]["card_id"]
        await client.post(f"/api/v1/review/cards/{card_id}/hide")

    async with _client_as(app, _student_user(student)) as client:
        r = await client.get("/api/v1/review/queue")
        assert r.json()["total_due"] == 0

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM review_schedule WHERE card_id = %s AND user_id = %s",
            (card_id, str(student)),
        )
        assert cur.fetchone()[0] == 0  # never activated at all


async def test_non_owner_professor_gets_403_on_hide(
    wired_pool, db_conn, make_user, make_lecture, make_slide, make_quiz, app, patch_supabase,
):
    owner = make_user(role="professor")
    other = make_user(role="professor")
    lec = make_lecture(owner)
    slide = make_slide(lec)
    make_quiz(slide)
    await generate_review_cards({}, str(lec))

    async with _client_as(app, _professor_user(owner)) as client:
        card_id = (await client.get(f"/api/v1/review/lecture/{lec}/cards")).json()["cards"][0]["card_id"]

    async with _client_as(app, _professor_user(other)) as client:
        r = await client.post(f"/api/v1/review/cards/{card_id}/hide")
        assert r.status_code == 403


async def test_hide_nonexistent_card_returns_404(
    wired_pool, db_conn, make_user, app, patch_supabase,
):
    prof = make_user(role="professor")
    async with _client_as(app, _professor_user(prof)) as client:
        r = await client.post(f"/api/v1/review/cards/{uuid.uuid4()}/hide")
        assert r.status_code == 404
