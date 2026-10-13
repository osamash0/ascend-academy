"""Arc 9: per-user attribution and caps for parse-time AI spend
(context, accounting tail, per-call gate)."""
from __future__ import annotations

import asyncio

import pytest
from pydantic import ValidationError

from backend.core.config import Settings
from backend.services.ai.call_context import (
    LLMCallContext,
    ParseBudget,
    current_llm_call_context,
    llm_call_scope,
    pop_llm_call_context,
    push_llm_call_context,
)


# ── settings ────────────────────────────────────────────────────────────────

def test_parse_budget_enforce_defaults_to_students(monkeypatch):
    monkeypatch.delenv("LLM_PARSE_BUDGET_ENFORCE", raising=False)
    assert Settings(_env_file=None).llm_parse_budget_enforce == "students"


@pytest.mark.parametrize("mode", ["students", "all", "off"])
def test_parse_budget_enforce_reads_the_env(monkeypatch, mode):
    monkeypatch.setenv("LLM_PARSE_BUDGET_ENFORCE", mode)
    assert Settings(_env_file=None).llm_parse_budget_enforce == mode


def test_parse_budget_enforce_rejects_unknown_modes(monkeypatch):
    monkeypatch.setenv("LLM_PARSE_BUDGET_ENFORCE", "professors")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


# ── context ─────────────────────────────────────────────────────────────────

def test_context_defaults_carry_no_user_course_or_budget():
    ctx = LLMCallContext()
    assert (ctx.user_id, ctx.course_id, ctx.budget) == (None, None, None)


async def test_parse_budget_is_shared_by_reference_with_child_scopes_and_tasks():
    budget = ParseBudget(enforce=True)
    token = push_llm_call_context(run_id="r", user_id="u1", course_id="c1", budget=budget)
    try:
        async def trip(i):
            with llm_call_scope(slide_indices=(i,)):
                await asyncio.sleep(0)
                current_llm_call_context().budget.exceeded = True
                return current_llm_call_context().user_id

        users = await asyncio.gather(*(trip(i) for i in range(3)))
    finally:
        pop_llm_call_context(token)
    assert users == ["u1", "u1", "u1"]
    assert budget.exceeded is True
    assert current_llm_call_context() == LLMCallContext()


# ── Task 2: _account_for_call attribution ───────────────────────────────────

import types

from backend.core.config import settings
from backend.services.ai import cost as cost_module
from backend.services.ai import orchestrator
from backend.services.ai.cost import LLMUsage, estimate_cost
from backend.services.llm_client import LLMBudgetExceededError
from backend.tests.fake_redis import FakeRedis

USAGE = LLMUsage(prompt_tokens=100_000, completion_tokens=0)
COST = estimate_cost("openai", "gpt-4o-mini", USAGE)


@pytest.fixture
def metered(monkeypatch):
    """Offline accounting: rows captured, Redis is an in-memory fake, the
    rotator's own Redis mirroring is a no-op."""
    rows: list = []
    redis = FakeRedis()

    async def fake_log(**kwargs):
        rows.append(kwargs)

    async def noop(*_a, **_k):
        return None

    monkeypatch.setattr(cost_module, "log_llm_call", fake_log)
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: redis)
    monkeypatch.setattr(orchestrator._rotator, "flush_success_to_redis", noop)
    monkeypatch.setattr(orchestrator._rotator, "flush_openai_cost_to_redis", noop)
    monkeypatch.setattr(orchestrator._rotator, "refresh_from_redis", noop)
    return types.SimpleNamespace(rows=rows, redis=redis)


def _spent(redis, user_id):
    return float(redis.store.get(cost_module._user_monthly_cost_key(user_id), 0.0))


async def _account(**kw):
    await orchestrator._account_for_call(
        "openai", "gpt-4o-mini", USAGE, feature="f", duration_seconds=0.0, **kw)


async def test_parse_context_attributes_an_unattributed_call(metered):
    assert COST > 0
    with llm_call_scope(run_id="r1", user_id="student-1", course_id="course-1"):
        await _account(user_id=None, course_id=None)
    (row,) = metered.rows
    assert (row["user_id"], row["course_id"]) == ("student-1", "course-1")
    assert _spent(metered.redis, "student-1") == pytest.approx(COST)


