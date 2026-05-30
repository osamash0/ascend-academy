"""Integration tests for /api/schedule/* endpoints."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token


def _auth_as(app, user) -> None:
    app.dependency_overrides[verify_token] = lambda: user


def _seed_lecture(fake, lid: str, professor_id: str = "prof-1", total: int = 10) -> None:
    fake.tables.setdefault("lectures", []).append({
        "id": lid,
        "professor_id": professor_id,
        "title": f"Lecture {lid}",
        "total_slides": total,
    })


def _seed_progress(fake, user_id: str, lid: str, *, completed_count: int = 1) -> None:
    fake.tables.setdefault("student_progress", []).append({
        "user_id": user_id,
        "lecture_id": lid,
        "completed_slides": list(range(1, completed_count + 1)),
        "last_slide_viewed": completed_count,
        "completed_at": None,
        "created_at": "2026-04-01T00:00:00+00:00",
    })


class TestGetMyPlan:
    def test_returns_seven_days_default(self, app, patch_supabase, student_user):
        _seed_lecture(patch_supabase, "L1")
        _seed_progress(patch_supabase, student_user.id, "L1", completed_count=2)
        _auth_as(app, student_user)
        client = TestClient(app)

        r = client.get("/api/schedule/me", headers={"Authorization": "Bearer t"})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert len(data["days"]) == 7
        assert data["budget_minutes"] == 30

    def test_days_param_clamped(self, app, patch_supabase, student_user):
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get("/api/schedule/me?days=3", headers={"Authorization": "Bearer t"})
        assert r.status_code == 200
        assert len(r.json()["data"]["days"]) == 3

        r = client.get("/api/schedule/me?days=99", headers={"Authorization": "Bearer t"})
        # Pydantic Query ge/le rejects 99
        assert r.status_code == 422

    def test_empty_state_is_empty_days(self, app, patch_supabase, student_user):
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get("/api/schedule/me", headers={"Authorization": "Bearer t"})
        assert r.status_code == 200
        data = r.json()["data"]
        assert all(d["items"] == [] for d in data["days"])

    def test_in_progress_lecture_appears(self, app, patch_supabase, student_user):
        _seed_lecture(patch_supabase, "L1")
        _seed_progress(patch_supabase, student_user.id, "L1", completed_count=3)
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get("/api/schedule/me", headers={"Authorization": "Bearer t"})
        data = r.json()["data"]
        all_items = [i for d in data["days"] for i in d["items"]]
        assert any(i["lecture_id"] == "L1" for i in all_items)


class TestMarkDone:
    def test_round_trip_removes_from_today(self, app, patch_supabase, student_user):
        _seed_lecture(patch_supabase, "L1")
        _seed_progress(patch_supabase, student_user.id, "L1", completed_count=2)
        _auth_as(app, student_user)
        client = TestClient(app)

        r = client.get("/api/schedule/me", headers={"Authorization": "Bearer t"})
        items_today = r.json()["data"]["days"][0]["items"]
        assert items_today, "expected at least one item today"
        item_id = items_today[0]["item_id"]

        d = client.post(
            f"/api/schedule/items/{item_id}/done",
            headers={"Authorization": "Bearer t"},
        )
        assert d.status_code == 200, d.text
        assert d.json()["data"]["completed"] is True

        # Row written
        rows = patch_supabase.tables.get("schedule_item_completions", [])
        assert len(rows) == 1
        assert rows[0]["user_id"] == student_user.id
        assert rows[0]["lecture_id"] == "L1"

        # Re-fetch — item must no longer be in today's list AND must not
        # reappear on any upcoming day inside the cooldown window.
        r2 = client.get("/api/schedule/me", headers={"Authorization": "Bearer t"})
        days = r2.json()["data"]["days"]
        all_lecture_ids = [i["lecture_id"] for d in days for i in d["items"]]
        assert "L1" not in all_lecture_ids

    def test_done_is_idempotent(self, app, patch_supabase, student_user):
        _seed_lecture(patch_supabase, "L1")
        _seed_progress(patch_supabase, student_user.id, "L1", completed_count=2)
        _auth_as(app, student_user)
        client = TestClient(app)

        r = client.get("/api/schedule/me", headers={"Authorization": "Bearer t"})
        item_id = r.json()["data"]["days"][0]["items"][0]["item_id"]

        for _ in range(3):
            d = client.post(
                f"/api/schedule/items/{item_id}/done",
                headers={"Authorization": "Bearer t"},
            )
            assert d.status_code == 200

        # Should still be exactly one row (upsert).
        rows = patch_supabase.tables.get("schedule_item_completions", [])
        assert len(rows) == 1

    def test_malformed_item_id_400(self, app, patch_supabase, student_user):
        _auth_as(app, student_user)
        client = TestClient(app)
        d = client.post(
            "/api/schedule/items/garbage/done",
            headers={"Authorization": "Bearer t"},
        )
        assert d.status_code == 400


class TestAssignmentPriority:
    def test_assignment_without_progress_row_still_appears(self, app, patch_supabase, student_user):
        # Critical case: a freshly enrolled student has NO student_progress
        # row for an assigned lecture. The plan must still surface it.
        _seed_lecture(patch_supabase, "Lnew")
        a_id = "Anew"
        due = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        patch_supabase.tables.setdefault("assignments", []).append({
            "id": a_id, "title": "Brand-new assignment",
            "due_at": due, "min_quiz_score": None,
        })
        patch_supabase.tables.setdefault("assignment_lectures", []).append({
            "assignment_id": a_id, "lecture_id": "Lnew",
        })
        patch_supabase.tables.setdefault("assignment_enrollments", []).append({
            "assignment_id": a_id, "user_id": student_user.id,
        })
        # NOTE: deliberately no student_progress row.
        _auth_as(app, student_user)
        client = TestClient(app)

        r = client.get("/api/schedule/me", headers={"Authorization": "Bearer t"})
        data = r.json()["data"]
        all_items = [i for d in data["days"] for i in d["items"]]
        a_items = [i for i in all_items if i["priority"] == "assignment"]
        assert any(i["lecture_id"] == "Lnew" for i in a_items), \
            "Assignment lecture must surface even without a student_progress row"
        assert data["has_assignments"] is True

    def test_assignment_lecture_marked_assignment(self, app, patch_supabase, student_user):
        _seed_lecture(patch_supabase, "L1")
        _seed_progress(patch_supabase, student_user.id, "L1", completed_count=0)
        a_id = "A1"
        due = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        patch_supabase.tables.setdefault("assignments", []).append({
            "id": a_id, "title": "Week 1", "due_at": due, "min_quiz_score": None,
        })
        patch_supabase.tables.setdefault("assignment_lectures", []).append({
            "assignment_id": a_id, "lecture_id": "L1",
        })
        patch_supabase.tables.setdefault("assignment_enrollments", []).append({
            "assignment_id": a_id, "user_id": student_user.id,
        })
        _auth_as(app, student_user)
        client = TestClient(app)

        r = client.get("/api/schedule/me", headers={"Authorization": "Bearer t"})
        data = r.json()["data"]
        all_items = [i for d in data["days"] for i in d["items"]]
        a_items = [i for i in all_items if i["priority"] == "assignment"]
        assert any(i["lecture_id"] == "L1" for i in a_items)
        assert data["has_assignments"] is True
