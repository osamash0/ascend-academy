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
        return {"reply": "Stubbed reply.", "citations": []}

    async def _insights(*a, **k):
        return {"summary": "ok", "suggestions": ["x"]}

    # The v1 ai_content endpoint resolves these symbols through the service
    # modules (tutor_service / chat_service), not on the router module itself.
    from backend.services.ai import tutor_service, chat_service
    monkeypatch.setattr(tutor_service, "generate_summary", _summary)
    monkeypatch.setattr(tutor_service, "generate_quiz", _quiz)
    monkeypatch.setattr(tutor_service, "generate_analytics_insights", _insights)
    # process_chat_request is the entrypoint the /chat endpoint calls; it returns
    # the full reply envelope.
    async def _process_chat(*a, **k):
        return {"reply": "Stubbed reply.", "citations": []}
    monkeypatch.setattr(chat_service, "process_chat_request", _process_chat)
    # is_metadata_slide lives in tutor_service's namespace (imported there).
    monkeypatch.setattr(
        tutor_service, "is_metadata_slide", lambda *a, **k: {"is_metadata": False}
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
        # is_metadata_slide is resolved inside tutor_service (where the
        # short-circuit lives), so patch it there.
        from backend.services.ai import tutor_service

        monkeypatch.setattr(
            tutor_service, "is_metadata_slide", lambda *a, **k: {"is_metadata": True}
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
        # is_metadata_slide is resolved inside tutor_service (where the
        # short-circuit lives), so patch it there.
        from backend.services.ai import tutor_service

        monkeypatch.setattr(
            tutor_service, "is_metadata_slide", lambda *a, **k: {"is_metadata": True}
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
        # ChatResponse now carries an optional session_id field in the envelope.
        body = r.json()
        assert body["reply"] == "Stubbed reply."
        assert body["citations"] == []

    def test_empty_user_message_validation(self, app, professor_user, stub_ai):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/ai/chat",
            json={"slide_text": "ctx", "user_message": ""},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 422