async def test_explicit_user_and_course_win_and_are_recorded_once(metered):
    with llm_call_scope(user_id="student-1", course_id="course-1"):
        await _account(user_id="caller-9", course_id="course-9")
    (row,) = metered.rows
    assert (row["user_id"], row["course_id"]) == ("caller-9", "course-9")
    assert _spent(metered.redis, "caller-9") == pytest.approx(COST)
    assert cost_module._user_monthly_cost_key("student-1") not in metered.redis.store


async def test_calls_outside_a_parse_stay_unattributed(metered):
    await _account(user_id=None, course_id=None)
    (row,) = metered.rows
    assert (row["user_id"], row["course_id"]) == (None, None)
    assert metered.redis.store == {}


# ── Task 3: per-call gate ───────────────────────────────────────────────────

def _fake_rotation(calls):
    def fake(prompt, chain, preferred=None, json_mode=False, prompt_name=None, **_kw):
        calls.append(prompt_name)
        return '{"ok": true}', "openai", "gpt-4o-mini", USAGE
    return fake


@pytest.fixture
def provider(monkeypatch, metered):
    calls: list = []
    monkeypatch.setattr(orchestrator, "_generate_with_rotation", _fake_rotation(calls))
    monkeypatch.setattr(settings, "llm_monthly_user_cost_cap_usd", 1.0)
    return calls


def _over_cap(redis, user_id):
    redis.store[cost_module._user_monthly_cost_key(user_id)] = 1.0


_SLIDES = [{"index": 0, "page_number": 1, "text": "A slide with plenty of text to analyse."}]


async def test_enforced_parse_context_refuses_before_the_provider(provider, metered):
    _over_cap(metered.redis, "student-1")
    budget = ParseBudget(enforce=True)
    with llm_call_scope(user_id="student-1", budget=budget):
        with pytest.raises(LLMBudgetExceededError):
            await orchestrator.generate_text_bulk("p")
        with pytest.raises(LLMBudgetExceededError):
            await orchestrator.generate_text("p")
    assert provider == []
    assert budget.exceeded is True


async def test_a_latched_refusal_needs_no_second_redis_read(provider, monkeypatch):
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: None)  # would fail open
    with llm_call_scope(user_id="student-1", budget=ParseBudget(enforce=True, exceeded=True)):
        with pytest.raises(LLMBudgetExceededError):
            await orchestrator.generate_text_bulk("p")
    assert provider == []


async def test_batch_synthesis_is_gated_by_the_parse_budget(provider, metered):
    _over_cap(metered.redis, "student-1")
    with llm_call_scope(user_id="student-1", budget=ParseBudget(enforce=True)):
        with pytest.raises(LLMBudgetExceededError):
            await orchestrator.batch_analyze_text_slides(_SLIDES)
    assert provider == []


async def test_quiz_regeneration_is_gated_and_latches_the_refusal(provider, metered):
    _over_cap(metered.redis, "student-1")
    failing = [(0, {"index": 0, "title": "T", "questions": [{"question": "q"}]})]
    budget = ParseBudget(enforce=True)
    with llm_call_scope(user_id="student-1", budget=budget):
        await orchestrator._regenerate_failing_slide_quizzes(failing, _SLIDES, {})
    assert provider == []
    assert budget.exceeded is True


async def test_unenforced_parse_context_is_attributed_but_never_refused(provider, metered):
    _over_cap(metered.redis, "prof-1")
    with llm_call_scope(user_id="prof-1", budget=ParseBudget(enforce=False)):
        assert await orchestrator.generate_text_bulk("p") == '{"ok": true}'
    assert len(provider) == 1
    assert metered.rows[0]["user_id"] == "prof-1"
    assert _spent(metered.redis, "prof-1") == pytest.approx(1.0)  # unenforced: not counted


async def test_explicit_user_gate_is_unchanged_outside_a_parse(provider, metered):
    _over_cap(metered.redis, "learner-1")
    with pytest.raises(LLMBudgetExceededError):
        await orchestrator.generate_text("p", user_id="learner-1")
    assert provider == []
    assert await orchestrator.generate_text("p") == '{"ok": true}'


async def test_course_fallback_follows_the_user(metered):
    with llm_call_scope(user_id="student-1", course_id="course-1"):
        await _account(user_id="caller-9", course_id=None)
    (row,) = metered.rows
    assert (row["user_id"], row["course_id"]) == ("caller-9", None)


async def test_empty_ids_are_treated_as_missing(metered):
    with llm_call_scope(user_id="student-1", course_id=""):
        await _account(user_id="", course_id="")
    (row,) = metered.rows
    assert (row["user_id"], row["course_id"]) == ("student-1", None)
