> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Parent plan: docs/superpowers/plans/2026-10-10-ai-backend-deep-session.md (Global Constraints bind).

# Arc 9: Per-user attribution and caps for parse-time AI spend (TDD plan)

Worktree: `/Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/arc9-parse-spend` (branch `claude/arc9-parse-spend` @ ffd7fa6). Every command runs from the worktree root.

## What I found in the code

**Accounting tail.** `orchestrator._account_for_call(provider_id, model, usage, *, user_id, course_id, feature, duration_seconds, prompt_name=None)` is the one place that calls `log_llm_call` and `record_user_llm_spend`.
- `batch_analyze_text_slides` (line 1861) and `_regenerate_failing_slide_quizzes` (line 2030) pass `user_id=None, course_id=None` hard-coded.
- They do not go through `generate_text` / `generate_text_bulk`. They call `_generate_with_rotation` directly, so they have no budget check at all today.

**Budget gate today.** `generate_text` and `generate_text_bulk` only run `if user_id: await check_user_llm_budget(user_id)`.

**Vision.** `vision.py` does not reach `_account_for_call`: no cost row, no gate. PR #92 adds vision metering. Arc 9 gates vision at the call site in `unified_orchestrator._synthesize_slide` and leaves `vision.py` untouched.

**Parse run context.** `parse_pdf_unified` pushes it at line 722: `push_llm_call_context(run_id=str(run_uuid), calls=served_calls)`. It is popped in `finally` at line 1303. Child steps use `llm_call_scope(...)`.

**Swallowed LLM errors.** Several steps catch their own LLM errors, so a budget refusal raised inside them never reaches the parse:
- `_synthesize_text_slide_batch` catches Exception and falls back to per-slide calls.
- The per-slide and vision paths use `gather(return_exceptions=True)`.
- `_synthesize_slide`'s vision path catches everything.
- Meta, deck quiz, cross-lecture quiz, syllabus facts and quiz repair are all non-fatal `except Exception`.

So a refusal needs a latched flag that the pipeline checks between steps.

**Schema.** `parse_runs` has only a free-text `error` column; `repos.set_error(run_id, error)` sets status FAILED. There is no error-code column, and Arc 9 needs no migration. The stable code goes on the SSE `error` event as `{"message", "code"}`. The message is what `GET /upload/jobs` shows the owner.

**Failure path.** The except block finalizes a partial lecture when `created_lecture_id and slide_db_ids`, then calls `set_error`, emits `error`, and re-raises.
- Arq does not retry plain exceptions, but the re-raise does reach the DLQ capture.
- A budget refusal is an expected business outcome, so the plan returns the run id instead of re-raising. This is not a crash and does not land in the DLQ.

**Callers.** `materials_service.create_upload` enqueues with `user_id=user_id, visibility="private_student", student_owner_id=user_id` and no `course_id`.

**`llm_calls` foreign keys.** `user_id REFERENCES auth.users ON DELETE SET NULL`, `course_id REFERENCES courses ON DELETE SET NULL`. `log_llm_call` swallows insert errors, so `""` must never be passed as an id; the plan uses `or None`.

**Test fakes available:**
- `backend/tests/fake_redis.FakeRedis` has `get`, `incrbyfloat`, `expire`.
- `cost.get_redis_or_none` is the patch seam (it already returns None in tests, so the gate fails open).
- `test_unified_orchestrator._patch_common(monkeypatch, run_status=..., lecture_id=None, pages=None) -> (rec, run)`, plus `_long_pages(n)` and `OWNER`.
- `backend/tests/unit/__init__.py` exists, so those helpers are importable.
- `asyncio_mode = auto`.
- `orchestrator.QuizBatchConfig(batch_size, context_overlap)` is a frozen dataclass; `QUIZ_BATCH_CONFIG` is a module global that `parse_pdf_unified` imports at call time, so it can be patched.

**Effect on PR #92.**
- `cost.py` diff is zero.
- `vision.py` diff is zero.
- In `orchestrator.py`, Arc 9 touches `_account_for_call`, the gate line in `generate_text` / `generate_text_bulk`, and one inserted line each in `batch_analyze_text_slides` and `_regenerate_failing_slide_quizzes`.
- The tests derive cost from `estimate_cost(...)` and set the cap relative to it, so #92's price changes can't break them.

## Design summary

**Context fields (`call_context.py`).** `LLMCallContext` gains `user_id`, `course_id` and `budget: Optional[ParseBudget]`. `ParseBudget(enforce: bool, exceeded: bool = False)` is mutable and shared by reference, like `calls`. A refusal seen in any Task of the parse latches `exceeded`.

**Attribution (`_account_for_call`).** Explicit args win; otherwise it uses the context's `user_id` / `course_id`. There is still exactly one record per call.

**Gate (`orchestrator.enforce_llm_budget(user_id=None)`).**
- An explicit user is checked exactly as before.
- Otherwise, if the context budget is enforced, it checks the context user, latches `exceeded` on refusal, and refuses all later calls without another Redis read.
- It is used by `generate_text`, `generate_text_bulk`, `batch_analyze_text_slides`, `_regenerate_failing_slide_quizzes`, the vision path in `_synthesize_slide`, and the parse pre-flight.

**Parse (`parse_pdf_unified`).**
- Billed user = `student_owner_id` for `private_student`, else `user_id`.
- `enforce` comes from `settings.llm_parse_budget_enforce`: `students` gates private uploads only, `all` gates every parse, `off` never gates.
- Pre-flight runs after the run row exists and the lock is held, before the PDF fetch and any LLM call. Skip-AI parses are not checked.
- Latch checkpoints sit after meta, at the top of each chunk, and before finalize.
- A batch refusal is re-raised rather than falling back to per-slide calls.
- An over-budget parse ends with run FAILED, `error = PARSE_BUDGET_ERROR_MESSAGE`, SSE `error {message, code: "monthly_ai_budget_exceeded"}`, a partial lecture finalized by the existing except path, and no re-raise.

**DB tests: none.** No SQL changes. The change is which value flows into the existing `user_id` / `course_id` args, and the unit tests pin that at the `log_llm_call` boundary. The existing `backend/tests/db/test_llm_calls_run_context.py` already covers the columns.

---

## Task 1: Config `llm_parse_budget_enforce` and context fields `user_id`/`course_id`/`budget`

