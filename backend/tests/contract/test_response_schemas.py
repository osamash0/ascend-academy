"""Contract / snapshot tests for analytics response schemas.

These freeze the JSON shape that the frontend depends on. If the backend
evolves, these tests will fail loudly so the corresponding TypeScript
type / MSW handler can be updated together.
"""
import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token


def _assert_keys_equal(actual: dict, expected: set):
    extra = set(actual.keys()) - expected
    missing = expected - set(actual.keys())
    assert not extra, f"unexpected keys: {extra}"
    assert not missing, f"missing keys: {missing}"


def _seed_minimal(fake, lecture_id, professor_id):
    fake.seed("lectures", [
        {"id": lecture_id, "professor_id": professor_id, "title": "T",
         "description": "", "total_slides": 1, "created_at": "2026-01-01",
         "pdf_url": None}
    ])
    fake.seed("slides", [
        {"id": "s1", "lecture_id": lecture_id, "slide_number": 1,
         "title": "T1", "content_text": "", "summary": ""},
    ])
    fake.seed("student_progress", [
        {"user_id": "u1", "lecture_id": lecture_id, "completed_at": "now",
         "completed_slides": [1], "quiz_score": 80,
         "total_questions_answered": 5, "correct_answers": 4,
         "last_slide_viewed": 1},
    ])
    fake.seed("learning_events", [])
    fake.seed("quiz_questions", [
        {"id": "q1", "slide_id": "s1", "question_text": "Q?",
         "options": ["a", "b", "c", "d"], "correct_answer": 0,
         "lecture_id": lecture_id},
    ])


@pytest.fixture
def auth_client(app, patch_supabase, professor_user):
    _seed_minimal(patch_supabase, "L1", professor_user.id)
    app.dependency_overrides[verify_token] = lambda: professor_user
    return TestClient(app)


class TestAnalyticsContracts:
    def test_overview_envelope(self, auth_client):
        r = auth_client.get(
            "/api/analytics/lecture/L1/overview",
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        body = r.json()
        _assert_keys_equal(body, {"success", "data"})
        assert isinstance(body["data"], dict)

    def test_slides_returns_list(self, auth_client):
        r = auth_client.get(
            "/api/analytics/lecture/L1/slides",
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert isinstance(body["data"], list)

    def test_students_envelope(self, auth_client):
        r = auth_client.get(
            "/api/analytics/lecture/L1/students",
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert isinstance(body["data"], list)
        # If there's at least one row, every required key is present
        for row in body["data"]:
            assert {
                "student_id", "student_name", "progress_percentage",
                "quiz_score", "typology", "ai_interactions", "revisions",
            } <= set(row.keys())
            # Anonymized name format: theme-HEX4
            assert "-" in row["student_name"]

    def test_dropoff_envelope(self, auth_client):
        r = auth_client.get(
            "/api/analytics/lecture/L1/dropoff",
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert isinstance(body["data"], list)
