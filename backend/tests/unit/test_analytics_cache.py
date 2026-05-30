"""Tests for the per-feature analytics caching layer."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.services import analytics_cache


def test_get_or_compute_caches_first_result(patch_supabase):
    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"v": calls["n"]}

    a = analytics_cache.get_or_compute("L1", "overview", compute)
    b = analytics_cache.get_or_compute("L1", "overview", compute)

    assert a == {"v": 1}
    assert b == {"v": 1}
    assert calls["n"] == 1
    rows = patch_supabase.tables.get("analytics_cache", [])
    assert len(rows) == 1
    assert rows[0]["lecture_id"] == "L1"
    assert rows[0]["view_name"] == "overview"


def test_invalidate_drops_rows_and_forces_recompute(patch_supabase):
    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"v": calls["n"]}

    analytics_cache.get_or_compute("L1", "overview", compute)
    analytics_cache.get_or_compute("L1", "slides", compute)
    analytics_cache.get_or_compute("L2", "overview", compute)

    deleted = analytics_cache.invalidate("L1")

    # Only L1 rows are dropped; L2 stays.
    remaining = patch_supabase.tables.get("analytics_cache", [])
    assert all(r["lecture_id"] == "L2" for r in remaining)
    assert deleted == 2

    # Next L1 call triggers a recompute; L2 still hits the cache.
    pre = calls["n"]
    analytics_cache.get_or_compute("L1", "overview", compute)
    analytics_cache.get_or_compute("L2", "overview", compute)
    assert calls["n"] == pre + 1


def test_force_refresh_skips_cache(patch_supabase):
    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"v": calls["n"]}

    analytics_cache.get_or_compute("L1", "overview", compute)
    out = analytics_cache.get_or_compute("L1", "overview", compute, force_refresh=True)
    assert out == {"v": 2}
    assert calls["n"] == 2


def test_stale_row_triggers_recompute(patch_supabase):
    """Rows older than ttl_seconds are treated as a miss."""
    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"v": calls["n"]}

    analytics_cache.get_or_compute("L1", "overview", compute, ttl_seconds=60)
    # Manually backdate the row past its TTL.
    rows = patch_supabase.tables["analytics_cache"]
    rows[0]["computed_at"] = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()

    analytics_cache.get_or_compute("L1", "overview", compute, ttl_seconds=60)
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_async_get_or_compute_caches(patch_supabase):
    calls = {"n": 0}

    async def compute():
        calls["n"] += 1
        return {"v": calls["n"]}

    a = await analytics_cache.get_or_compute_async("L1", "dashboard", compute)
    b = await analytics_cache.get_or_compute_async("L1", "dashboard", compute)
    assert a == {"v": 1}
    assert b == {"v": 1}
    assert calls["n"] == 1


def test_event_insert_invalidates_cache(patch_supabase):
    """Writing a learning_event for a lecture must drop its cached rows."""
    from backend.repositories import event_repo

    analytics_cache.get_or_compute("L1", "overview", lambda: {"v": 1})
    assert len(patch_supabase.tables.get("analytics_cache", [])) == 1

    event_repo.insert_event(
        patch_supabase,
        user_id="u1",
        event_type="quiz_attempt",
        event_data={"lectureId": "L1", "questionId": "q1", "correct": True},
    )

    assert patch_supabase.tables.get("analytics_cache", []) == []


def test_overview_endpoint_recomputes_after_invalidation(app, patch_supabase, professor_user):
    """End-to-end: hit, write event → invalidate, hit again → recompute."""
    from fastapi.testclient import TestClient
    from backend.core.auth_middleware import verify_token

    patch_supabase.seed("lectures", [
        {"id": "L1", "professor_id": professor_user.id, "title": "T",
         "description": "", "total_slides": 1, "created_at": "2026-01-01",
         "pdf_url": None},
    ])
    patch_supabase.seed("slides", [
        {"id": "s1", "lecture_id": "L1", "slide_number": 1, "title": "T1"},
    ])
    patch_supabase.seed("student_progress", [
        {"user_id": "u1", "lecture_id": "L1", "completed_at": "2026-01-02",
         "quiz_score": 80, "completed_slides": [1],
         "total_questions_answered": 5, "correct_answers": 4},
    ])
    patch_supabase.seed("learning_events", [])
    patch_supabase.seed("quiz_questions", [])

    app.dependency_overrides[verify_token] = lambda: professor_user
    client = TestClient(app)

    r1 = client.get("/api/analytics/lecture/L1/overview",
                    headers={"Authorization": "Bearer fake-token"})
    assert r1.status_code == 200
    first = r1.json()["data"]
    # Cache row should now exist for the overview view.
    cached = patch_supabase.tables.get("analytics_cache", [])
    assert any(row["view_name"] == "overview" and row["lecture_id"] == "L1" for row in cached)

    # Mutate the underlying data without invalidating — second read should
    # still return the cached payload.
    patch_supabase.tables["student_progress"].append({
        "user_id": "u2", "lecture_id": "L1", "completed_at": None,
        "quiz_score": 0, "completed_slides": [], "total_questions_answered": 0,
        "correct_answers": 0,
    })
    r2 = client.get("/api/analytics/lecture/L1/overview",
                    headers={"Authorization": "Bearer fake-token"})
    assert r2.json()["data"] == first  # served from cache

    # Now write an event via the real repository path → invalidates cache.
    from backend.repositories import event_repo
    event_repo.insert_event(
        patch_supabase, "u2", "slide_view",
        {"lectureId": "L1", "slideId": "s1", "duration_seconds": 30},
    )
    assert patch_supabase.tables.get("analytics_cache", []) == []

    r3 = client.get("/api/analytics/lecture/L1/overview",
                    headers={"Authorization": "Bearer fake-token"})
    third = r3.json()["data"]
    # Now reflects the new student count.
    assert third["total_students"] == 2


def test_refresh_endpoint_invalidates_and_responds(app, patch_supabase, professor_user):
    from fastapi.testclient import TestClient
    from backend.core.auth_middleware import verify_token

    patch_supabase.seed("lectures", [
        {"id": "L1", "professor_id": professor_user.id, "title": "T",
         "description": "", "total_slides": 1, "created_at": "2026-01-01",
         "pdf_url": None},
    ])
    analytics_cache.get_or_compute("L1", "overview", lambda: {"v": 1})
    analytics_cache.get_or_compute("L1", "slides", lambda: [])
    assert len(patch_supabase.tables["analytics_cache"]) == 2

    app.dependency_overrides[verify_token] = lambda: professor_user
    client = TestClient(app)
    r = client.post("/api/analytics/lecture/L1/cache/refresh",
                    headers={"Authorization": "Bearer fake-token"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["data"]["invalidated_rows"] == 2
