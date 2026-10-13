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


async def test_budget_refusal_releases_the_lock_and_leaves_the_run_terminal(monkeypatch, spend):
    released: list = []

    async def fake_acquire(_redis, _key, _ttl):
        return True

    async def fake_release(_redis, key):
        released.append(key)

    monkeypatch.setattr(uo, "acquire_job_lock", fake_acquire)
    monkeypatch.setattr(uo, "release_job_lock", fake_release)
    rec, _run = _patch_common(monkeypatch, pages=_long_pages(3))
    _over_cap(spend)
    await _parse("h", OWNER, **STUDENT)
    assert released == [uo.parse_lock_key("h")]
    # set_error is what flips the run to FAILED; nothing may move it on after.
    assert rec["errors"] == [uo.PARSE_BUDGET_ERROR_MESSAGE]
    assert RunStatus.EXTRACTING not in rec["status"] and RunStatus.COMPLETED not in rec["status"]


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


# ── Task 5 controller addition: explicit user == the parse's user ───────────

def _enforced_ctx(user=OWNER, enforce=True, exceeded=False):
    from backend.services.ai.call_context import ParseBudget, push_llm_call_context
    budget = ParseBudget(enforce=enforce, exceeded=exceeded)
    push_llm_call_context(run_id="r", calls=[], user_id=user, course_id=None, budget=budget)
    return budget


async def test_explicit_parse_user_refusal_latches_the_budget(spend):
    from backend.services.llm_client import LLMBudgetExceededError
    budget = _enforced_ctx()
    _over_cap(spend)
    with pytest.raises(LLMBudgetExceededError):
        await ai_orchestrator.enforce_llm_budget(OWNER)
    assert budget.exceeded is True


async def test_latched_budget_refuses_an_explicit_parse_user_without_a_redis_read(monkeypatch, spend):
    from backend.services.llm_client import LLMBudgetExceededError
    _enforced_ctx(exceeded=True)

    async def boom(_user):
        raise AssertionError("must not read Redis once latched")

    monkeypatch.setattr(cost_module, "check_user_llm_budget", boom)
    with pytest.raises(LLMBudgetExceededError):
        await ai_orchestrator.enforce_llm_budget(OWNER)


async def test_explicit_other_user_or_unenforced_context_is_unchanged(spend):
    from backend.services.llm_client import LLMBudgetExceededError
    budget = _enforced_ctx(exceeded=True)
    await ai_orchestrator.enforce_llm_budget(OTHER)          # other user: real check, under cap
    _over_cap(spend, OTHER)
    with pytest.raises(LLMBudgetExceededError):
        await ai_orchestrator.enforce_llm_budget(OTHER)
    budget2 = _enforced_ctx(enforce=False)
    _over_cap(spend)
    with pytest.raises(LLMBudgetExceededError):
        await ai_orchestrator.enforce_llm_budget(OWNER)
    assert budget2.exceeded is False                         # off-mode never latches
