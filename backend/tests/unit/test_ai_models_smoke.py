"""Smoke tests for the AI provider call paths.

These are *not* integration tests against the real LLM APIs — they assert the
model identifiers we ship still match the names the SDKs send to the wire, so
a deprecation/rename (like Groq's `llama-3.2-11b-vision-preview` removal or
Google's `text-embedding-004` 404) flips a unit test red instead of failing
silently inside the parse pipeline.

The scope is *just* the boundary call: we patch the underlying SDK client,
invoke the public function, and assert the model string reaches the SDK.
"""
from __future__ import annotations

import asyncio
import base64
from types import SimpleNamespace

import pytest


# ── Embeddings ────────────────────────────────────────────────────────────────


def test_generate_embeddings_uses_current_model(monkeypatch):
    """`gemini-embedding-001` is the current GA Google AI embedding model.
    `text-embedding-004` was deprecated and now 404s on v1."""
    from backend.services.ai import embeddings as emb_mod

    captured: dict = {}

    class _FakeModels:
        def embed_content(self, model, contents, config=None):
            captured["model"] = model
            captured["config"] = config
            return SimpleNamespace(
                embeddings=[SimpleNamespace(values=[0.1] * emb_mod.EMBEDDING_DIMS)]
            )

    fake_client = SimpleNamespace(models=_FakeModels())
    monkeypatch.setattr(emb_mod, "gemini_client", fake_client)

    out = asyncio.run(emb_mod.generate_embeddings("hello world"))

    assert captured["model"] == "gemini-embedding-001"
    assert captured["model"] != "text-embedding-004"  # the old broken one
    assert isinstance(out, list)
    assert len(out) == emb_mod.EMBEDDING_DIMS


def test_generate_embeddings_pads_or_trims_to_expected_dims(monkeypatch):
    """Even if the model returns a different dim than 768 (e.g. older SDK
    rejecting EmbedContentConfig and falling back to default 3072), the
    pgvector(768) column shape must be preserved."""
    from backend.services.ai import embeddings as emb_mod

    class _FakeModels:
        def embed_content(self, model, contents, config=None):
            # pretend the SDK ignored config and returned a 3072-dim vector
            return SimpleNamespace(
                embeddings=[SimpleNamespace(values=[0.5] * 3072)]
            )

    monkeypatch.setattr(emb_mod, "gemini_client", SimpleNamespace(models=_FakeModels()))

    out = asyncio.run(emb_mod.generate_embeddings("hi"))
    assert len(out) == emb_mod.EMBEDDING_DIMS == 768


def test_generate_embeddings_empty_text_short_circuits():
    from backend.services.ai import embeddings as emb_mod

    out = asyncio.run(emb_mod.generate_embeddings("   "))
    assert out == [0.0] * emb_mod.EMBEDDING_DIMS


def test_generate_embeddings_propagates_runtime_errors(monkeypatch):
    """Runtime failures (bad model, RPC error, 4xx/5xx) MUST propagate to the
    caller — silently writing zero vectors into pgvector poisons semantic
    cache and RAG. Only the genuine 'no client' case should fall back to
    zeros, and only the empty-text case should short-circuit."""
    from backend.services.ai import embeddings as emb_mod

    class _BoomModels:
        def embed_content(self, model, contents, config=None):
            raise RuntimeError("404 model not found")

    monkeypatch.setattr(
        emb_mod, "gemini_client", SimpleNamespace(models=_BoomModels())
    )

    with pytest.raises(RuntimeError, match="404"):
        asyncio.run(emb_mod.generate_embeddings("real text"))


def test_generate_embeddings_returns_zero_only_when_client_absent(monkeypatch):
    from backend.services.ai import embeddings as emb_mod

    monkeypatch.setattr(emb_mod, "gemini_client", None)
    out = asyncio.run(emb_mod.generate_embeddings("real text"))
    assert out == [0.0] * emb_mod.EMBEDDING_DIMS


# ── Vision (Groq + Gemini) ────────────────────────────────────────────────────


def test_groq_vision_uses_current_model(monkeypatch):
    """`llama-3.2-11b-vision-preview` was decommissioned. The new default is
    `meta-llama/llama-4-scout-17b-16e-instruct`."""
    from backend.services.ai import vision as vision_mod

    captured: dict = {}

    class _Completions:
        def create(self, model, messages, temperature=None, response_format=None, **kw):
            captured["model"] = model
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content='{"slide_type":"content_slide","metadata":{},'
                                    '"content_extraction":{"main_topic":"x","key_points":[],'
                                    '"summary":"ok"},"quiz":null}'
                        )
                    )
                ]
            )

    fake_groq = SimpleNamespace(chat=SimpleNamespace(completions=_Completions()))
    monkeypatch.setattr(vision_mod, "groq_client", fake_groq)
    monkeypatch.setattr(vision_mod, "gemini_client", None)
    # Use the current GROQ_VISION_MODEL the orchestrator exports.
    from backend.services.ai import orchestrator as orch
    monkeypatch.setattr(vision_mod, "GROQ_VISION_MODEL", orch.GROQ_VISION_MODEL)

    b64 = base64.b64encode(b"\x00" * 32).decode()
    res = vision_mod._sync_analyze_vision(b64, raw_text="some text", ai_model="groq")

    assert captured["model"] == "meta-llama/llama-4-scout-17b-16e-instruct"
    assert "llama-3.2-11b-vision-preview" not in captured["model"]
    # Sanity: parse_json_response returned the structured shape.
    assert res["slide_type"] == "content_slide"


