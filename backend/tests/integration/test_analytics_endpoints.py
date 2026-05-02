"""Integration tests for /api/analytics/* endpoints.

These exercise the full FastAPI stack but with a fake Supabase client
and stubbed authentication.
"""
import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token


def _seed_lecture(fake, lecture_id, professor_id):
    fake.seed(
        "lectures",
        [
            {
                "id": lecture_id,
                "professor_id": professor_id,
                "title": "Test Lecture",
                "description": "",
                "total_slides": 3,
                "created_at": "2026-01-01",
                "pdf_url": None,
            }
        ],
    )


class TestOverviewEndpoint:
    def test_404_when_lecture_missing(self, app, professor_user):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/lecture/missing-id/overview",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 404

    def test_403_when_other_professor(self, app, patch_supabase, professor_user, other_professor_user):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: other_professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/lecture/L1/overview",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 403

    def test_200_for_owner(self, app, patch_supabase, professor_user):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        # Seed slides + progress + events for the owner
        patch_supabase.seed("slides", [
            {"id": "s1", "lecture_id": "L1", "slide_number": 1, "title": "T1"},
        ])
        patch_supabase.seed("student_progress", [])
        patch_supabase.seed("learning_events", [])
        patch_supabase.seed("quiz_questions", [])

        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/lecture/L1/overview",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert "data" in body

    def test_unauthenticated_401(self, app):
        client = TestClient(app)
        r = client.get("/api/analytics/lecture/L1/overview")
        # No Authorization header → HTTPBearer auto-error → 403 (FastAPI default)
        assert r.status_code in (401, 403)


class TestDropoffEndpoint:
    def test_owner_sees_dropoff(self, app, patch_supabase, professor_user):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        patch_supabase.seed("slides", [
            {"id": "s1", "lecture_id": "L1", "slide_number": 1, "title": "T1"},
            {"id": "s2", "lecture_id": "L1", "slide_number": 2, "title": "T2"},
        ])
        patch_supabase.seed("student_progress", [
            {"user_id": "u1", "lecture_id": "L1", "last_slide_viewed": 1, "completed_at": None,
             "completed_slides": [1], "quiz_score": 0,
             "total_questions_answered": 0, "correct_answers": 0},
        ])
        patch_supabase.seed("learning_events", [])

        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/lecture/L1/dropoff",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        data = r.json()["data"]
        assert isinstance(data, list)


class TestAIQueriesEndpoint:
    def test_returns_envelope(self, app, patch_supabase, professor_user):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        patch_supabase.seed("slides", [])
        patch_supabase.seed("learning_events", [])

        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/lecture/L1/ai-queries",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        body = r.json()
        assert set(body.keys()) >= {"success", "data"}