**Files**
- `backend/core/config.py`
- `backend/services/ai/call_context.py`
- `backend/tests/unit/test_parse_spend_attribution.py` (new)

**Interfaces**
- Consumes: `pydantic_settings.BaseSettings`, `dataclasses.replace` (via `push_llm_call_context`).
- Produces:
  - `Settings.llm_parse_budget_enforce: Literal["students", "all", "off"]` (env `LLM_PARSE_BUDGET_ENFORCE`, default `"students"`)
  - `@dataclass class ParseBudget: enforce: bool; exceeded: bool = False`
  - `LLMCallContext.user_id: Optional[str] = None`, `LLMCallContext.course_id: Optional[str] = None`, `LLMCallContext.budget: Optional[ParseBudget] = None`

**Step 1: failing test.** Create `backend/tests/unit/test_parse_spend_attribution.py`:
```python
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
```

**Step 2: run, expect failure.**
```
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_parse_spend_attribution.py -m "not db" -q -p no:cacheprovider
```
Expected: collection error `ImportError: cannot import name 'ParseBudget' from 'backend.services.ai.call_context'`.

**Step 3: minimal implementation.**

`backend/core/config.py`: replace the import block at lines 9–11 with:
```python
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AliasChoices, Field, model_validator
```
Directly after the `llm_monthly_user_cost_cap_usd` field (ends at line 176), insert:
```python
    # Arc 9: which parses the per-user monthly cap above can REFUSE. Every
    # parse's LLM calls are attributed to its uploader (llm_calls.user_id and
    # the Redis running total) whatever this says; it only decides gating.
    #   "students" (default) - private "My Materials" uploads only
    #   "all"                - every parse, professors included
    #   "off"                - attribute, never refuse
    llm_parse_budget_enforce: Literal["students", "all", "off"] = Field(
        alias="LLM_PARSE_BUDGET_ENFORCE", default="students"
    )
```

`backend/services/ai/call_context.py`: replace the `LLMCallContext` class with:
```python
@dataclass
class ParseBudget:
    """Arc 9: one parse's spend-cap state. Mutable and shared BY REFERENCE with
    every child context (like ``calls``), so a refusal seen in any Task of the
    parse is visible to the pipeline even when the step that saw it swallowed
    the error. ``enforce`` is decided once per parse from
    settings.llm_parse_budget_enforce; ``exceeded`` latches the first refusal."""

    enforce: bool
    exceeded: bool = False


@dataclass(frozen=True)
class LLMCallContext:
    run_id: Optional[str] = None
    slide_indices: Optional[Tuple[int, ...]] = None
    prompt_name: Optional[str] = None
    calls: Optional[List[ServedCall]] = None
    # Arc 9: the parse's uploader and course. orchestrator._account_for_call
    # bills a call to them when the call site passed no user_id/course_id.
    user_id: Optional[str] = None
    course_id: Optional[str] = None
    budget: Optional[ParseBudget] = None
```

**Step 4: green.** Same command: 7 passed. Then the regression check:
```
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_llm_call_context.py backend/tests/unit/test_unified_orchestrator.py -m "not db" -q -p no:cacheprovider
```
Expected: all pass.

**Step 5: mutation-verify.** In `config.py`, change `llm_parse_budget_enforce: Literal["students", "all", "off"] = Field(` to `llm_parse_budget_enforce: str = Field(`. `test_parse_budget_enforce_rejects_unknown_modes` must fail with DID NOT RAISE. Revert.

**Commit message**
```
feat(ai): parse budget setting and uploader/course/budget in LLM call context

Arc 9 step 1: LLM_PARSE_BUDGET_ENFORCE (students|all|off, default students)
and LLMCallContext.user_id/course_id/budget, with ParseBudget shared by
reference across a parse's child contexts so a refusal latches parse-wide.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Task 2: `_account_for_call` attributes unattributed calls to the parse context

**Files**
- `backend/services/ai/orchestrator.py` (`_account_for_call`, lines 1271–1339)
- `backend/tests/unit/test_parse_spend_attribution.py` (append)

**Interfaces**
- Consumes: `current_llm_call_context() -> LLMCallContext` (with `.user_id`, `.course_id`); `cost.log_llm_call(**kw)`; `cost.record_user_llm_spend(user_id: str, cost_usd: float)`.
- Produces: unchanged signature `async def _account_for_call(provider_id: str, model: str, usage: Optional[LLMUsage], *, user_id: Optional[str], course_id: Optional[str], feature: str, duration_seconds: float, prompt_name: Optional[str] = None) -> None`. Explicit `user_id` / `course_id` win; `None` falls back to the context; one log row and at most one spend record per call.

**Step 1: failing test.** Append to `backend/tests/unit/test_parse_spend_attribution.py`:
```python
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
```

**Step 2: run, expect failure.** Same command as Task 1. Expected: `test_parse_context_attributes_an_unattributed_call` fails with `assert (None, None) == ('student-1', 'course-1')`. The other two pass; they are guards.

**Step 3: minimal implementation.** Replace the whole `_account_for_call` function in `orchestrator.py` with:
```python
async def _account_for_call(
    provider_id: str,
    model: str,
    usage: Optional["LLMUsage"],
    *,
    user_id: Optional[str],
    course_id: Optional[str],
    feature: str,
    duration_seconds: float,
    prompt_name: Optional[str] = None,
) -> None:
    """Shared cost-accounting tail for generate_text/generate_text_bulk
    (Roadmap P1-1): mirrors this call's provider count (and openai's cost, if
    any) to Redis for fleet-wide budget tracking, logs the completion to
    ``public.llm_calls``, and — when a user is known — adds to that user's
    running monthly spend. It also emits the completed call's latency, cost,
    and token usage to Prometheus.

    Arc 7: the current ``call_context`` (set by the parse orchestrator) tags
    the row with run_id / slide_indices / prompt_name, and the serving call is
    recorded for the parse receipt. An explicit ``prompt_name`` wins over the
    context's.

    Arc 9: a call made inside a parse without its own ``user_id`` /
    ``course_id`` is billed to the parse's uploader and course from the
    context. Explicit arguments always win, and the spend is recorded exactly
    once per call. Entirely best-effort; never raises."""
    from backend.services.ai.call_context import (
        ServedCall,
        current_llm_call_context,
        record_served_call,
    )
    from backend.services.ai.cost import estimate_cost, log_llm_call, record_user_llm_spend
    from backend.core.metrics import (
        LLM_CALL_COST_USD_TOTAL,
        LLM_CALL_DURATION_SECONDS,
        LLM_CALL_TOKENS_TOTAL,
    )

    call_ctx = current_llm_call_context()
    if user_id is None:
        user_id = call_ctx.user_id
    if course_id is None:
        course_id = call_ctx.course_id

    await _rotator.flush_success_to_redis(provider_id)
    cost = estimate_cost(provider_id, model, usage)
    if provider_id == "openai" and cost > 0:
        await _rotator.flush_openai_cost_to_redis(cost)
    name = prompt_name or call_ctx.prompt_name
    from backend.services.ai.prompts import PROMPT_VERSIONS, get_prompt_version
    # Recorded at call time so a later prompt bump never rewrites history;
    # None for a free-form name that is not a registered prompt.
    version = get_prompt_version(name) if name in PROMPT_VERSIONS else None
    record_served_call(ServedCall(
        provider=provider_id,
        model=model,
        prompt_tokens=usage.prompt_tokens if usage else 0,
        completion_tokens=usage.completion_tokens if usage else 0,
        cost_usd=cost,
        prompt_name=name,
        slide_indices=call_ctx.slide_indices,
        prompt_version=version,
    ))
    await log_llm_call(
        user_id=user_id, course_id=course_id, feature=feature,
        provider_id=provider_id, model=model, usage=usage, cost_usd=cost,
        run_id=call_ctx.run_id, slide_indices=call_ctx.slide_indices, prompt_name=name,
        prompt_version=version,
    )
    if user_id and cost > 0:
        await record_user_llm_spend(user_id, cost)

    labels = {"provider": provider_id, "model": model, "feature": feature}
    LLM_CALL_DURATION_SECONDS.labels(**labels).observe(duration_seconds)
    LLM_CALL_COST_USD_TOTAL.labels(**labels).inc(cost)
    if usage:
        LLM_CALL_TOKENS_TOTAL.labels(**labels, kind="prompt").inc(usage.prompt_tokens)
        LLM_CALL_TOKENS_TOTAL.labels(**labels, kind="completion").inc(usage.completion_tokens)
