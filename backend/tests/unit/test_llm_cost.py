"""Unit tests for LLM cost accounting (Roadmap Foundation 10x, Phase 1 P1-1).

Covers: $/token cost estimation, the per-user monthly spend cap (fails open
without Redis, raises LLMBudgetExceededError before any provider call once
over cap), and ProviderRotator's Redis-backed fleet-wide daily counters
(two independent ProviderRotator instances sharing one Redis see each
other's usage — simulating two worker processes) plus the openai daily-cost
ceiling gate.
"""
from __future__ import annotations

import pytest

from backend.core.config import settings
from backend.services.ai import cost as cost_module
from backend.services.ai.cost import LLMUsage, estimate_cost
from backend.services.llm_client import LLMBudgetExceededError


class FakeRedis:
    """Minimal async Redis double: get/incr/incrbyfloat/expire, string values."""

    def __init__(self, initial: dict[str, str] | None = None):
        self.store: dict[str, str] = dict(initial or {})
        self.ttls: dict[str, int] = {}

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
        self.ttls[key] = ttl


class RaisingRedis:
    """Simulates a Redis connection error on every call."""

    async def get(self, key: str):
        raise ConnectionError("redis down")

    async def incrbyfloat(self, key: str, amount: float):
        raise ConnectionError("redis down")

    async def expire(self, key: str, ttl: int):
        raise ConnectionError("redis down")


# ---------------------------------------------------------------------------
# estimate_cost
# ---------------------------------------------------------------------------

def test_estimate_cost_zero_for_free_tier_provider():
    usage = LLMUsage(prompt_tokens=10_000, completion_tokens=5_000)
    assert estimate_cost("cerebras", "gpt-oss-120b", usage) == 0.0


def test_estimate_cost_zero_when_usage_missing():
    assert estimate_cost("openai", "gpt-4o-mini", None) == 0.0


def test_estimate_cost_openai_known_model():
    usage = LLMUsage(prompt_tokens=1000, completion_tokens=1000)
    cost = estimate_cost("openai", "gpt-4o-mini", usage)
    assert cost == pytest.approx(0.00015 + 0.0006)


def test_estimate_cost_openai_unknown_model_uses_conservative_fallback():
    usage = LLMUsage(prompt_tokens=1000, completion_tokens=1000)
    cost = estimate_cost("openai", "some-future-model", usage)
    assert cost == pytest.approx(0.0025 + 0.01)


# ---------------------------------------------------------------------------
# check_user_llm_budget / record_user_llm_spend
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_budget_disabled_when_cap_is_zero(monkeypatch):
    monkeypatch.setattr(settings, "llm_monthly_user_cost_cap_usd", 0.0)
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: (_ for _ in ()).throw(AssertionError("should not touch redis")))
    await cost_module.check_user_llm_budget("user-1")  # must not raise / must not touch redis


@pytest.mark.asyncio
async def test_budget_fails_open_when_redis_unavailable(monkeypatch):
    monkeypatch.setattr(settings, "llm_monthly_user_cost_cap_usd", 5.0)
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: None)
    await cost_module.check_user_llm_budget("user-1")  # no Redis => allow


@pytest.mark.asyncio
async def test_budget_fails_open_on_redis_error(monkeypatch):
    monkeypatch.setattr(settings, "llm_monthly_user_cost_cap_usd", 5.0)
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: RaisingRedis())
    await cost_module.check_user_llm_budget("user-1")  # Redis errors => allow, don't 500


@pytest.mark.asyncio
async def test_budget_allows_when_under_cap(monkeypatch):
    monkeypatch.setattr(settings, "llm_monthly_user_cost_cap_usd", 5.0)
    key = cost_module._user_monthly_cost_key("user-1")
    redis = FakeRedis({key: "1.50"})
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: redis)
    await cost_module.check_user_llm_budget("user-1")  # 1.50 < 5.00 => allow


@pytest.mark.asyncio
async def test_budget_raises_typed_error_when_over_cap(monkeypatch):
    monkeypatch.setattr(settings, "llm_monthly_user_cost_cap_usd", 5.0)
    key = cost_module._user_monthly_cost_key("user-1")
    redis = FakeRedis({key: "5.25"})
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: redis)
    with pytest.raises(LLMBudgetExceededError):
        await cost_module.check_user_llm_budget("user-1")


@pytest.mark.asyncio
async def test_record_user_llm_spend_increments_and_sets_ttl(monkeypatch):
    redis = FakeRedis()
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: redis)
    key = cost_module._user_monthly_cost_key("user-1")

    await cost_module.record_user_llm_spend("user-1", 0.01)
    await cost_module.record_user_llm_spend("user-1", 0.02)

    assert float(redis.store[key]) == pytest.approx(0.03)
    assert redis.ttls[key] == 40 * 86400


@pytest.mark.asyncio
async def test_record_user_llm_spend_skips_zero_cost(monkeypatch):
    redis = FakeRedis()
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: redis)
    await cost_module.record_user_llm_spend("user-1", 0.0)
    assert redis.store == {}


@pytest.mark.asyncio
async def test_budget_then_spend_end_to_end(monkeypatch):
    """A realistic sequence: under cap, spend, spend again crosses cap, next
    check is rejected — the concrete scenario the acceptance criteria describe."""
    monkeypatch.setattr(settings, "llm_monthly_user_cost_cap_usd", 0.02)
    redis = FakeRedis()
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: redis)

    await cost_module.check_user_llm_budget("user-1")  # nothing spent yet
    await cost_module.record_user_llm_spend("user-1", 0.015)
    await cost_module.check_user_llm_budget("user-1")  # 0.015 < 0.02, still allowed
    await cost_module.record_user_llm_spend("user-1", 0.01)  # now 0.025 >= 0.02

    with pytest.raises(LLMBudgetExceededError):
        await cost_module.check_user_llm_budget("user-1")


