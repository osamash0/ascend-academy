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
