"""Integration tests for the review API (backend/api/v1/review.py) against a
REAL Postgres (testcontainers + all migrations) — the queue/grade/stats SQL
is complex enough that mocking the connection would test little of value.

Uses httpx.AsyncClient + ASGITransport (NOT fastapi.testclient.TestClient):
TestClient bridges sync-call-sites to the ASGI app via its own internal
event-loop portal, which runs the app (and its asyncpg pool operations) on a
DIFFERENT loop than the one this async test / the `wired_pool` fixture runs
on — asyncpg connections are loop-bound, so that combination raises
`InterfaceError: cannot perform operation: another operation is in progress`
the moment a request and a direct `await` both touch the pool. ASGITransport
calls the app in-process on the CALLER's own event loop, avoiding this.

Card generation (card_factory.generate_review_cards) is called directly
(it's an Arq job function, not an HTTP endpoint); the HTTP endpoints
themselves are exercised through the real FastAPI app, with `verify_token`
overridden to a real `auth.users` row created via `make_user`
(review_schedule/review_log FK to auth.users, so a fake UUID would 500).

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


def _client_as(app, student_uid: uuid.UUID) -> AsyncClient:
    from backend.core.auth_middleware import verify_token

    app.dependency_overrides[verify_token] = lambda: _student_user(student_uid)
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_queue_activates_and_returns_due_cards(
    wired_pool, db_conn, make_user, make_lecture, make_slide, make_quiz, app, patch_supabase,
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)
    slide = make_slide(lec)
    make_quiz(slide)
    _enroll(db_conn, prof, lec, student)

    report = await generate_review_cards({}, str(lec))
    assert report["quiz_cards"] == 1

    async with _client_as(app, student) as client:
        r = await client.get("/api/v1/review/queue")
        assert r.status_code == 200
        body = r.json()
        assert body["total_due"] == 1
        assert body["cards"][0]["lecture_id"] == str(lec)
        assert body["cards"][0]["source_type"] == "quiz_question"
        assert "question" in body["cards"][0]["front"]


async def test_unenrolled_student_gets_empty_queue(
    wired_pool, db_conn, make_user, make_lecture, make_slide, make_quiz, app, patch_supabase,
):
    prof = make_user(role="professor")
    outsider = make_user(role="student")
    lec = make_lecture(prof)
    slide = make_slide(lec)
    make_quiz(slide)
    await generate_review_cards({}, str(lec))
    # outsider is never enrolled

    async with _client_as(app, outsider) as client:
        r = await client.get("/api/v1/review/queue")
        assert r.status_code == 200
        assert r.json()["total_due"] == 0


async def test_grade_advances_schedule_and_logs(
    wired_pool, db_conn, make_user, make_lecture, make_slide, make_quiz, app, patch_supabase,
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)
    slide = make_slide(lec)
    make_quiz(slide)
    _enroll(db_conn, prof, lec, student)
    await generate_review_cards({}, str(lec))

    async with _client_as(app, student) as client:
        queue = (await client.get("/api/v1/review/queue")).json()
        card_id = queue["cards"][0]["card_id"]

        r = await client.post(f"/api/v1/review/{card_id}/grade", json={"rating": 3, "elapsed_ms": 1200})
        assert r.status_code == 200
        body = r.json()
        assert body["state"] == "learning"  # first successful rep, not yet graduated
        assert body["interval_days"] == pytest.approx(1.0)

        with db_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM review_log WHERE card_id = %s", (card_id,))
            assert cur.fetchone()[0] == 1
            cur.execute("SELECT reps, state FROM review_schedule WHERE card_id = %s", (card_id,))
            reps, state = cur.fetchone()
            assert reps == 1 and state == "learning"

        # Graded card should no longer be due today (due_at pushed ~1 day out).
        r2 = await client.get("/api/v1/review/queue")
        assert r2.json()["total_due"] == 0


async def test_grade_rejects_invalid_rating(
    wired_pool, db_conn, make_user, make_lecture, make_slide, make_quiz, app, patch_supabase,
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)
    slide = make_slide(lec)
    make_quiz(slide)
    _enroll(db_conn, prof, lec, student)
    await generate_review_cards({}, str(lec))

    async with _client_as(app, student) as client:
        queue = (await client.get("/api/v1/review/queue")).json()
        card_id = queue["cards"][0]["card_id"]

        r = await client.post(f"/api/v1/review/{card_id}/grade", json={"rating": 7})
        assert r.status_code == 400


async def test_stats_reflects_retention_and_due_count(
    wired_pool, db_conn, make_user, make_lecture, make_slide, make_quiz, app, patch_supabase,
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)
    slide = make_slide(lec)
    make_quiz(slide)
    _enroll(db_conn, prof, lec, student)
    await generate_review_cards({}, str(lec))

    async with _client_as(app, student) as client:
        queue = (await client.get("/api/v1/review/queue")).json()
        card_id = queue["cards"][0]["card_id"]
        await client.post(f"/api/v1/review/{card_id}/grade", json={"rating": 4})

        r = await client.get("/api/v1/review/stats")
        assert r.status_code == 200
        body = r.json()
        assert body["reviews_last_30d"] == 1
        assert body["retention_pct"] == 100.0
        assert body["streak"] == 1


async def test_suspend_removes_card_from_queue(
    wired_pool, db_conn, make_user, make_lecture, make_slide, make_quiz, app, patch_supabase,
):
    prof = make_user(role="professor")
    student = make_user(role="student")
    lec = make_lecture(prof)
    slide = make_slide(lec)
    make_quiz(slide)
    _enroll(db_conn, prof, lec, student)
    await generate_review_cards({}, str(lec))

    async with _client_as(app, student) as client:
        queue = (await client.get("/api/v1/review/queue")).json()
        card_id = queue["cards"][0]["card_id"]

        r = await client.post(f"/api/v1/review/cards/{card_id}/suspend")
        assert r.status_code == 200
        assert r.json()["suspended"] is True

        r2 = await client.get("/api/v1/review/queue")
        assert r2.json()["total_due"] == 0


async def test_card_factory_is_idempotent(make_user, make_lecture, make_slide, make_quiz, wired_pool):
    prof = make_user(role="professor")
    lec = make_lecture(prof)
    slide = make_slide(lec)
    make_quiz(slide)

    first = await generate_review_cards({}, str(lec))
    second = await generate_review_cards({}, str(lec))
    assert first["quiz_cards"] == 1
    assert second["quiz_cards"] == 0  # already exists, ON CONFLICT DO NOTHING
