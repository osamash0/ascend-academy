"""Integration tests for /api/ai/* endpoints with a fake LLM provider."""
import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token


@pytest.fixture
def stub_ai(monkeypatch):
    """Stub the AI service functions ai_content depends on."""
    async def _summary(*a, **k):
        return "Stubbed summary."

    async def _quiz(*a, **k):
        return {
            "question": "What is X?",
            "options": ["A", "B", "C", "D"],
            "correctAnswer": 0,
        }

    async def _chat(*a, **k):
        return "Stubbed reply."

    async def _insights(*a, **k):
        return {"summary": "ok", "suggestions": ["x"]}

    from backend.api import ai_content as mod
    monkeypatch.setattr(mod, "generate_summary", _summary)
    monkeypatch.setattr(mod, "generate_quiz", _quiz)
    monkeypatch.setattr(mod, "chat_with_lecture", _chat)
    monkeypatch.setattr(mod, "generate_analytics_insights", _insights)
    monkeypatch.setattr(
        mod, "is_metadata_slide", lambda *a, **k: {"is_metadata": False}
    )


class TestSummary:
    def test_happy_path(self, app, professor_user, stub_ai):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/ai/generate-summary",
            json={"slide_text": "Photosynthesis is the process..."},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        assert r.json() == {"summary": "Stubbed summary."}

    def test_empty_text_400(self, app, professor_user, stub_ai):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/ai/generate-summary",
            json={"slide_text": "   "},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 400

    def test_metadata_short_circuit(self, app, professor_user, monkeypatch):
        from backend.api import ai_content as mod

        monkeypatch.setattr(
            mod, "is_metadata_slide", lambda *a, **k: {"is_metadata": True}
        )
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/ai/generate-summary",
            json={"slide_text": "Thank you"},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        assert "administrative" in r.json()["summary"].lower()

    def test_text_too_long_validation(self, app, professor_user, stub_ai):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        big = "a" * 11_000
        r = client.post(
            "/api/ai/generate-summary",
            json={"slide_text": big},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 422


class TestQuiz:
    def test_happy_path(self, app, professor_user, stub_ai):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/ai/generate-quiz",
            json={"slide_text": "Some content."},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        body = r.json()
        assert "question" in body and len(body["options"]) == 4
        assert 0 <= body["correctAnswer"] <= 3

    def test_metadata_returns_placeholder(self, app, professor_user, monkeypatch):
        from backend.api import ai_content as mod

        monkeypatch.setattr(
            mod, "is_metadata_slide", lambda *a, **k: {"is_metadata": True}
        )
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/ai/generate-quiz",
            json={"slide_text": "Thank you"},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["options"] == ["N/A", "N/A", "N/A", "N/A"]


class TestChat:
    def test_happy_path(self, app, professor_user, stub_ai):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/ai/chat",
            json={"slide_text": "ctx", "user_message": "Hello?"},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        assert r.json() == {"reply": "Stubbed reply."}

    def test_empty_user_message_validation(self, app, professor_user, stub_ai):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/ai/chat",
            json={"slide_text": "ctx", "user_message": ""},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 422