```

**Step 4: green.** Same command: 10 passed. Also run:
```
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_llm_call_context.py backend/tests/unit/test_metrics.py backend/tests/unit/test_llm_cost.py -m "not db" -q -p no:cacheprovider
```
Expected: pass.

**Step 5: mutation-verify.** Delete these two lines:
```python
    if user_id is None:
        user_id = call_ctx.user_id
```
`test_parse_context_attributes_an_unattributed_call` must fail. Revert.

**Commit message**
```
feat(ai): bill parse-time LLM calls to the uploader and course

Arc 9 step 2: _account_for_call falls back to the call context's
user_id/course_id when its own are None, so llm_calls rows and the Redis
monthly total cover batch/vision-less parse calls. Explicit args win; one
record per call. Calls outside a parse are unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Task 3: Per-call gate `enforce_llm_budget` covering every metered text path

**Files**
- `backend/services/ai/orchestrator.py`
- `backend/tests/unit/test_parse_spend_attribution.py` (append)

**Interfaces**
- Consumes: `cost.check_user_llm_budget(user_id: str) -> None` (raises `LLMBudgetExceededError`); `current_llm_call_context().budget/.user_id`.
- Produces: `async def enforce_llm_budget(user_id: Optional[str] = None) -> None` in `backend.services.ai.orchestrator`. Called by `generate_text`, `generate_text_bulk`, `batch_analyze_text_slides`, `_regenerate_failing_slide_quizzes`; `parse_pdf_unified` and `_synthesize_slide` use it in Tasks 4–5.

**Step 1: failing test.** Append:
```python
# ── Task 3: per-call gate ───────────────────────────────────────────────────

def _fake_rotation(calls):
    def fake(prompt, chain, preferred=None, json_mode=False, prompt_name=None):
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
    assert _spent(metered.redis, "prof-1") == pytest.approx(1.0 + COST)


async def test_explicit_user_gate_is_unchanged_outside_a_parse(provider, metered):
    _over_cap(metered.redis, "learner-1")
    with pytest.raises(LLMBudgetExceededError):
        await orchestrator.generate_text("p", user_id="learner-1")
    assert provider == []
    assert await orchestrator.generate_text("p") == '{"ok": true}'
```

**Step 2: run, expect failure.** Same command. Expected:
- The enforced, latched and batch tests fail with `DID NOT RAISE <class 'LLMBudgetExceededError'>`.
- The regeneration test fails on `assert provider == []`; the provider was called.
- The unenforced and explicit-user tests pass; they are guards.

**Step 3: minimal implementation** in `orchestrator.py`.

(a) Insert directly after `_account_for_call`:
```python
async def enforce_llm_budget(user_id: Optional[str] = None) -> None:
    """Per-call spend gate, run BEFORE any provider is invoked.

    An explicit ``user_id`` is checked exactly as before (Roadmap P1-1).
    Without one, a parse whose budget is enforced (Arc 9) checks the parse's
    uploader from the call context. The first refusal latches
    ``budget.exceeded`` so the pipeline can stop even where a step swallows
    the error, and every later call of that parse is refused without another
    Redis read. Raises ``LLMBudgetExceededError``."""
    from backend.services.ai.call_context import current_llm_call_context
    from backend.services.ai.cost import check_user_llm_budget
    from backend.services.llm_client import LLMBudgetExceededError

    if user_id:
        await check_user_llm_budget(user_id)
        return
    ctx = current_llm_call_context()
    budget = ctx.budget
    if budget is None or not budget.enforce or not ctx.user_id:
        return
    if budget.exceeded:
        raise LLMBudgetExceededError("Monthly LLM spend cap reached earlier in this parse.")
    try:
        await check_user_llm_budget(ctx.user_id)
    except LLMBudgetExceededError:
        budget.exceeded = True
        raise
```

(b) In `generate_text`, replace:
```python
    from backend.services.llm_client import call_llm
    from backend.services.ai.cost import check_user_llm_budget
    from backend.services.ai.prompt_log import log_prompt_response

    if user_id:
        await check_user_llm_budget(user_id)
```
with:
```python
    from backend.services.llm_client import call_llm
    from backend.services.ai.prompt_log import log_prompt_response

    await enforce_llm_budget(user_id)
```

(c) In `generate_text_bulk`, apply the identical replacement. The block text is the same.

