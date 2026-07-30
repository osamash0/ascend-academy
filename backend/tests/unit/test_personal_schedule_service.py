"""Unit tests for personal_schedule_service (P4-1 extraction from
analytics_service.py — get_personal_optimal_schedule moved to its own module,
see backend/services/personal_schedule_service.py).

These exercise the real function end-to-end against the in-memory fake
Supabase client (no network), covering: no-data fallback, login-event
exclusion, timezone-offset hour shifting, and the full 24-hour timeline shape.
"""
import pytest

from backend.services import personal_schedule_service as svc
from backend.tests.fake_supabase import FakeSupabaseClient


@pytest.fixture
def fake_client(monkeypatch: pytest.MonkeyPatch) -> FakeSupabaseClient:
    client = FakeSupabaseClient()
    monkeypatch.setattr(
        svc.analytics_service, "get_auth_client", lambda token: client, raising=True
    )
    return client


def test_no_events_returns_not_enough_data(fake_client):
    out = svc.get_personal_optimal_schedule("user-1", token="tok")
    assert out["suggested_hours"] == []
    assert out["peak_hour"] is None
    assert "Not enough data" in out["message"]


def test_login_events_excluded_from_circadian_scoring(fake_client):
    # Only "login" events exist — they must not produce any scored hour.
    fake_client.seed("learning_events", [
        {"user_id": "user-1", "event_type": "login", "event_data": {},
         "created_at": "2024-03-20T10:00:00+00:00"},
    ])
    out = svc.get_personal_optimal_schedule("user-1", token="tok")
    assert out["peak_hour"] is None
    assert out["suggested_hours"] == []


def test_peak_hour_and_accuracy_from_quiz_attempts(fake_client):
    # 10am UTC: 4 correct / 5 attempts -> 80% accuracy, decent intensity.
    # 2am UTC: 1 correct / 5 attempts -> 20% accuracy, should rank lower.
    events = []
    for i in range(5):
        events.append({
            "user_id": "user-1",
            "event_type": "quiz_attempt",
            "event_data": {"correct": i < 4},
            "created_at": f"2024-03-20T10:0{i}:00+00:00",
        })
    for i in range(5):
        events.append({
            "user_id": "user-1",
            "event_type": "quiz_attempt",
            "event_data": {"correct": i < 1},
            "created_at": f"2024-03-20T02:0{i}:00+00:00",
        })
    fake_client.seed("learning_events", events)

    out = svc.get_personal_optimal_schedule("user-1", token="tok")

    assert out["peak_hour"] == 10
    assert out["accuracy_at_peak"] == 80.0
    assert out["energy_pattern"] == "Morning Peak"
    # Full 24-hour timeline, sorted by hour.
    assert len(out["suggested_hours"]) == 24
    assert [h["hour"] for h in out["suggested_hours"]] == list(range(24))
    hour_10 = next(h for h in out["suggested_hours"] if h["hour"] == 10)
    assert hour_10["intensity"] == 5


def test_timezone_offset_shifts_local_hour(fake_client):
    # A single quiz_attempt at 10:00 UTC with a -120 minute offset (client is
    # 2 hours behind UTC) should land in local hour 8, not 10.
    fake_client.seed("learning_events", [
        {"user_id": "user-1", "event_type": "quiz_attempt",
         "event_data": {"correct": True},
         "created_at": "2024-03-20T10:00:00+00:00"},
    ])
    out = svc.get_personal_optimal_schedule(
        "user-1", token="tok", timezone_offset_minutes=120
    )
    assert out["peak_hour"] == 8


def test_only_this_users_events_are_scoped(fake_client):
    fake_client.seed("learning_events", [
        {"user_id": "user-1", "event_type": "quiz_attempt",
         "event_data": {"correct": True},
         "created_at": "2024-03-20T09:00:00+00:00"},
        {"user_id": "other-user", "event_type": "quiz_attempt",
         "event_data": {"correct": True},
         "created_at": "2024-03-20T18:00:00+00:00"},
    ])
    out = svc.get_personal_optimal_schedule("user-1", token="tok")
    assert out["peak_hour"] == 9
