"""Chaos Lab invariant 2: openai's cumulative cost never exceeds the daily
ceiling plus one call's cost — even when every other leg fails, and even when
Redis is down (the Arq worker never calls init_redis(), so in production its
get_redis_or_none() is always None). And ``[]`` from available() means no
provider is called at all.

History: two "if nothing is available, try everything" fallbacks
(available()'s last_ditch list and _generate_with_rotation overwriting an
empty list with the raw chain) re-admitted openai past its ceiling.
"""
from __future__ import annotations

import asyncio

from hypothesis import example, given, settings
from hypothesis import strategies as st

from backend.services.ai import orchestrator as orch
from backend.services.ai.cost import LLMUsage, estimate_cost, openai_daily_cost_key
from backend.tests.support.chaos_lab import (
    FAILURES,
    NON_OPENAI_LEGS,
    R404,
    chaos_lab,
    fault_scripts,
    ok_with_cost,
)

ENTRIES = st.sampled_from(["generate_text", "generate_text_bulk"])
_ALL_DEAD = {pid: [R404] for pid in NON_OPENAI_LEGS}


def _call_cost(tokens: int) -> float:
    return estimate_cost("openai", orch.PROVIDER_REGISTRY["openai"].model, LLMUsage(0, tokens))


@settings(max_examples=120)
@given(
    others=fault_scripts(NON_OPENAI_LEGS, st.sampled_from(list(FAILURES)), max_len=3),
    tokens=st.lists(st.integers(1_000, 20_000), min_size=1, max_size=4),
    ceiling_in_calls=st.floats(0.5, 4.0),
    n_calls=st.integers(1, 12),
    redis_up=st.booleans(),
    entry=ENTRIES,
)
@example(others=_ALL_DEAD, tokens=[10_000], ceiling_in_calls=2.0, n_calls=10,
         redis_up=False, entry="generate_text_bulk")
@example(others=_ALL_DEAD, tokens=[10_000], ceiling_in_calls=2.0, n_calls=10,
         redis_up=True, entry="generate_text")
def test_openai_spend_never_exceeds_ceiling_plus_one_call(
    others, tokens, ceiling_in_calls, n_calls, redis_up, entry
):
    max_call = max(_call_cost(t) for t in tokens)
    ceiling = max_call * ceiling_in_calls
    scripts = {**others, "openai": [ok_with_cost(t) for t in tokens]}
    with chaos_lab(scripts, redis_up=redis_up, openai_ceiling_usd=ceiling) as lab:
        lab.run(entry, n_calls)
        spent = lab.provider.openai_cost_usd()
    assert spent <= ceiling + max_call + 1e-12, (
        f"openai spent ${spent:.6f} against a ${ceiling:.6f} ceiling "
        f"(one call ≤ ${max_call:.6f}, redis_up={redis_up})"
    )


def test_empty_available_means_no_provider_is_called():
    scripts = {**_ALL_DEAD, "openai": [ok_with_cost(10_000)]}
    with chaos_lab(scripts, openai_ceiling_usd=0.01) as lab:
        for pid in NON_OPENAI_LEGS:
            lab.rotator.record_unavailable(pid, "chaos: retired model")
        asyncio.run(lab.rotator.flush_openai_cost_to_redis(0.02))  # past the ceiling
        assert lab.rotator.available(orch.BULK_CHAIN) == []
        [outcome] = lab.run("generate_text_bulk", 1)
    assert lab.provider.calls == [], f"providers called despite available()==[]: {lab.provider.calls}"
    assert isinstance(outcome, RuntimeError) and "No LLM provider available" in str(outcome), outcome


def test_redis_present_counts_each_call_exactly_once():
    """With Redis up the local total must rise once per call (not twice), the
    fleet counter must match it, and refresh_from_redis's max() must leave it
    unchanged."""
    cost = 0.0125
    with chaos_lab({}, redis_up=True, openai_ceiling_usd=10.0) as lab:
        async def _drive() -> None:
            await lab.rotator.flush_openai_cost_to_redis(cost)
            await lab.rotator.flush_openai_cost_to_redis(cost)
            local = lab.rotator._openai_daily_cost_usd
            fleet = float(await lab.redis.get(openai_daily_cost_key()))
            assert abs(local - 2 * cost) < 1e-12, local
            assert abs(fleet - 2 * cost) < 1e-12, fleet
            await lab.rotator.refresh_from_redis(["openai"])
            assert abs(lab.rotator._openai_daily_cost_usd - 2 * cost) < 1e-12

        asyncio.run(_drive())


def test_redis_down_still_counts_locally():
    with chaos_lab({}, redis_up=False, openai_ceiling_usd=10.0) as lab:
        asyncio.run(lab.rotator.flush_openai_cost_to_redis(0.5))
    assert abs(lab.rotator._openai_daily_cost_usd - 0.5) < 1e-12