(d) In `batch_analyze_text_slides`, replace:
```python
    # Single LLM call via BULK chain
    try:
        from backend.services.llm_client import call_llm
```
with:
```python
    # Arc 9: the parse's spend gate (outside the try, so a refusal is not
    # logged as a failed batch call; callers decide what a refusal means).
    await enforce_llm_budget()

    # Single LLM call via BULK chain
    try:
        from backend.services.llm_client import call_llm
```

(e) In `_regenerate_failing_slide_quizzes`, replace:
```python
    try:
        from backend.services.llm_client import call_llm
        preferred = _resolve_preferred(ai_model)
        await _rotator.refresh_from_redis(BULK_CHAIN)
        call_started = time.perf_counter()
        raw, provider_id, model, usage = await call_llm(
            lambda: _generate_with_rotation(
                full_prompt, BULK_CHAIN, preferred=preferred,
                json_mode=True, prompt_name="BATCH_SLIDE_QUIZ_REGEN_PROMPT",
```
with:
```python
    try:
        # Arc 9: a refusal lands in the except below (keep originals); the
        # latched parse budget still stops the parse.
        await enforce_llm_budget()
        from backend.services.llm_client import call_llm
        preferred = _resolve_preferred(ai_model)
        await _rotator.refresh_from_redis(BULK_CHAIN)
        call_started = time.perf_counter()
        raw, provider_id, model, usage = await call_llm(
            lambda: _generate_with_rotation(
                full_prompt, BULK_CHAIN, preferred=preferred,
                json_mode=True, prompt_name="BATCH_SLIDE_QUIZ_REGEN_PROMPT",
```

**Step 4: green.** Same command: 16 passed. Also run:
```
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit -m "not db" -q -p no:cacheprovider
```
Expected: the full unit suite is green. Without a parse context, or with `budget=None`, the gate is a no-op, and Redis is None in tests, so it fails open.

**Step 5: mutation-verify.**
- In `enforce_llm_budget`, delete the line `        budget.exceeded = True`. `test_enforced_parse_context_refuses_before_the_provider` must fail on `budget.exceeded is True`, and the regeneration test must fail too. Revert.
- In `generate_text_bulk`, replace `    await enforce_llm_budget(user_id)` with `    if user_id:\n        await check_user_llm_budget(user_id)` (re-adding the cost import). The enforced test must fail with DID NOT RAISE. Revert.

**Commit message**
```
feat(ai): enforce_llm_budget gates every metered text call by parse budget

Arc 9 step 3: generate_text, generate_text_bulk, batch_analyze_text_slides
and the quiz-regeneration batch now run one gate: explicit user_id as before,
else the enforced parse's uploader from the call context. The first refusal
latches ParseBudget.exceeded; later calls refuse without a Redis read.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Task 4: `parse_pdf_unified` attributes, pre-flights and surfaces a clean budget failure

**Files**
- `backend/services/parser/unified_orchestrator.py`
- `backend/tests/unit/test_parse_spend_caps.py` (new)

**Interfaces**
- Consumes: `ParseBudget`, `push_llm_call_context(**changes)`, `orchestrator.enforce_llm_budget()`, `LLMBudgetExceededError`, `repos.set_error(run_id, error)`, `settings.llm_parse_budget_enforce`.
- Produces:
  - `PARSE_BUDGET_ERROR_CODE: str = "monthly_ai_budget_exceeded"`
  - `PARSE_BUDGET_ERROR_MESSAGE: str`
  - `def _parse_budget_enforced(visibility: str) -> bool`
  - Run context: `push_llm_call_context(run_id=str(run_uuid), calls=served_calls, user_id=billed_user, course_id=course_id or None, budget=ParseBudget(enforce=...))`
  - On refusal: `set_error(run_uuid, PARSE_BUDGET_ERROR_MESSAGE)`, SSE `("error", {"message": PARSE_BUDGET_ERROR_MESSAGE, "code": PARSE_BUDGET_ERROR_CODE})`, returns `str(run_uuid)` without re-raising.

**Step 1: failing test.** Create `backend/tests/unit/test_parse_spend_caps.py`:
```python
"""Arc 9: parse-time AI spend is billed to the uploader and capped.

Real gate + real accounting tail over an in-memory Redis; the provider is
faked at orchestrator._generate_with_rotation (the seam every metered text
call goes through), so no network is touched."""
from __future__ import annotations

import asyncio
import types

import pytest

from backend.core.config import settings
from backend.domain.parse_models import RunStatus
from backend.services.ai import cost as cost_module
from backend.services.ai import orchestrator as ai_orchestrator
from backend.services.ai.cost import LLMUsage, estimate_cost
from backend.services.parser import unified_orchestrator as uo
from backend.tests.fake_redis import FakeRedis
from backend.tests.unit.test_unified_orchestrator import OWNER, _long_pages, _patch_common

REAL_BATCH = ai_orchestrator.batch_analyze_text_slides
REAL_SYNTH = uo._synthesize_slide
OTHER = "22222222-2222-2222-2222-222222222222"
COURSE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
COURSE_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
STUDENT = {"visibility": "private_student", "student_owner_id": OWNER}
USAGE = LLMUsage(prompt_tokens=100_000, completion_tokens=0)
COST = estimate_cost("openai", "gpt-4o-mini", USAGE)


@pytest.fixture
def spend(monkeypatch):
    redis = FakeRedis()
    rows: list = []
    provider_calls: list = []

    async def fake_log(**kwargs):
        rows.append(kwargs)

    async def noop(*_a, **_k):
        return None

    def fake_rotation(prompt, chain, preferred=None, json_mode=False, prompt_name=None):
        provider_calls.append(prompt_name)
        return ('[{"title": "T", "summary": "S", "slide_type": "text", "questions": []}]',
                "openai", "gpt-4o-mini", USAGE)

    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: redis)
    monkeypatch.setattr(cost_module, "log_llm_call", fake_log)
    monkeypatch.setattr(ai_orchestrator._rotator, "flush_success_to_redis", noop)
    monkeypatch.setattr(ai_orchestrator._rotator, "flush_openai_cost_to_redis", noop)
    monkeypatch.setattr(ai_orchestrator._rotator, "refresh_from_redis", noop)
    monkeypatch.setattr(ai_orchestrator, "_generate_with_rotation", fake_rotation)
    monkeypatch.setattr(settings, "llm_monthly_user_cost_cap_usd", 1.0)
    monkeypatch.setattr(settings, "llm_parse_budget_enforce", "students")
    return types.SimpleNamespace(redis=redis, rows=rows, provider_calls=provider_calls)


