"""Integration tests for POST /api/analytics/lecture/{id}/ask."""
import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token, require_professor


def _seed_lecture(fake, lecture_id, professor_id):
    fake.seed("lectures", [{
        "id": lecture_id, "professor_id": professor_id, "title": "L",
        "description": "", "total_slides": 1, "created_at": "2026-01-01",
        "pdf_url": None,
    }])


@pytest.fixture
def stub_ask(monkeypatch):
    """Replace the LLM-driven pipeline with a deterministic stub."""
    from backend.services.ai import ask_data

    async def fake_ask(*, lecture_id, question, token, ai_model="cerebras"):
        return {
            "intent": "completion_count",
            "answer_text": f"echo: {question}",
            "table": [{"metric": "x", "value": 1}],
            "chart": None,
            "debug": {},
        }

    monkeypatch.setattr("backend.api.analytics.ask_lecture_data", fake_ask)
    return fake_ask


class TestAskEndpointOwnership:
    def test_403_when_other_professor(self, app, patch_supabase, professor_user, other_professor_user, stub_ask):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: other_professor_user
        app.dependency_overrides[require_professor] = lambda: other_professor_user
        client = TestClient(app)
        r = client.post(
            "/api/analytics/lecture/L1/ask",
            json={"question": "How many students finished?"},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 403

    def test_404_when_lecture_missing(self, app, patch_supabase, professor_user, stub_ask):
        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/analytics/lecture/nope/ask",
            json={"question": "anything"},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 404

    def test_owner_gets_answer(self, app, patch_supabase, professor_user, stub_ask):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/analytics/lecture/L1/ask",
            json={"question": "How many students finished?"},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert body["data"]["intent"] == "completion_count"
        assert "echo:" in body["data"]["answer_text"]
        assert isinstance(body["data"]["suggested_questions"], list) and body["data"]["suggested_questions"]

    def test_empty_question_rejected(self, app, patch_supabase, professor_user, stub_ask):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/analytics/lecture/L1/ask",
            json={"question": "   "},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 400

    def test_oversize_question_rejected(self, app, patch_supabase, professor_user, stub_ask):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/analytics/lecture/L1/ask",
            json={"question": "x" * 1001},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 400


class TestAskSuggestionsEndpoint:
    def test_403_for_other_professor(self, app, patch_supabase, professor_user, other_professor_user):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: other_professor_user
        app.dependency_overrides[require_professor] = lambda: other_professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/lecture/L1/ask/suggestions",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 403

    def test_owner_gets_questions(self, app, patch_supabase, professor_user):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/lecture/L1/ask/suggestions",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        qs = r.json()["data"]["questions"]
        assert isinstance(qs, list) and len(qs) > 0
