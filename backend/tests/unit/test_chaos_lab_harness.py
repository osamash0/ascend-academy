"""Self-tests for the Provider Chaos Lab harness (backend/tests/support/chaos_lab.py).

The invariant suites trust the lab to (a) raise faults in the exact SDK
shapes production sees, (b) rebuild every piece of process-global failover
state per example and put it back afterwards, and (c) never sleep. Each is
pinned here so a broken harness fails loudly instead of making the invariant
suites vacuous.
"""
from __future__ import annotations

import time

import openai
import pytest
from google.genai import errors as genai_errors

from backend.services import llm_client
from backend.services.ai import orchestrator as orch
from backend.services.ai import vision as vision_mod
from backend.tests.support.chaos_lab import (
    GARBAGE,
    MAX_ATTEMPTS_PER_CALL,
    OK,
    R429,
    ScriptedProvider,
    answer_text,
    chaos_lab,
    ok_with_cost,
    provider_error,
)


def test_script_plays_in_order_then_repeats_its_last_fault():
    p = ScriptedProvider({"groq": [OK, R429]})
    assert p.call_provider("groq", "x") == ("ok:groq", None)
    for _ in range(2):
        with pytest.raises(openai.APIStatusError) as caught:
            p.call_provider("groq", "x")
        assert caught.value.status_code == 429
    assert p.plays("groq") == [OK, R429, R429]
    assert p.calls_to("groq") == 3


def test_unscripted_leg_behaves_as_a_retired_model():
    p = ScriptedProvider({})
    with pytest.raises(openai.APIStatusError) as caught:
        p.call_provider("mistral", "x")
    assert caught.value.status_code == 404


def test_google_legs_fail_with_google_sdk_errors():
    err = provider_error("gemini", "404")
    assert isinstance(err, genai_errors.ClientError)
    assert err.code == 404
    # The shape that hides a Gemini 404 from status_code / "error code: 404" sniffs.
    assert getattr(err, "status_code", None) is None
    assert "error code: 404" not in str(err).lower()
    assert isinstance(provider_error("gemma", "503"), genai_errors.ServerError)


def test_openai_family_402_carries_the_historic_quota_body():
    err = provider_error("openrouter", "402")
    assert err.status_code == 402
    assert "quota" in str(err).lower()


def test_ok_with_cost_reports_usage_and_lands_in_the_ledger():
    p = ScriptedProvider({"openai": [ok_with_cost(10_000)]})
    text, usage = p.call_provider("openai", "x")
    assert text == "ok:openai"
    assert usage.completion_tokens == 10_000
    assert p.openai_cost_usd() > 0


def test_garbage_answer_is_unparseable():
    p = ScriptedProvider({"gemma": [GARBAGE]})
    text, _usage = p.call_provider("gemma", "x")
    assert text == answer_text("gemma", GARBAGE)
    assert orch.parse_json_response(text) == {}


def test_lab_installs_fresh_global_state_and_restores_it():
    def snapshot():
        return (
            orch._rotator, vision_mod._rotator, orch._call_provider,
            orch._clients, llm_client._call_with_retry, orch.time,
        )

    before = snapshot()
    with chaos_lab({}) as lab:
        assert orch._rotator is lab.rotator
        assert vision_mod._rotator is lab.rotator
        assert lab.rotator is not before[0]
        assert orch._call_provider == lab.provider.call_provider
        # every leg has a (fake) client, so a fresh rotator offers the whole chain
        assert orch._rotator.available(orch.BULK_CHAIN) == orch.BULK_CHAIN
    after = snapshot()
    assert all(a is b for a, b in zip(after, before))


def test_frozen_clock_lapses_backoff_without_sleeping():
    with chaos_lab({}) as lab:
        lab.rotator.record_rate_limit("groq")
        assert lab.rotator.available(["groq", "openrouter"]) == ["openrouter"]
        lab.clock.advance(601.0)
        assert lab.rotator.available(["groq", "openrouter"]) == ["groq", "openrouter"]


def test_retries_run_without_real_backoff_sleeps():
    with chaos_lab({pid: [R429] for pid in orch.BULK_CHAIN}) as lab:
        started = time.perf_counter()
        [outcome] = lab.run("generate_text_bulk", 1)
        elapsed = time.perf_counter() - started
    assert isinstance(outcome, llm_client.LLMRateLimitError), outcome
    assert len(lab.provider.calls) == len(orch.BULK_CHAIN) * MAX_ATTEMPTS_PER_CALL
    assert elapsed < 5.0, f"retries slept for real ({elapsed:.1f}s)"


def test_vision_seams_are_scripted():
    with chaos_lab({"openai_vision": [OK]}) as lab:
        result = vision_mod._sync_analyze_vision("b64", raw_text="x", ai_model="openai")
    assert result["served_by"] == "openai_vision"
    assert lab.provider.calls_to("openai_vision") == 1