def _use_real_batch(monkeypatch, batch_size=1):
    """After _patch_common: route text slides through the REAL batch call
    (gate + accounting), one slide per chunk."""
    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", REAL_BATCH)
    monkeypatch.setattr(ai_orchestrator, "QUIZ_BATCH_CONFIG",
                        ai_orchestrator.QuizBatchConfig(batch_size=batch_size, context_overlap=0))


def _over_cap(spend, user=OWNER):
    spend.redis.store[cost_module._user_monthly_cost_key(user)] = settings.llm_monthly_user_cost_cap_usd


def _spent(spend, user):
    return float(spend.redis.store.get(cost_module._user_monthly_cost_key(user), 0.0))


def _count_meta(monkeypatch):
    import backend.services.parser.synthesis as synthesis
    seen: list = []

    async def meta(slides, model, course_context_hint="", source_language="en", skeleton=None):
        seen.append(model)
        return {"title": "DB Lecture", "summary": "Deck summary."}

    monkeypatch.setattr(synthesis, "analyze_lecture_meta", meta)
    return seen


async def _parse(pdf_hash, user, **kw):
    events: list = []

    async def emit(t, d):
        events.append((t, d))

    result = await uo.parse_pdf_unified({}, pdf_hash=pdf_hash, user_id=user, emit_fn=emit, **kw)
    return result, events


def _budget_error(events):
    (err,) = [d for t, d in events if t == "error"]
    return err


# ── Task 4: pre-flight, modes, attribution ──────────────────────────────────

async def test_private_upload_over_budget_fails_before_any_llm_call(monkeypatch, spend):
    rec, run = _patch_common(monkeypatch, pages=_long_pages(3))
    meta_calls = _count_meta(monkeypatch)
    _over_cap(spend)
    result, events = await _parse("h", OWNER, **STUDENT)
    assert result == str(run.run_id)
    assert spend.provider_calls == [] and meta_calls == [] and "batch_calls" not in rec
    assert rec["lectures"] == [] and rec["slides"] == []
    assert rec["errors"] == [uo.PARSE_BUDGET_ERROR_MESSAGE]
    assert RunStatus.COMPLETED not in rec["status"]
    assert _budget_error(events) == {"message": uo.PARSE_BUDGET_ERROR_MESSAGE,
                                     "code": uo.PARSE_BUDGET_ERROR_CODE}
    assert "complete" not in [t for t, _ in events]


async def test_skip_ai_parse_is_never_refused(monkeypatch, spend):
    rec, _run = _patch_common(monkeypatch, pages=_long_pages(2))
    _over_cap(spend)
    _result, events = await _parse("h", OWNER, parsing_mode="on_demand", **STUDENT)
    assert events[-1][0] == "complete"
    assert rec["errors"] == []


async def test_professor_over_budget_still_parses_in_students_mode(monkeypatch, spend):
    rec, _run = _patch_common(monkeypatch, pages=_long_pages(2))
    _use_real_batch(monkeypatch)
    _over_cap(spend)
    _result, events = await _parse("h", OWNER)
    assert events[-1][0] == "complete"
    assert len(spend.provider_calls) == 2
    assert rec["errors"] == []
    assert [r["user_id"] for r in spend.rows] == [OWNER, OWNER]


async def test_all_mode_gates_professor_parses(monkeypatch, spend):
    monkeypatch.setattr(settings, "llm_parse_budget_enforce", "all")
    rec, _run = _patch_common(monkeypatch, pages=_long_pages(2))
    _use_real_batch(monkeypatch)
    _over_cap(spend)
    _result, events = await _parse("h", OWNER)
    assert spend.provider_calls == []
    assert rec["lectures"] == []
    assert rec["errors"] == [uo.PARSE_BUDGET_ERROR_MESSAGE]
    assert _budget_error(events)["code"] == uo.PARSE_BUDGET_ERROR_CODE


async def test_off_mode_never_refuses_but_still_attributes(monkeypatch, spend):
    monkeypatch.setattr(settings, "llm_parse_budget_enforce", "off")
    rec, _run = _patch_common(monkeypatch, pages=_long_pages(2))
    _use_real_batch(monkeypatch)
    _over_cap(spend)
    _result, events = await _parse("h", OWNER, **STUDENT)
    assert events[-1][0] == "complete"
    assert len(spend.provider_calls) == 2
    assert [r["user_id"] for r in spend.rows] == [OWNER, OWNER]
    assert _spent(spend, OWNER) == pytest.approx(settings.llm_monthly_user_cost_cap_usd + 2 * COST)


async def test_private_upload_is_billed_to_the_student_owner(monkeypatch, spend):
    _patch_common(monkeypatch, pages=_long_pages(1))
    _use_real_batch(monkeypatch)
    await _parse("h", OTHER, visibility="private_student", student_owner_id=OWNER)
    assert [r["user_id"] for r in spend.rows] == [OWNER]
    assert _spent(spend, OTHER) == 0.0


async def test_concurrent_parses_bill_their_own_uploader_and_course(monkeypatch, spend):
    _patch_common(monkeypatch, pages=_long_pages(3))
    _use_real_batch(monkeypatch)
    await asyncio.gather(
        _parse("ha", OWNER, course_id=COURSE_A),
        _parse("hb", OTHER, course_id=COURSE_B),
    )
    pairs = sorted((r["user_id"], r["course_id"]) for r in spend.rows)
    assert pairs == sorted([(OWNER, COURSE_A)] * 3 + [(OTHER, COURSE_B)] * 3)
    assert _spent(spend, OWNER) == pytest.approx(3 * COST)
    assert _spent(spend, OTHER) == pytest.approx(3 * COST)
