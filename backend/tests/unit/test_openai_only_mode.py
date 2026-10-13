"""AI_PROVIDER_MODE=openai_only: every AI call reaches OpenAI and is costed.

The mode is read once at import, so the import-time behaviour (chains,
picker, embedding model) is checked in a fresh interpreter; the call paths
are checked in-process by flipping the module flags.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.services.ai import embeddings as emb
from backend.services.ai import orchestrator as orch
from backend.services.ai import vision as vision_mod
from backend.services.ai.cost import LLMUsage, estimate_cost

REPO_ROOT = Path(__file__).resolve().parents[3]

_PROBE = """
import json
from backend.services.ai import orchestrator as o
from backend.services.ai import embeddings as e
print(json.dumps({
    "bulk": o.BULK_CHAIN,
    "quality": o.QUALITY_CHAIN,
    "picker": [o._resolve_preferred(m) for m in ("gemini", "groq", "auto", None)],
    "bulk_model": o._model_for("openai", "bulk"),
    "quality_model": o._model_for("openai", "quality"),
    "embed_model": e.EMBEDDING_MODEL,
}))
"""


def test_import_time_openai_only_collapses_chains_and_ignores_picker():
    env = {
        **os.environ,
        "AI_PROVIDER_MODE": "openai_only",
        "OPENAI_MODEL": "gpt-4.1-mini",
        "OPENAI_BULK_MODEL": "gpt-4.1-nano",
    }
    out = subprocess.run(
        [sys.executable, "-c", _PROBE],
        cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=120,
    )
    assert out.returncode == 0, out.stderr[-2000:]
    probe = json.loads(out.stdout.strip().splitlines()[-1])
    assert probe["bulk"] == ["openai"]
    assert probe["quality"] == ["openai"]
    assert probe["picker"] == ["openai"] * 4
    assert probe["bulk_model"] == "gpt-4.1-nano"
    assert probe["quality_model"] == "gpt-4.1-mini"
    assert probe["embed_model"] == "text-embedding-3-small"


# ── startup guard ────────────────────────────────────────────────────────────

def _clear_keys(monkeypatch):
    for var in (*orch._NON_OPENAI_KEY_VARS, "OPENAI_API_KEY"):
        monkeypatch.delenv(var, raising=False)


def test_guard_is_inert_in_multi_mode(monkeypatch):
    monkeypatch.setattr(orch, "OPENAI_ONLY", False)
    _clear_keys(monkeypatch)
    monkeypatch.setenv("GROQ_API_KEY", "x")
    orch.assert_provider_mode()


def test_guard_refuses_a_stray_provider_key_without_leaking_it(monkeypatch):
    monkeypatch.setattr(orch, "OPENAI_ONLY", True)
    _clear_keys(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("GEMINI_API_KEY", "secret-gemini-value")
    with pytest.raises(RuntimeError) as err:
        orch.assert_provider_mode()
    assert "GEMINI_API_KEY" in str(err.value)
    assert "secret-gemini-value" not in str(err.value)


def test_guard_ignores_blank_keys_but_requires_openai(monkeypatch):
    monkeypatch.setattr(orch, "OPENAI_ONLY", True)
    _clear_keys(monkeypatch)
    monkeypatch.setenv("GROQ_API_KEY", "  ")
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        orch.assert_provider_mode()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    orch.assert_provider_mode()


# ── tier models ──────────────────────────────────────────────────────────────

def test_bulk_tier_sends_and_reports_the_bulk_model(monkeypatch):
    monkeypatch.setattr(orch, "OPENAI_BULK_MODEL", "gpt-4.1-nano")
    monkeypatch.setattr(orch._rotator, "available", lambda chain: ["openai"])
    seen = {}

    def fake_call(pid, prompt, **kwargs):
        seen.update(kwargs, pid=pid)
        return "ok", LLMUsage(10, 5)

    monkeypatch.setattr(orch, "_call_provider", fake_call)
    _text, pid, model, _usage = orch._generate_with_rotation("p", ["openai"], tier="bulk")
    assert (pid, model, seen["model"]) == ("openai", "gpt-4.1-nano", "gpt-4.1-nano")

    seen.clear()
    _text, _pid, model, _usage = orch._generate_with_rotation("p", ["openai"])
    assert model == orch.PROVIDER_REGISTRY["openai"].model
    assert "model" not in seen  # quality tier keeps the registry model


# ── vision + embeddings are costed under "openai" ─────────────────────────────

@pytest.fixture
def accounted(monkeypatch):
    calls = []

    async def fake_account(provider_id, model, usage, **kw):
        calls.append(SimpleNamespace(provider=provider_id, model=model, usage=usage, **kw))

    monkeypatch.setattr(orch, "_account_for_call", fake_account)
    return calls


async def test_vision_uses_only_openai_and_is_costed(monkeypatch, accounted):
    monkeypatch.setattr(vision_mod, "OPENAI_ONLY", True)
    monkeypatch.setattr(vision_mod, "gemini_client", object())
    monkeypatch.setattr(vision_mod, "openai_client", object())
    monkeypatch.setattr(
        vision_mod, "_call_gemini_vision",
        lambda *a: pytest.fail("gemini vision must not be called in openai_only"),
    )
    monkeypatch.setattr(
        vision_mod, "_call_openai_vision",
        lambda *a: ({"slide_type": "content_slide"}, LLMUsage(1200, 300)),
    )
    res = await vision_mod.analyze_slide_vision("b64", "text", "gemini-2.0-flash")
    assert res == {"slide_type": "content_slide"}
    [call] = accounted
    assert (call.provider, call.feature) == ("openai", "vision")
    assert call.usage == LLMUsage(1200, 300)


async def test_embeddings_use_openai_at_768_dims_and_are_costed(monkeypatch, accounted):
    sent = {}

    def create(**kw):
        sent.update(kw)
        return SimpleNamespace(
            data=[SimpleNamespace(embedding=[0.1] * emb.EMBEDDING_DIMS)],
            usage=SimpleNamespace(prompt_tokens=42),
        )

    monkeypatch.setattr(emb, "OPENAI_ONLY", True)
    monkeypatch.setattr(emb, "openai_client", SimpleNamespace(embeddings=SimpleNamespace(create=create)))
    vec = await emb.generate_embeddings("normal forms")
    assert len(vec) == emb.EMBEDDING_DIMS
    assert sent["dimensions"] == emb.EMBEDDING_DIMS
    assert sent["model"] == emb.OPENAI_EMBEDDING_MODEL
    [call] = accounted
    assert (call.provider, call.feature) == ("openai", "embedding")
    assert call.usage == LLMUsage(42, 0)


def test_new_models_are_priced_not_charged_the_fallback_rate():
    nano = estimate_cost("openai", "gpt-4.1-nano", LLMUsage(1000, 1000))
    assert nano == pytest.approx(0.0005)
    embed = estimate_cost("openai", "text-embedding-3-small", LLMUsage(1000, 0))
    assert embed == pytest.approx(0.00002)


# ── the daily ceiling binds vision and embeddings too ────────────────────────

@pytest.fixture
def over_ceiling(monkeypatch):
    """The fleet has spent past the daily OpenAI ceiling."""
    from backend.core.config import settings

    async def no_refresh(chain):
        return None

    monkeypatch.setattr(settings, "llm_openai_daily_cost_ceiling_usd", 1.0)
    monkeypatch.setattr(orch._rotator, "refresh_from_redis", no_refresh)
    monkeypatch.setitem(orch._clients, "openai", object())
    monkeypatch.setattr(orch._rotator, "_openai_daily_cost_usd", 5.0)


async def test_vision_stops_at_the_daily_ceiling(monkeypatch, over_ceiling, accounted):
    monkeypatch.setattr(vision_mod, "OPENAI_ONLY", True)
    monkeypatch.setattr(vision_mod, "openai_client", object())
    monkeypatch.setattr(
        vision_mod, "_call_openai_vision",
        lambda *a: pytest.fail("vision billed OpenAI past the daily ceiling"),
    )
    res = await vision_mod.analyze_slide_vision("b64", "text", "openai")
    assert res == vision_mod._FALLBACK_RESULT
    assert accounted == []


async def test_embeddings_stop_at_the_daily_ceiling(monkeypatch, over_ceiling, accounted):
    def create(**_kw):
        pytest.fail("embeddings billed OpenAI past the daily ceiling")

    monkeypatch.setattr(emb, "OPENAI_ONLY", True)
    monkeypatch.setattr(emb, "openai_client", SimpleNamespace(embeddings=SimpleNamespace(create=create)))
    with pytest.raises(emb.EmbeddingUnavailableError):
        await emb.generate_embeddings("normal forms")
    assert accounted == []