# ---------------------------------------------------------------------------
# ProviderRotator: Redis-backed fleet-wide daily budget (P1-1 acceptance
# criterion: "daily provider budget shared across >= 2 worker processes")
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_provider_rotator_shares_daily_count_across_two_processes(monkeypatch):
    from backend.services.ai.orchestrator import ProviderRotator

    shared_redis = FakeRedis()
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: shared_redis)

    process_a = ProviderRotator()
    process_b = ProviderRotator()

    # Process A serves 3 requests and flushes each to the shared Redis.
    for _ in range(3):
        process_a.record_success("cerebras")
        await process_a.flush_success_to_redis("cerebras")

    # Process B has never seen a request locally, but after refreshing from
    # the SAME Redis it must see process A's 3 requests.
    assert process_b.available(["cerebras"])  # sanity: not excluded yet
    await process_b.refresh_from_redis(["cerebras"])
    assert process_b._counts["cerebras"] == 3


@pytest.mark.asyncio
async def test_provider_rotator_daily_limit_enforced_fleet_wide(monkeypatch):
    """Two processes independently under a provider's per-process view could
    each think they have full quota; after refresh_from_redis both must
    agree the fleet-wide count is what's shared, not per-process."""
    from backend.services.ai.orchestrator import ProviderRotator, PROVIDER_REGISTRY
    from backend.services.ai import orchestrator as orch

    shared_redis = FakeRedis()
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: shared_redis)
    # available() falls back to the FULL requested chain when every candidate
    # is excluded ("try anyway, may still work") — a decoy provider WITH a
    # client keeps `ok` non-empty so cerebras's exclusion is actually
    # observable instead of masked by that last-ditch fallback. Neither
    # provider has a real API key in this sandbox, so both would otherwise
    # read as `no_client` and get swept into the fallback regardless of the
    # daily-limit logic this test exists to exercise.
    monkeypatch.setitem(orch._clients, "cerebras", object())
    monkeypatch.setitem(orch._clients, "groq_fast", object())

    # Temporarily give "cerebras" a tiny daily limit so the test doesn't need
    # thousands of calls to exercise the cutover.
    original_limit = PROVIDER_REGISTRY["cerebras"].daily_limit
    monkeypatch.setattr(PROVIDER_REGISTRY["cerebras"], "daily_limit", 2)
    try:
        process_a = ProviderRotator()
        process_b = ProviderRotator()

        process_a.record_success("cerebras")
        await process_a.flush_success_to_redis("cerebras")
        process_a.record_success("cerebras")
        await process_a.flush_success_to_redis("cerebras")

        # Process B never called cerebras itself, but the fleet is at 2/2.
        await process_b.refresh_from_redis(["cerebras", "groq_fast"])
        result = process_b.available(["cerebras", "groq_fast"])
        assert "cerebras" not in result
        assert "groq_fast" in result
    finally:
        monkeypatch.setattr(PROVIDER_REGISTRY["cerebras"], "daily_limit", original_limit)


@pytest.mark.asyncio
async def test_provider_rotator_gates_openai_after_daily_cost_ceiling(monkeypatch):
    from backend.services.ai import orchestrator as orch

    shared_redis = FakeRedis()
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: shared_redis)
    monkeypatch.setattr(settings, "llm_openai_daily_cost_ceiling_usd", 0.05)
    # available() first checks _clients.get(pid) is not None (has an API key
    # configured) before ever reaching the cost-ceiling check. A decoy
    # provider with a client keeps `ok` non-empty so openai's exclusion is
    # actually observable instead of masked by the "nothing available, try
    # the whole chain anyway" last-ditch fallback.
    monkeypatch.setitem(orch._clients, "openai", object())
    monkeypatch.setitem(orch._clients, "gemini", object())
    chain = ["openai", "gemini"]

    rotator = orch.ProviderRotator()
    assert "openai" in rotator.available(chain)  # nothing spent yet

    await rotator.flush_openai_cost_to_redis(0.03)
    assert "openai" in rotator.available(chain)  # under ceiling

    await rotator.flush_openai_cost_to_redis(0.03)  # total 0.06 >= 0.05
    result = rotator.available(chain)
    assert "openai" not in result
    assert "gemini" in result


@pytest.mark.asyncio
async def test_provider_rotator_openai_ceiling_shared_across_processes(monkeypatch):
    from backend.services.ai import orchestrator as orch

    shared_redis = FakeRedis()
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: shared_redis)
    monkeypatch.setattr(settings, "llm_openai_daily_cost_ceiling_usd", 0.05)
    monkeypatch.setitem(orch._clients, "openai", object())
    monkeypatch.setitem(orch._clients, "gemini", object())
    chain = ["openai", "gemini"]

    process_a = orch.ProviderRotator()
    process_b = orch.ProviderRotator()

    await process_a.flush_openai_cost_to_redis(0.06)  # A blows the ceiling

    # B never called openai itself, but must pick up A's spend on refresh.
    await process_b.refresh_from_redis(chain)
    result = process_b.available(chain)
    assert "openai" not in result
    assert "gemini" in result