```

**Step 2: run, expect failure.**
```
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_parse_spend_caps.py -m "not db" -q -p no:cacheprovider
```
Expected failures:
- The pre-flight and `all`-mode tests fail: the parse completes and `uo.PARSE_BUDGET_ERROR_MESSAGE` does not exist (AttributeError).
- The professor, off-mode, student-owner and concurrent tests fail with rows `user_id None`.
- `test_skip_ai_parse_is_never_refused` passes; it is a guard.

**Step 3: minimal implementation** in `unified_orchestrator.py`.

(a) Replace the `call_context` import block (lines 52–58) and add the error import:
```python
from backend.services.ai.call_context import (
    CallLog,
    ParseBudget,
    ServedCall,
    current_llm_call_context,
    llm_call_scope,
    pop_llm_call_context,
    push_llm_call_context,
)
from backend.services.llm_client import LLMBudgetExceededError
from backend.services.parser import repos, persist, poster
```
The last line already exists; keep it once. `current_llm_call_context` is used in Task 5.

(b) After `class InsufficientHeadroomError(...)` (ends line 89), add:
```python
# Arc 9: what a budget-refused parse reports. parse_runs has one free-text
# ``error`` column (no code column), so the stable code rides on the SSE
# ``error`` event and the message is what GET /upload/jobs shows the owner.
PARSE_BUDGET_ERROR_CODE = "monthly_ai_budget_exceeded"
PARSE_BUDGET_ERROR_MESSAGE = (
    "Your monthly AI processing limit has been reached, so this file was not "
    "processed. The limit resets at the start of next month."
)


def _parse_budget_enforced(visibility: str) -> bool:
    """Arc 9: does settings.llm_parse_budget_enforce let this parse be refused?"""
    mode = settings.llm_parse_budget_enforce
    if mode == "all":
        return True
    if mode == "students":
        return visibility == "private_student"
    return False
```

(c) Replace:
```python
        run_uuid = run.run_id
        llm_ctx_token = push_llm_call_context(run_id=str(run_uuid), calls=served_calls)
```
with:
```python
        run_uuid = run.run_id
        # Arc 9: bill every LLM call of this parse to its uploader and course
        # (_account_for_call reads them from the context), and decide once
        # whether this parse's calls may be refused for budget.
        billed_user = (
            student_owner_id if visibility == "private_student" and student_owner_id else user_id
        )
        llm_ctx_token = push_llm_call_context(
            run_id=str(run_uuid), calls=served_calls,
            user_id=billed_user or None, course_id=course_id or None,
            budget=ParseBudget(enforce=_parse_budget_enforced(visibility)),
        )
```

(d) Replace:
```python
            return str(run_uuid)

        await repos.set_status(run_uuid, RunStatus.EXTRACTING)
```
(the end of the `if not got_lock:` block) with:
```python
            return str(run_uuid)

        # Arc 9 pre-flight: refuse an over-budget parse after the run row
        # exists (so the refusal is recorded on it) and before the PDF fetch,
        # the lecture row, or any LLM call. Skip-AI parses make no synthesis
        # calls, so they are never refused here.
        if parsing_mode != "on_demand":
            from backend.services.ai.orchestrator import enforce_llm_budget
            await enforce_llm_budget()

        await repos.set_status(run_uuid, RunStatus.EXTRACTING)
```

(e) Replace the body of `except (Exception, asyncio.CancelledError) as exc:` from `is_cancellation = isinstance(exc, asyncio.CancelledError)` through the final `raise`. Keep the long R51/R52 comment above it verbatim:
```python
        is_cancellation = isinstance(exc, asyncio.CancelledError)
        # Arc 9: a budget refusal is an expected outcome, not a crash. It gets
        # its own message + code and is NOT re-raised (Arq would log it as a
        # failed job and dead-letter it); the partial-lecture finalize below
        # still runs, so a lecture never stays half-written without status.
        is_budget = isinstance(exc, LLMBudgetExceededError)
        if is_budget:
            logger.warning("Unified pipeline refused for pdf_hash=%s: %s", pdf_hash, exc)
        else:
            logger.exception("Unified pipeline failed for pdf_hash=%s: %s", pdf_hash, exc)
        # Full detail is in the server log above (logger.exception, with
        # traceback). What reaches the DB row / SSE stream — and from there
        # GET /upload/jobs, visible to the owning user — is a generic
        # message: str(exc) here could surface internal details (service
        # URLs, library internals) depending on what actually raised.
        if is_cancellation:
            user_facing_error = (
                "Processing timed out before it could finish. Please try again or contact "
                "support if this keeps happening."
            )
        elif is_budget:
            user_facing_error = PARSE_BUDGET_ERROR_MESSAGE
        else:
            user_facing_error = "PDF parsing failed. Please try again or contact support if this keeps happening."
        try:
            if run_uuid is not None:
                if created_lecture_id is not None and slide_db_ids:
                    await persist.finalize_lecture(created_lecture_id, deck_summary, len(slide_db_ids))
                await repos.set_error(run_uuid, user_facing_error)
        except Exception:
            pass
        error_event: Dict[str, Any] = {"message": user_facing_error}
        if is_budget:
            error_event["code"] = PARSE_BUDGET_ERROR_CODE
        try:
            await emit("error", error_event)
        except Exception:
            pass
        if is_budget:
            return str(run_uuid) if run_uuid is not None else ""
        # A caught CancelledError MUST be re-raised (not swallowed) so
        # asyncio's own cancellation bookkeeping for this task stays correct
        # — `raise` here re-raises the exact exception object either way.
        raise
```

**Step 4: green.** Same command: 7 passed. Then the full unit suite:
```
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit -m "not db" -q -p no:cacheprovider
```
Expected: green. Existing `_patch_common` tests run as `course` visibility (not enforced), the headroom tests still re-raise `InsufficientHeadroomError`, and `test_call_context_is_reset_when_the_parse_fails` still holds.

**Step 5: mutation-verify.**
- Delete:
  ```python
          if parsing_mode != "on_demand":
              from backend.services.ai.orchestrator import enforce_llm_budget
              await enforce_llm_budget()
  ```
  `test_private_upload_over_budget_fails_before_any_llm_call` must fail (meta is called and the lecture is created). Revert.
- Change `user_id=billed_user or None, course_id=course_id or None,` to `course_id=course_id or None,`. The off-mode, professor, student-owner and concurrent tests must fail. Revert.

**Commit message**
```
feat(parser): attribute parse spend to the uploader and refuse over-budget parses

Arc 9 step 4: parse_pdf_unified pushes user (student_owner_id for private
uploads), course and a ParseBudget into the run context, pre-flights the cap
before any LLM call (LLM_PARSE_BUDGET_ENFORCE: students|all|off), and ends a
refused parse as parse_runs FAILED with a specific message plus SSE
error.code=monthly_ai_budget_exceeded, without re-raising into Arq/DLQ.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Task 5: Stop mid-parse once the cap is crossed (latch checkpoints, batch re-raise, vision gate)

