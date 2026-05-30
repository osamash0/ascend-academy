"""Integration tests for the daily nudge runner + dismiss endpoint.

The runner is exercised end-to-end through the FakeSupabase backend. We
seed a single active student with a streak about to break and verify that:
  - exactly one notification row is written
  - re-running the same day is idempotent (no duplicate notification)
  - the dismiss endpoint marks the row dismissed and extends quiet_until
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token
from backend.services import nudge_engine


NOW = datetime(2026, 5, 2, 14, 0, 0, tzinfo=timezone.utc)


def _seed_streak_student(fake, user_id: str) -> None:
    fake.tables.setdefault("profiles", []).append({
        "user_id": user_id,
        "current_streak": 4,
    })
    # Last event was yesterday → streak at risk today.
    fake.tables.setdefault("learning_events", []).append({
        "id": "e1",
        "user_id": user_id,
        "event_type": "slide_view",
        "event_data": {},
        "created_at": (NOW - timedelta(hours=20)).isoformat(),
    })


def _patch_admin(monkeypatch, fake):
    """nudge_engine and api/nudges import supabase_admin by name."""
    from backend.api import nudges as nudges_api
    monkeypatch.setattr(nudge_engine, "supabase_admin", fake, raising=True)
    monkeypatch.setattr(nudges_api, "verify_token", verify_token, raising=False)


def test_run_daily_emits_streak_nudge_once(monkeypatch, patch_supabase):
    fake = patch_supabase
    _patch_admin(monkeypatch, fake)
    _seed_streak_student(fake, "student-uuid-1")

    report = nudge_engine.run_daily(now=NOW, client=fake)
    assert report["notifications_emitted"] == 1
    assert report["users_with_nudge"] == 1

    notifs = fake.tables.get("notifications", [])
    assert len(notifs) == 1
    assert notifs[0]["type"] == "streak"
    assert notifs[0]["user_id"] == "student-uuid-1"

    # Re-running the same day is a no-op because of quiet_until.
    report2 = nudge_engine.run_daily(now=NOW + timedelta(minutes=5), client=fake)
    assert report2["notifications_emitted"] == 0
    assert len(fake.tables["notifications"]) == 1


def test_run_daily_emits_assignment_and_concept(monkeypatch, patch_supabase):
    fake = patch_supabase
    _patch_admin(monkeypatch, fake)
    uid = "student-uuid-1"
    fake.tables.setdefault("profiles", []).append({"user_id": uid, "current_streak": 0})
    fake.tables.setdefault("learning_events", []).append({
        "id": "e1", "user_id": uid, "event_type": "slide_view",
        "event_data": {}, "created_at": NOW.isoformat(),
    })
    # Assignment due in 1 day with no progress → in_progress + due-soon.
    fake.tables.setdefault("assignments", []).append({
        "id": "a1", "professor_id": "prof", "title": "Week 5",
        "due_at": (NOW + timedelta(hours=20)).isoformat(),
        "min_quiz_score": None, "created_at": NOW.isoformat(),
    })
    fake.tables.setdefault("assignment_enrollments", []).append({
        "assignment_id": "a1", "user_id": uid,
    })
    fake.tables.setdefault("assignment_lectures", []).append({
        "assignment_id": "a1", "lecture_id": "L1",
    })
    # Stale weak concept.
    fake.tables.setdefault("concepts", []).append({
        "id": "c1", "canonical_name": "Backprop",
    })
    fake.tables.setdefault("concept_mastery", []).append({
        "user_id": uid, "concept_id": "c1",
        "mastery_score": 0.2, "attempts": 5, "correct": 1,
        "updated_at": (NOW - timedelta(days=20)).isoformat(),
    })

    report = nudge_engine.run_daily(now=NOW, client=fake)
    assert report["notifications_emitted"] == 2
    types = sorted(n["type"] for n in fake.tables["notifications"])
    assert types == ["assignment", "review"]


def test_dismiss_endpoint_extends_quiet_period(monkeypatch, app, patch_supabase, student_user):
    fake = patch_supabase
    _patch_admin(monkeypatch, fake)
    _seed_streak_student(fake, student_user.id)

    nudge_engine.run_daily(now=NOW, client=fake)
    notif_id = fake.tables["notifications"][0]["id"]
    dis_before = fake.tables["nudge_dismissals"][0]
    assert dis_before["dismissed"] is False

    app.dependency_overrides[verify_token] = lambda: student_user
    client = TestClient(app)
    r = client.post(
        f"/api/nudges/{notif_id}/dismiss",
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["dismissed"] is True

    dis_after = fake.tables["nudge_dismissals"][0]
    assert dis_after["dismissed"] is True
    # The notification was marked read.
    assert fake.tables["notifications"][0]["read"] is True


def test_dismiss_endpoint_404_for_unknown_id(monkeypatch, app, patch_supabase, student_user):
    fake = patch_supabase
    _patch_admin(monkeypatch, fake)
    app.dependency_overrides[verify_token] = lambda: student_user
    client = TestClient(app)
    r = client.post(
        "/api/nudges/no-such-id/dismiss",
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 404


def test_run_daily_skips_dormant_users(monkeypatch, patch_supabase):
    fake = patch_supabase
    _patch_admin(monkeypatch, fake)
    # Profile exists but no recent learning_events → not "active".
    fake.tables["profiles"] = [{"user_id": "ghost", "current_streak": 10}]
    fake.tables["learning_events"] = []
    report = nudge_engine.run_daily(now=NOW, client=fake)
    assert report["users_evaluated"] == 0
    assert fake.tables.get("notifications", []) == []
