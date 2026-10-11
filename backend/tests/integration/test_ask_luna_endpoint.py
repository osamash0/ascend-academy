"""POST /api/v1/ask-luna — auth, validation, and failure mapping."""
import pytest
from fastapi.testclient import TestClient
from fastapi.security import HTTPAuthorizationCredentials

from backend.api.v1 import ask_luna as router_mod
from backend.core.auth_middleware import require_student
from backend.services.llm_client import LLMBudgetExceededError


@pytest.fixture
def client(app, student_user, monkeypatch):
    app.dependency_overrides[require_student] = lambda: student_user
    app.dependency_overrides[router_mod._security] = lambda: HTTPAuthorizationCredentials(scheme="Bearer", credentials="jwt")
    monkeypatch.setattr(
        router_mod,
        "_load_learner",
        lambda token, uid: ({"current_level": 4, "current_streak": 2, "preferred_language": "de"}, [], "de"),
    )
    return TestClient(app)


def test_returns_validated_parts_in_the_profile_language(client, monkeypatch):
    seen = {}

    async def fake_ask(**kw):
        seen.update(kw)
        return [{"type": "text", "text": "Hallo!"}]

    monkeypatch.setattr(router_mod.ask_luna_service, "ask_luna", fake_ask)
    resp = client.post("/api/v1/ask-luna", json={"question": "Was ist ein JOIN?", "history": [{"role": "user", "content": "hi"}]})
    assert resp.status_code == 200
    assert resp.json() == {"parts": [{"type": "text", "text": "Hallo!"}]}
    assert seen["language"] == "de"  # the saved profile language wins, not the browser
    assert "Level 4" in seen["learner_context"]
    assert seen["history"] == [{"role": "user", "content": "hi"}]


def test_over_budget_is_a_friendly_429(client, monkeypatch):
    async def over(**kw):
        raise LLMBudgetExceededError("cap")

    monkeypatch.setattr(router_mod.ask_luna_service, "ask_luna", over)
    resp = client.post("/api/v1/ask-luna", json={"question": "hi"})
    assert resp.status_code == 429
    assert resp.json()["detail"] == "ask_luna_budget"


def test_provider_failure_is_503_not_500(client, monkeypatch):
    async def boom(**kw):
        raise RuntimeError("all providers down")

    monkeypatch.setattr(router_mod.ask_luna_service, "ask_luna", boom)
    assert client.post("/api/v1/ask-luna", json={"question": "hi"}).status_code == 503


@pytest.mark.parametrize(
    "body",
    [{}, {"question": ""}, {"question": "x" * 2001}, {"question": "hi", "history": [{"role": "system", "content": "x"}]}],
    ids=["missing", "empty", "too-long", "spoofed-system-role"],
)
def test_rejects_bad_requests(client, body):
    assert client.post("/api/v1/ask-luna", json=body).status_code == 422


def test_requires_a_student(app):
    # No override: the real auth dependency must refuse an anonymous caller.
    assert TestClient(app).post("/api/v1/ask-luna", json={"question": "hi"}).status_code in (401, 403)