**Files**
- `backend/services/parser/unified_orchestrator.py`
- `backend/tests/unit/test_parse_spend_caps.py` (append)

**Interfaces**
- Consumes: `current_llm_call_context().budget`, `orchestrator.enforce_llm_budget()`.
- Produces:
  - `def _raise_if_parse_budget_exceeded() -> None` (raises `LLMBudgetExceededError` when the latched flag is set).
  - Checkpoints after meta, at the top of each chunk, and before finalize.
  - `_synthesize_text_slide_batch` re-raises `LLMBudgetExceededError` instead of falling back per slide.
  - The `_synthesize_slide` vision branch calls `enforce_llm_budget()` before render and vision; it still never raises.

**Step 1: failing test.** Append to `backend/tests/unit/test_parse_spend_caps.py`:
```python
# ── Task 5: mid-parse stop ──────────────────────────────────────────────────

def _vision_recorder(monkeypatch):
    import backend.services.ai.vision as vision
    seen: list = []

    async def fake_vision(b64, text, model, ctx):
        seen.append(ctx)
        return {"content_extraction": {"main_topic": "V", "summary": "v"}}

    monkeypatch.setattr(vision, "analyze_slide_vision", fake_vision)
    monkeypatch.setattr(uo, "_render_page_jpeg", lambda pdf, idx: b"jpeg")
    monkeypatch.setattr(uo, "_synthesize_slide", REAL_SYNTH)
    return seen


async def test_crossing_the_cap_mid_parse_stops_further_calls_and_fails_the_run(monkeypatch, spend):
    monkeypatch.setattr(settings, "llm_monthly_user_cost_cap_usd", 1.5 * COST)
    rec, _run = _patch_common(monkeypatch, pages=_long_pages(4))
    _use_real_batch(monkeypatch)
    per_slide: list = []

    async def synth(idx, *_a, **_k):
        per_slide.append(idx)
        return {"title": "X", "content": "", "summary": "Y", "slide_type": "text"}

    monkeypatch.setattr(uo, "_synthesize_slide", synth)
    _result, events = await _parse("h", OWNER, **STUDENT)

    assert len(spend.provider_calls) == 2           # slides 0 and 1; slide 2 refused pre-provider
    assert per_slide == []                           # no per-slide fallback after a refusal
    assert [s[0] for s in rec["slides"]] == [0, 1]
    assert rec["finalize"] == [("Deck summary.", 2)]  # partial lecture still finalized
    assert rec["deck_quiz"] == []
    assert rec["errors"] == [uo.PARSE_BUDGET_ERROR_MESSAGE]
    assert RunStatus.COMPLETED not in rec["status"]
    assert _budget_error(events)["code"] == uo.PARSE_BUDGET_ERROR_CODE


async def test_a_swallowed_vision_refusal_stops_the_next_chunk(monkeypatch, spend):
    monkeypatch.setattr(settings, "llm_monthly_user_cost_cap_usd", 0.5 * COST)
    rec, _run = _patch_common(monkeypatch, pages=[*_long_pages(1), "", ""])
    _use_real_batch(monkeypatch)
    vision_calls = _vision_recorder(monkeypatch)
    _result, _events = await _parse("h", OWNER, **STUDENT)
    assert len(spend.provider_calls) == 1
    assert vision_calls == []                        # vision gated before render + call
    assert [s[0] for s in rec["slides"]] == [0, 1]   # chunk 2 never started
    assert rec["errors"] == [uo.PARSE_BUDGET_ERROR_MESSAGE]


async def test_a_refusal_in_the_last_chunk_stops_before_finalize(monkeypatch, spend):
    monkeypatch.setattr(settings, "llm_monthly_user_cost_cap_usd", 1.5 * COST)
    rec, _run = _patch_common(monkeypatch, pages=[*_long_pages(2), ""])
    _use_real_batch(monkeypatch)
    vision_calls = _vision_recorder(monkeypatch)
    _result, events = await _parse("h", OWNER, **STUDENT)
    assert len(spend.provider_calls) == 2 and vision_calls == []
    assert [s[0] for s in rec["slides"]] == [0, 1, 2]
    assert rec["deck_quiz"] == []                    # finalize step never ran
    assert rec["finalize"] == [("Deck summary.", 3)]
    assert rec["errors"] == [uo.PARSE_BUDGET_ERROR_MESSAGE]
    assert "complete" not in [t for t, _ in events]


async def test_a_refused_meta_call_stops_before_the_lecture_row(monkeypatch, spend):
    import backend.services.parser.synthesis as synthesis
    rec, _run = _patch_common(monkeypatch, pages=_long_pages(2))
    _use_real_batch(monkeypatch)

    async def meta(slides, model, course_context_hint="", source_language="en", skeleton=None):
        _over_cap(spend)  # a concurrent upload by the same student spent the rest
        await ai_orchestrator.generate_text("meta prompt")
        return {"title": "never", "summary": "never"}

    monkeypatch.setattr(synthesis, "analyze_lecture_meta", meta)
    _result, _events = await _parse("h", OWNER, **STUDENT)
    assert spend.provider_calls == []
    assert rec["lectures"] == []
    assert rec["errors"] == [uo.PARSE_BUDGET_ERROR_MESSAGE]
```

**Step 2: run, expect failure.** Same command as Task 4. Expected:
- Mid-parse: `per_slide == [2, 3]` instead of `[]` (the fallback ran and the parse completed).
- Vision: `vision_calls` is non-empty.
- Last chunk: `deck_quiz == [1]` and `complete` is emitted.
- Meta: `rec["lectures"]` is non-empty.

**Step 3: minimal implementation** in `unified_orchestrator.py`.

(a) Add after `_parse_budget_enforced`:
```python
def _raise_if_parse_budget_exceeded() -> None:
    """Stop this parse once any of its LLM calls was refused for budget
    (Arc 9). Synthesis, vision, meta and quiz steps deliberately swallow their
    own LLM errors; the latched ParseBudget flag survives that."""
    budget = current_llm_call_context().budget
    if budget is not None and budget.exceeded:
        raise LLMBudgetExceededError("Monthly LLM spend cap reached during this parse.")
```

