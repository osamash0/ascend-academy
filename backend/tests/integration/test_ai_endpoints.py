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


class TestCreateSessionVisibility:
    """POST /ai/sessions must not bind a session to a lecture the caller cannot
    read — a private student upload owned by someone else. The lecture-id check
    used to be existence only, so the session became a side door into
    /ai/chat's history path."""

    OWNER = "00000000-0000-0000-0000-000000000002"

    def _seed(self, monkeypatch, fake_supabase):
        from backend.api.v1 import ai_content
        monkeypatch.setattr(ai_content, "supabase_admin", fake_supabase, raising=True)
        fake_supabase.seed("lectures", [{
            "id": "L-private", "professor_id": None, "pdf_hash": "h",
            "visibility": "private_student", "student_owner_id": self.OWNER,
        }])

    def _stub_memory(self, monkeypatch):
        from backend.services import chat_memory

        async def _create(user_id, lecture_id=None, title=None):
            return "sess-1"

        async def _meta(session_id):
            return {"id": "sess-1", "user_id": "u", "lecture_id": "L-private",
                    "title": "t", "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00"}

        monkeypatch.setattr(chat_memory, "create_session", _create)
        monkeypatch.setattr(chat_memory, "get_session_metadata", _meta)

    def test_other_student_gets_403_for_private_upload(self, app, fake_supabase, monkeypatch):
        self._seed(monkeypatch, fake_supabase)
        self._stub_memory(monkeypatch)
        from backend.tests.conftest import _user
        app.dependency_overrides[verify_token] = lambda: _user(
            "student", "00000000-0000-0000-0000-000000000009")
        r = TestClient(app).post(
            "/api/v1/ai/sessions", json={"lecture_id": "L-private"},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 403

    def test_owner_can_create_session_for_own_private_upload(self, app, fake_supabase, monkeypatch):
        self._seed(monkeypatch, fake_supabase)
        self._stub_memory(monkeypatch)
        from backend.tests.conftest import _user
        app.dependency_overrides[verify_token] = lambda: _user("student", self.OWNER)
        r = TestClient(app).post(
            "/api/v1/ai/sessions", json={"lecture_id": "L-private"},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200, r.text
