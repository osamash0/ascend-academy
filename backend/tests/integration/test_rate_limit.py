"""Integration tests for SlowAPI rate limiting on selected endpoints."""
import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token


@pytest.fixture
def stub_ai(monkeypatch):
    async def _chat(*a, **k):
        return {"reply": "ok", "citations": []}

    from backend.api import ai_content as mod

    monkeypatch.setattr(mod, "chat_with_lecture", _chat)


def test_chat_rate_limit_kicks_in(app, professor_user, stub_ai):
    app.dependency_overrides[verify_token] = lambda: professor_user
    client = TestClient(app)
    last_status = None
    for _ in range(35):
        r = client.post(
            "/api/ai/chat",
            json={"slide_text": "x", "user_message": "hi"},
            headers={"Authorization": "Bearer x"},
        )
        last_status = r.status_code
        if r.status_code == 429:
            break
    # Limit is 30/minute; 35 attempts must hit 429
    assert last_status == 429