(b) In `_synthesize_slide`, replace:
```python
    try:
        import base64
        from backend.services.ai.vision import analyze_slide_vision, format_slide_content
        img = await asyncio.to_thread(_render_page_jpeg, pdf_bytes, idx)
```
with:
```python
    try:
        import base64
        from backend.services.ai.orchestrator import enforce_llm_budget
        from backend.services.ai.vision import analyze_slide_vision, format_slide_content
        # Arc 9: vision bypasses the metered text path, so the parse's spend
        # gate runs here. A refusal lands in the except below (this function
        # never raises); the latched budget flag stops the parse.
        await enforce_llm_budget()
        img = await asyncio.to_thread(_render_page_jpeg, pdf_bytes, idx)
```

(c) In `_synthesize_text_slide_batch`, replace:
```python
    except Exception as exc:
        logger.warning(
            "Batch synthesis failed for %d slide(s) starting at index %s (%s) — "
```
with:
```python
    except Exception as exc:
        # Arc 9: a budget refusal is final for the whole parse; a per-slide
        # fallback would only be refused N more times.
        if isinstance(exc, LLMBudgetExceededError):
            raise
        logger.warning(
            "Batch synthesis failed for %d slide(s) starting at index %s (%s) — "
```

(d) After the meta block, replace:
```python
        else:
            meta = {}
        lecture_title = (meta.get("title") or "").strip() or _clean_title(filename)
```
with:
```python
        else:
            meta = {}
        _raise_if_parse_budget_exceeded()  # Arc 9: before any lecture row exists
        lecture_title = (meta.get("title") or "").strip() or _clean_title(filename)
```

(e) Replace:
```python
        for chunk_start in range(0, total, chunk_size):
            chunk_end = min(chunk_start + chunk_size, total)
```
with:
```python
        for chunk_start in range(0, total, chunk_size):
            _raise_if_parse_budget_exceeded()  # Arc 9: a refusal in the last chunk ends the parse
            chunk_end = min(chunk_start + chunk_size, total)
```

(f) Replace:
```python
        # ── 6. Finalize + persist deck quiz ──────────────────────────────────
        await emit("phase", {"phase": "finalize"})
```
with:
```python
        # Arc 9: a refusal anywhere above (vision, syllabus facts, deck quiz,
        # quiz repair, all non-fatal by design) fails the run before finalize.
        _raise_if_parse_budget_exceeded()

        # ── 6. Finalize + persist deck quiz ──────────────────────────────────
        await emit("phase", {"phase": "finalize"})
```

**Step 4: green.** Same command: 11 passed. Then the full unit suite:
```
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit -m "not db" -q -p no:cacheprovider
```
Expected: green. Outside an enforced parse, the flag is never set, so the checkpoints are no-ops, and the existing vision tests in `test_unified_orchestrator.py` have no context.

**Step 5: mutation-verify.** Revert each after confirming the failure.
- Delete `        if isinstance(exc, LLMBudgetExceededError):\n            raise`. The mid-parse test must fail (`per_slide == [2]`, slides `[0, 1, 2]`).
- Delete `        await enforce_llm_budget()` in `_synthesize_slide`. The vision-chunk test must fail (`vision_calls` non-empty).
- Delete the line `            _raise_if_parse_budget_exceeded()  # Arc 9: a refusal in the last chunk ends the parse`. The vision-chunk test must fail (slides `[0, 1, 2]`).
- Delete the pre-finalize `        _raise_if_parse_budget_exceeded()`. The last-chunk test must fail (`deck_quiz == [1]`, `complete` emitted).
- Delete `        _raise_if_parse_budget_exceeded()  # Arc 9: before any lecture row exists`. The meta test must fail (a lecture is created).

**Commit message**
```
feat(parser): stop a parse once its uploader crosses the monthly AI cap

Arc 9 step 5: latched ParseBudget checkpoints after meta, per chunk and
before finalize; a refused batch no longer falls back to per-slide calls;
image-only slides are gated before render+vision. The run ends FAILED with
monthly_ai_budget_exceeded and the partial lecture is finalized.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Risks and notes (call out in the PR)

1. **Check-then-spend race.** The gate reads the Redis total before the call, and spend is recorded after. Overshoot is bounded by in-flight concurrency: one chunk's vision or per-slide gather, plus concurrent parses by the same student. That is acceptable for a monthly cap.
2. **Fail-open.** `check_user_llm_budget` fails open when Redis is missing or erroring, or when the cap is 0. That is unchanged and deliberate.
3. **Not covered by the cap:**
   - Vision is gated but not metered or recorded until PR #92 lands. After #92, its cost rows inherit the context attribution automatically if #92 routes through `_account_for_call`.
   - The admin-slide classifier (`_llm_generate_text_sync`, sync and unmetered) and embeddings remain unmetered and ungated. Both run only for course parses, never `private_student`.
4. **Localization retry is outside the parse context.** `localize_lecture` inside the parse is attributed and gated; a refusal there is swallowed and the finished lecture still completes. The retry job `localize_lecture_job` runs outside the parse context, so it is unattributed and ungated (pre-existing, bounded by backoff). Suggested follow-up: carry the user id into that job.
5. **Merge order with PR #92.**
   - Expect textual conflicts at the gate lines in `generate_text` / `generate_text_bulk` and in `_account_for_call`.
   - On rebase, keep `await enforce_llm_budget(user_id)` and the `call_ctx` user/course fallback at the top of `_account_for_call`.
   - The tests compute cost via `estimate_cost` and set caps relative to it, so they don't depend on prices.
   - If #92 changes `_generate_with_rotation`'s signature, update the two fakes.
6. **Frontend.** No change is required: the run row shows the new message and SSE gains an optional `code`. Optional follow-up: map `monthly_ai_budget_exceeded` to an i18n string (the message is English-only, as are the existing parse errors).
7. **Foreign keys on `llm_calls`.** `llm_calls.user_id` / `course_id` are FKs. A deleted user or course mid-parse makes the best-effort row insert fail; `log_llm_call` swallows it, and the Redis spend is still recorded. Empty strings are normalized to None.

### Critical Files for Implementation
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/arc9-parse-spend/backend/services/parser/unified_orchestrator.py
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/arc9-parse-spend/backend/services/ai/orchestrator.py
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/arc9-parse-spend/backend/services/ai/call_context.py
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/arc9-parse-spend/backend/core/config.py
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/arc9-parse-spend/backend/tests/unit/test_unified_orchestrator.py (source of `_patch_common`, `_long_pages`, `OWNER` reused by the new tests)