def test_gemini_vision_happy_path_with_response_mime_type(monkeypatch):
    """When Groq is unavailable, Gemini vision is used. The pinned
    google-genai SDK must accept `response_mime_type='application/json'`
    inside `GenerateContentConfig` (the v1 API rejected it; we removed the
    api_version='v1' pin so the default v1beta accepts it). This test
    asserts the SDK is invoked with the new model + config and the parsed
    JSON shape is returned."""
    from backend.services.ai import vision as vision_mod
    from backend.services.ai import orchestrator as orch

    captured: dict = {}

    class _GeminiModels:
        def generate_content(self, model, contents, config=None):
            captured["model"] = model
            captured["config"] = config
            captured["n_parts"] = len(contents)
            return SimpleNamespace(
                text='{"slide_type":"diagram_slide","metadata":{},'
                     '"content_extraction":{"main_topic":"force diagram",'
                     '"key_points":["F=ma"],"summary":"newton ii"},'
                     '"quiz":{"question":"q","options":["a","b","c","d"],'
                     '"correctAnswer":0}}'
            )

    monkeypatch.setattr(vision_mod, "groq_client", None)
    monkeypatch.setattr(
        vision_mod, "gemini_client", SimpleNamespace(models=_GeminiModels())
    )
    monkeypatch.setattr(vision_mod, "GEMINI_MODEL", orch.GEMINI_MODEL)

    b64 = base64.b64encode(b"\xff" * 64).decode()
    res = vision_mod._sync_analyze_vision(b64, raw_text="", ai_model="gemini")

    # The model id we ship matches what the orchestrator exports.
    assert captured["model"] == orch.GEMINI_MODEL
    # The response_mime_type config did reach the SDK call.
    assert captured["config"] is not None
    assert getattr(captured["config"], "response_mime_type", None) == "application/json"
    # And the parsed payload is what we expect — not the fallback shape.
    assert res["slide_type"] == "diagram_slide"
    assert res["content_extraction"]["main_topic"] == "force diagram"


def test_gemini_vision_falls_through_to_fallback_on_error(monkeypatch):
    """If both vision providers fail, `_sync_analyze_vision` must return the
    documented fallback dict instead of raising — so the upload pipeline keeps
    streaming the rest of the deck."""
    from backend.services.ai import vision as vision_mod

    class _BoomCompletions:
        def create(self, *a, **kw):
            raise RuntimeError("groq down")

    class _BoomGeminiModels:
        def generate_content(self, *a, **kw):
            raise RuntimeError("gemini 400")

    monkeypatch.setattr(
        vision_mod, "groq_client",
        SimpleNamespace(chat=SimpleNamespace(completions=_BoomCompletions())),
    )
    monkeypatch.setattr(
        vision_mod, "gemini_client",
        SimpleNamespace(models=_BoomGeminiModels()),
    )

    b64 = base64.b64encode(b"\x00" * 16).decode()
    res = vision_mod._sync_analyze_vision(b64, raw_text="", ai_model="groq")
    assert res["slide_type"] == "content_slide"
    assert res["quiz"] is None
    assert res["content_extraction"]["main_topic"] == "Untitled"


# ── Bulk text generation (chain) ──────────────────────────────────────────────


def test_generate_text_bulk_routes_through_first_available_provider(monkeypatch):
    """The BULK_CHAIN should pick the first available provider (clients stubbed
    to None for the others) and forward the prompt to its `_call_provider`
    branch."""
    from backend.services.ai import orchestrator as orch
    from backend.services import llm_client as llm_client_mod

    served: dict = {}

    def _fake_call(pid, prompt):
        served["provider"] = pid
        served["prompt"] = prompt
        return "OK"

    monkeypatch.setattr(orch, "_call_provider", _fake_call)
    # Force only one provider to look "available" to the rotator.
    monkeypatch.setattr(orch._rotator, "available", lambda chain: ["cerebras"])

    # call_llm wraps the sync work in a thread; bypass anything fancy.
    async def _direct_call(fn):
        return fn()

    monkeypatch.setattr(llm_client_mod, "call_llm", _direct_call)

    out = asyncio.run(orch.generate_text_bulk("summarize this slide"))
    assert out == "OK"
    assert served["provider"] == "cerebras"
    assert "summarize" in served["prompt"]


def test_provider_registry_has_no_decommissioned_models():
    """Hard guard: no entry in the registry can reference a model that's been
    publicly decommissioned. Bump this set when a provider deprecates a model."""
    from backend.services.ai import orchestrator as orch

    DEAD = {
        "llama-3.2-11b-vision-preview",  # Groq, decommissioned Apr 2026
        "text-embedding-004",            # Google, 404 on v1
    }
    for cfg in orch.PROVIDER_REGISTRY.values():
        assert cfg.model not in DEAD, f"provider {cfg.id} uses dead model {cfg.model}"
    assert orch.GROQ_VISION_MODEL not in DEAD
