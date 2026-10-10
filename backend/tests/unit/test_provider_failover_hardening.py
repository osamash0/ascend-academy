"""Failover-path hardening for the LLM provider chains.

These pin three behaviours that a live provider audit (2026-09-17) found
broken, at a point where 8 of 9 legs in both chains were dead and every call
was silently landing on the one paid provider:

1. The fleet-wide openai daily-cost ceiling was bypassable. `available()`
   built its `last_ditch` fallback by filtering the chain on `_disabled`
   alone — re-applying neither the cost ceiling nor the has-a-client check.
   Once every other leg was disabled/keyless, `ok` came back empty and
   `last_ditch` handed openai straight back, so the cap never actually
   stopped spend.

2. A hard 402 `payment_required` from Cerebras was classified as a rate
   limit, because the provider's JSON error body contains `'param': 'quota'`
   and the sniff matched the bare substring "quota". A permanent billing
   failure therefore took the 90s-backoff path instead of being disabled,
   and — being the head of both chains — burned one doomed round-trip per
   call forever.

3. The vision path had no permanent-disable path at all: it only ever
   recorded rate limits, so a retired vision model 404'd on every single
   slide of every deck rather than being dropped after the first failure.
"""
from __future__ import annotations

import pytest

from backend.core.config import settings


class _FakeRedis:
    """Minimal async Redis double (mirrors the one in test_llm_cost.py)."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def incr(self, key: str) -> int:
        val = int(self.store.get(key, "0")) + 1
        self.store[key] = str(val)
        return val

    async def incrbyfloat(self, key: str, amount: float) -> float:
        val = float(self.store.get(key, "0")) + amount
        self.store[key] = str(val)
        return val

    async def expire(self, key: str, ttl: int) -> None:
        return None


# ---------------------------------------------------------------------------
# 1. The openai daily-cost ceiling must hold even when it is the last leg
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_openai_ceiling_holds_when_every_other_leg_is_dead(monkeypatch):
    """The ceiling is a spend cap, not a preference.

    This is the exact production shape found by the audit: every other
    provider in the chain is permanently disabled (retired model slugs), so
    openai is the only candidate left. Going over the ceiling must drop it
    rather than fall through to the last-ditch list — otherwise the cap is
    decorative precisely in the situation it exists to protect against.
    """
    from backend.services.ai import cost as cost_module
    from backend.services.ai import orchestrator as orch

    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: _FakeRedis())
    monkeypatch.setattr(settings, "llm_openai_daily_cost_ceiling_usd", 0.05)
    monkeypatch.setitem(orch._clients, "openai", object())
    monkeypatch.setitem(orch._clients, "gemini", object())

    chain = ["gemini", "openai"]
    rotator = orch.ProviderRotator()
    # gemini is dead upstream (404 on its configured model), exactly as the
    # audit found — leaving openai as the sole survivor of the chain.
    rotator.record_unavailable("gemini", "404 from provider (model or route gone)")

    assert rotator.available(chain) == ["openai"]  # under ceiling: fine

    await rotator.flush_openai_cost_to_redis(0.06)  # blow the ceiling
    await rotator.refresh_from_redis(chain)

    assert "openai" not in rotator.available(chain), (
        "openai stayed available past its daily cost ceiling because the "
        "last-ditch fallback re-admitted it"
    )


@pytest.mark.asyncio
async def test_last_ditch_never_returns_a_provider_with_no_client(monkeypatch):
    """A keyless provider cannot succeed, so the fallback must not offer it.

    `_call_provider` raises RuntimeError for a provider whose client was
    never initialised. Handing those back from `available()` just converts a
    clean "nothing available" into a series of guaranteed exceptions.
    """
    from backend.services.ai import orchestrator as orch

    monkeypatch.setitem(orch._clients, "mistral", None)
    monkeypatch.setitem(orch._clients, "cloudflare", None)

    rotator = orch.ProviderRotator()
    assert rotator.available(["mistral", "cloudflare"]) == []


# ---------------------------------------------------------------------------
# 2. A 402 is a billing wall, not a rate limit
# ---------------------------------------------------------------------------

def test_payment_required_disables_provider_rather_than_backing_off(monkeypatch):
    """Cerebras 402 must disable the provider, not schedule a retry.

    The real error body is reproduced verbatim: note `'param': 'quota'`,
    which is what made the old bare-substring "quota" sniff misfire.
    """
    from backend.services.ai import orchestrator as orch

    cerebras_402 = (
        "Error code: 402 - {'message': 'Payment required to access this "
        "resource. Visit your billing tab.', 'type': 'payment_required_error', "
        "'param': 'quota', 'code': 'payment_required'}"
    )

    rotator = orch.ProviderRotator()
    monkeypatch.setattr(orch, "_rotator", rotator)
    monkeypatch.setitem(orch._clients, "cerebras", object())
    monkeypatch.setitem(orch._clients, "openai", object())

    def fake_call(pid, prompt, **kw):
        if pid == "cerebras":
            raise RuntimeError(cerebras_402)
        return "ok", None

    monkeypatch.setattr(orch, "_call_provider", fake_call)

    text, pid, _model, _usage = orch._generate_with_rotation(
        "hi", ["cerebras", "openai"]
    )
    assert (text, pid) == ("ok", "openai")
    # Assert on the mechanism, not on `available()`: a timed backoff also
    # hides the provider from `available()` in the short term, so checking
    # availability alone cannot tell "disabled" from "will be retried in 90s"
    # — which is the entire distinction under test.
    assert "cerebras" in rotator._disabled, (
        "a 402 payment_required left cerebras merely backed-off, so it will "
        "be retried every time the backoff lapses instead of being disabled"
    )
    assert not rotator._backoff.get("cerebras"), (
        "a permanent billing failure should not also schedule a retry"
    )


def test_genuine_rate_limit_still_backs_off_rather_than_disabling(monkeypatch):
    """Guard the other direction: a real 429 must stay recoverable.

    Disabling on 429 would permanently lose a provider that is merely busy.
    """
    from backend.services.ai import orchestrator as orch

    rotator = orch.ProviderRotator()
    monkeypatch.setattr(orch, "_rotator", rotator)
    monkeypatch.setitem(orch._clients, "groq", object())
    monkeypatch.setitem(orch._clients, "openai", object())

    def fake_call(pid, prompt, **kw):
        if pid == "groq":
            raise RuntimeError("Error code: 429 - rate limit reached, please retry")
        return "ok", None

    monkeypatch.setattr(orch, "_call_provider", fake_call)
    orch._generate_with_rotation("hi", ["groq", "openai"])

    assert "groq" not in rotator._disabled, "a transient 429 permanently disabled a provider"
    assert rotator._backoff.get("groq", 0) > 0, "a 429 should schedule a backoff"


# ---------------------------------------------------------------------------
# 3. Vision must drop a dead model instead of re-firing it per slide
# ---------------------------------------------------------------------------

def test_vision_404_disables_provider_for_the_process(monkeypatch):
    """A retired vision model must not be retried on every slide.

    Groq removed vision models entirely (audit 2026-09-17), so the
    configured vision slug 404s. Without a disable path, a 50-slide deck
    fires 50 doomed requests at it.
    """
    from backend.services.ai import orchestrator as orch
    from backend.services.ai import vision as vision_mod

    rotator = orch.ProviderRotator()
    monkeypatch.setattr(vision_mod, "_rotator", rotator)
    monkeypatch.setattr(vision_mod, "groq_client", object())
    monkeypatch.setattr(vision_mod, "gemini_client", object())
    monkeypatch.setattr(vision_mod, "openai_client", None)
    # Groq vision is off by default now (no vision model in their catalogue),
    # so opt the leg back in explicitly — this test is about what happens to a
    # configured-but-dead provider, not about the default provider list.
    monkeypatch.setattr(vision_mod, "GROQ_VISION_MODEL", "some/configured-vision-model")

    calls: list[str] = []

    def boom_groq(*a, **kw):
        calls.append("groq")
        raise RuntimeError(
            "Error code: 404 - {'error': {'message': 'The model "
            "`meta-llama/llama-4-scout-17b-16e-instruct` does not exist or you "
            "do not have access to it.', 'code': 'model_not_found'}}"
        )

    def ok_gemini(*a, **kw):
        calls.append("gemini")
        return {"title": "t", "content": "c"}

    monkeypatch.setattr(vision_mod, "_call_groq_vision", boom_groq)
    monkeypatch.setattr(vision_mod, "_call_gemini_vision", ok_gemini)

    for _ in range(3):
        vision_mod._sync_analyze_vision("b64", raw_text="x", ai_model="groq")

    assert calls.count("groq") == 1, (
        f"dead vision model was retried on every call (groq attempts: "
        f"{calls.count('groq')} of 3) instead of being disabled after the first 404"
    )
    assert calls.count("gemini") == 3


def test_vision_returns_fallback_rather_than_calling_disabled_providers(monkeypatch):
    """When every vision leg is disabled, return the neutral result directly.

    Re-admitting disabled providers just to avoid an empty candidate list
    would trade a fast, honest fallback for a slow one preceded by a run of
    guaranteed failures — the same anti-pattern as the text chain's old
    `last_ditch` list.
    """
    from backend.services.ai import orchestrator as orch
    from backend.services.ai import vision as vision_mod

    rotator = orch.ProviderRotator()
    monkeypatch.setattr(vision_mod, "_rotator", rotator)
    monkeypatch.setattr(vision_mod, "gemini_client", object())
    monkeypatch.setattr(vision_mod, "groq_client", None)
    monkeypatch.setattr(vision_mod, "openai_client", None)
    rotator.record_unavailable("gemini_vision", "404")

    called: list[str] = []
    monkeypatch.setattr(
        vision_mod, "_call_gemini_vision",
        lambda *a, **k: called.append("gemini") or {},
    )

    res = vision_mod._sync_analyze_vision("b64", raw_text="x", ai_model="gemini")

    assert called == [], "a disabled vision provider was still called"
    assert res == dict(vision_mod._FALLBACK_RESULT)
