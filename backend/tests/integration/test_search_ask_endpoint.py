"""Integration test for POST /api/search/ask's ai_model default.

Regression coverage for a pre-existing bug (unrelated to any recent audit
work): AskRequest.ai_model defaulted to "llama3", a special-cased local
Ollama path (orchestrator.py's _call_provider) rather than a cloud provider
key - it failed wherever no local Ollama server was running, i.e. every real
deployment, silently degrading the ⌘K "Ask across course" feature to a
generic error reply for every user. Fixed by changing the default to
"cerebras" (QUALITY_CHAIN's head, confirmed reachable) and by having the
frontend always send the caller's actual selected model.
"""
import pytest

from backend.core.auth_middleware import verify_token


@pytest.fixture
def stub_ask_course(monkeypatch):
    """Replace search_service.ask_course with a stub that records the
    ai_model it was called with, so this test doesn't need real course
    enrollment/retrieval data - only the request-parsing default matters."""
    captured = {}

    async def _fake_ask_course(*args, **kwargs):
        # Router calls ask_course(uid, is_prof, course_id, question, ...)
        # positionally, with ai_model passed as a keyword.
        captured["ai_model"] = kwargs.get("ai_model")
        return {"reply": "ok", "citations": [], "grounded": True}

    monkeypatch.setattr("backend.api.v1.search.search_service.ask_course", _fake_ask_course)
    return captured


def test_ask_endpoint_default_ai_model_is_not_ollama_only(app, professor_user, stub_ask_course):
    from fastapi.testclient import TestClient

    app.dependency_overrides[verify_token] = lambda: professor_user
    client = TestClient(app)

    resp = client.post("/api/v1/search/ask", json={
        "course_id": "c1",
        "question": "What is X?",
        # ai_model deliberately omitted - this is the exact shape the ⌘K
        # palette's request used to send before the frontend fix.
    })

    assert resp.status_code == 200
    assert stub_ask_course["ai_model"] != "llama3"
    assert stub_ask_course["ai_model"] == "cerebras"


def test_ask_endpoint_still_honours_an_explicit_ai_model(app, professor_user, stub_ask_course):
    from fastapi.testclient import TestClient

    app.dependency_overrides[verify_token] = lambda: professor_user
    client = TestClient(app)

    resp = client.post("/api/v1/search/ask", json={
        "course_id": "c1",
        "question": "What is X?",
        "ai_model": "openai",
    })

    assert resp.status_code == 200
    assert stub_ask_course["ai_model"] == "openai"
