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
