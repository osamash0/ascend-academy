"""Unit tests for the provider JSON-mode gating added in Foundation Roadmap
P4-3 (backend/services/ai/orchestrator.py: `_call_openai_compat`).

Bulk/quality chains that parse the reply as JSON can now request the
provider's native `response_format={"type": "json_object"}`. Not every
OpenAI-compatible free-tier endpoint supports this, so `_call_openai_compat`
must:
  1. Send the parameter when `json_mode=True` and the provider hasn't
     previously rejected it.
  2. Gracefully retry WITHOUT the parameter, exactly once, when the provider
     errors in a way that looks like a rejection of the parameter itself —
     and remember not to ask that provider again this process lifetime.
  3. Leave non-JSON-mode callers (`json_mode=False`, the default) completely
     unaffected — no `response_format` key is ever sent.
  4. Let unrelated errors (rate limits, auth, network) propagate untouched
     instead of being swallowed by the fallback path.
"""
from __future__ import annotations

import pytest

from backend.services.ai import orchestrator as orch


class _FakeCompletions:
    """Records every `create(**kwargs)` call and drives canned behavior.

    ``behavior`` is a callable invoked with the kwargs dict; it either
    returns a fake response object or raises.
    """

    def __init__(self, behavior):
        self.behavior = behavior
        self.calls: list = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.behavior(kwargs)


class _FakeClient:
    def __init__(self, behavior):
        self.chat = type("_Chat", (), {"completions": _FakeCompletions(behavior)})()


def _ok_response(content: str = '{"ok": true}'):
    class _Msg:
        pass

    class _Choice:
        pass

    class _Resp:
        pass

    msg = _Msg()
    msg.content = content
    choice = _Choice()
    choice.message = msg
    resp = _Resp()
    resp.choices = [choice]
    return resp


@pytest.fixture(autouse=True)
def _reset_json_mode_cache():
    """`_JSON_MODE_UNSUPPORTED` is process-lifetime state; isolate tests."""
    orch._JSON_MODE_UNSUPPORTED.clear()
    yield
    orch._JSON_MODE_UNSUPPORTED.clear()


def test_json_mode_off_by_default_never_sends_response_format():
    """Existing (pre-P4-3) callers that don't opt in must see zero change:
    no `response_format` key reaches the SDK call at all."""
    client = _FakeClient(lambda kwargs: _ok_response())

    out = orch._call_openai_compat(client, "some-model", "hello", provider_id="openai")

    assert out == '{"ok": true}'
    assert len(client.chat.completions.calls) == 1
    assert "response_format" not in client.chat.completions.calls[0]


def test_json_mode_on_supported_provider_sends_response_format():
    """A provider that accepts the parameter (e.g. real OpenAI) gets it on
    the first and only call — no wasted retry."""
    client = _FakeClient(lambda kwargs: _ok_response('{"a": 1}'))

    out = orch._call_openai_compat(
        client, "gpt-4o-mini", "summarize", provider_id="openai", json_mode=True,
    )

    assert out == '{"a": 1}'
    calls = client.chat.completions.calls
    assert len(calls) == 1
    assert calls[0]["response_format"] == {"type": "json_object"}
    # Provider was never flagged unsupported.
    assert "openai" not in orch._JSON_MODE_UNSUPPORTED


def test_json_mode_falls_back_gracefully_when_provider_rejects_param():
    """A free-tier OpenAI-compatible endpoint that 400s on an unrecognized
    `response_format` param must not break the caller: the first call is
    made with the param, it fails, and a second call without the param
    succeeds — the caller gets a normal string back either way."""
    attempts: list = []

    def behavior(kwargs):
        attempts.append(kwargs)
        if "response_format" in kwargs:
            raise RuntimeError(
                "400 Bad Request: Unsupported parameter 'response_format' for this model"
            )
        return _ok_response('{"fallback": true}')

    client = _FakeClient(behavior)

    out = orch._call_openai_compat(
        client, "llama-3.3-70b:free", "classify", provider_id="openrouter", json_mode=True,
    )

    assert out == '{"fallback": true}'
    assert len(attempts) == 2
    assert "response_format" in attempts[0]
    assert "response_format" not in attempts[1]
    # The provider is now cached as unsupported for the rest of the process.
    assert "openrouter" in orch._JSON_MODE_UNSUPPORTED


def test_json_mode_unsupported_provider_is_not_retried_on_subsequent_calls():
    """Once a provider is known to reject the parameter, later calls in the
    same process must skip straight to the no-json-mode path — no repeated
    failed attempt burned on every request."""
    orch._JSON_MODE_UNSUPPORTED.add("cloudflare")
    client = _FakeClient(lambda kwargs: _ok_response('{"x": 1}'))

    out = orch._call_openai_compat(
        client, "llama-3.3-70b", "analyze", provider_id="cloudflare", json_mode=True,
    )

    assert out == '{"x": 1}'
    calls = client.chat.completions.calls
    assert len(calls) == 1
    assert "response_format" not in calls[0]


def test_json_mode_unrelated_errors_propagate_without_fallback_retry():
    """A rate-limit / auth / network error must NOT be swallowed by the
    json-mode fallback path — it should propagate so the existing
    rotation/backoff logic in `_generate_with_rotation` can react to it."""
    def behavior(kwargs):
        raise RuntimeError("429 Too Many Requests")

    client = _FakeClient(behavior)

    with pytest.raises(RuntimeError, match="429"):
        orch._call_openai_compat(
            client, "some-model", "hi", provider_id="groq_fast", json_mode=True,
        )

    # Only one attempt was made — no fallback retry for a non-param error.
    assert len(client.chat.completions.calls) == 1
    assert "groq_fast" not in orch._JSON_MODE_UNSUPPORTED


def test_call_provider_threads_json_mode_to_openai_compat(monkeypatch):
    """`_call_provider` must forward `json_mode` down to `_call_openai_compat`
    for the generic OpenAI-compatible branch (openrouter/cloudflare/mistral/
    openai) — this is the exact plumbing path bulk/quality chains rely on."""
    captured: dict = {}

    def fake_call_openai_compat(client, model, prompt, *, provider_id=None, json_mode=False):
        captured["provider_id"] = provider_id
        captured["json_mode"] = json_mode
        return "served"

    monkeypatch.setattr(orch, "_call_openai_compat", fake_call_openai_compat)
    monkeypatch.setitem(orch._clients, "openai", object())

    out = orch._call_provider("openai", "prompt text", json_mode=True)

    assert out == "served"
    assert captured == {"provider_id": "openai", "json_mode": True}
