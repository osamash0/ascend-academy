"""Arc 7: LLM call context (contextvar) and the accounting tail that uses it."""
from __future__ import annotations

import asyncio

import asyncpg
import pytest

from backend.services.ai import call_context as cc
from backend.services.ai.call_context import (
    LLMCallContext,
    ServedCall,
    current_llm_call_context,
    llm_call_scope,
    pop_llm_call_context,
    push_llm_call_context,
    record_served_call,
)


def _call(i: int) -> ServedCall:
    return ServedCall(provider="groq", model="m", prompt_tokens=10, completion_tokens=2,
                      cost_usd=0.0, prompt_name="SLIDE_ANALYSIS_PROMPT", slide_indices=(i,))


# ── context semantics ────────────────────────────────────────────────────────

def test_default_context_is_empty():
    assert current_llm_call_context() == LLMCallContext()


def test_scopes_nest_and_restore():
    with llm_call_scope(run_id="r1"):
        with llm_call_scope(slide_indices=(3,), prompt_name="SLIDE_ANALYSIS_PROMPT"):
            c = current_llm_call_context()
            assert (c.run_id, c.slide_indices, c.prompt_name) == ("r1", (3,), "SLIDE_ANALYSIS_PROMPT")
        assert current_llm_call_context().slide_indices is None
        assert current_llm_call_context().run_id == "r1"
    assert current_llm_call_context() == LLMCallContext()


def test_scope_restores_after_an_exception():
    with pytest.raises(RuntimeError):
        with llm_call_scope(run_id="r1"):
            raise RuntimeError("boom")
    assert current_llm_call_context().run_id is None


async def test_gathered_tasks_keep_their_own_slide_and_share_the_run_list():
    sink: list = []

    async def one(i):
        with llm_call_scope(slide_indices=(i,)):
            await asyncio.sleep(0)  # force interleaving
            record_served_call(_call(i))
            return current_llm_call_context().slide_indices

    token = push_llm_call_context(run_id="r1", calls=sink)
    try:
        seen = await asyncio.gather(*(one(i) for i in range(5)))
    finally:
        pop_llm_call_context(token)
    assert seen == [(i,) for i in range(5)]
    assert sorted(c.slide_indices for c in sink) == [(i,) for i in range(5)]
    assert current_llm_call_context().calls is None


async def test_concurrent_parse_contexts_never_see_each_others_calls():
    sink_a: list = []
    sink_b: list = []

    async def parse(run_id, sink, n):
        with llm_call_scope(run_id=run_id, calls=sink):
            for i in range(n):
                await asyncio.sleep(0)  # interleave with the other parse
                record_served_call(_call(i))
                assert current_llm_call_context().run_id == run_id
            return current_llm_call_context().run_id

    seen = await asyncio.gather(parse("run-a", sink_a, 4), parse("run-b", sink_b, 2))
    assert seen == ["run-a", "run-b"]
    assert len(sink_a) == 4 and len(sink_b) == 2
    assert current_llm_call_context() == LLMCallContext()


async def test_to_thread_sees_the_callers_context():
    with llm_call_scope(run_id="r-thread"):
        got = await asyncio.to_thread(lambda: current_llm_call_context().run_id)
    assert got == "r-thread"


def test_record_without_a_list_is_a_no_op():
    record_served_call(_call(0))  # outside any parse: nothing to do, no error


def test_record_is_bounded(monkeypatch):
    monkeypatch.setattr(cc, "MAX_RECORDED_CALLS", 3)
    sink: list = []
    with llm_call_scope(calls=sink):
        for i in range(5):
            record_served_call(_call(i))
    assert len(sink) == 3


def test_dropped_calls_are_counted_when_the_cap_is_hit(monkeypatch):
    monkeypatch.setattr(cc, "MAX_RECORDED_CALLS", 3)
    sink = cc.CallLog()
    with llm_call_scope(calls=sink):
        for i in range(5):
            record_served_call(_call(i))
    assert len(sink) == 3 and sink.dropped == 2


def test_record_never_raises():
    class Broken(list):
        def append(self, item):
            raise RuntimeError("full")

    with llm_call_scope(calls=Broken()):
        record_served_call(_call(0))


# ── _account_for_call ────────────────────────────────────────────────────────

@pytest.fixture
def logged(monkeypatch):
    from backend.services.ai import cost as cost_module
    from backend.services.ai import orchestrator

    rows: list = []

    async def fake_log(**kwargs):
        rows.append(kwargs)

    async def noop(*_a, **_k):
        return None

    monkeypatch.setattr(cost_module, "log_llm_call", fake_log)
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: None)
    monkeypatch.setattr(orchestrator._rotator, "flush_openai_cost_to_redis", noop)
    return rows


async def test_account_for_call_tags_the_row_and_records_the_serving_call(logged):
    from backend.services.ai import orchestrator
    from backend.services.ai.cost import LLMUsage

    sink: list = []
    with llm_call_scope(run_id="run-1", calls=sink):
        with llm_call_scope(slide_indices=(0, 1), prompt_name="BATCH_SLIDE_PROMPT"):
            await orchestrator._account_for_call(
                "openai", "gpt-4o-mini", LLMUsage(prompt_tokens=1000, completion_tokens=1000),
                user_id=None, course_id=None, feature="batch_analyze_text_slides",
                duration_seconds=0.1,
            )
    (row,) = logged
    assert (row["run_id"], row["slide_indices"], row["prompt_name"]) == ("run-1", (0, 1), "BATCH_SLIDE_PROMPT")
    assert (row["provider_id"], row["model"]) == ("openai", "gpt-4o-mini")
    (call,) = sink
    assert (call.provider, call.model, call.prompt_tokens, call.completion_tokens) == (
        "openai", "gpt-4o-mini", 1000, 1000)
    assert call.cost_usd == pytest.approx(0.00075)  # 1K x 0.00015 + 1K x 0.0006
    assert (call.prompt_name, call.slide_indices) == ("BATCH_SLIDE_PROMPT", (0, 1))
    assert call.prompt_version == "v3"  # BATCH_SLIDE_PROMPT version at call time
    assert row["prompt_version"] == "v3"


async def test_prompt_version_is_none_without_a_prompt_name_and_unversioned_names(logged):
    from backend.services.ai import orchestrator

    sink: list = []
    with llm_call_scope(calls=sink):
        await orchestrator._account_for_call(
            "groq", "m", None, user_id=None, course_id=None, feature="f", duration_seconds=0.0)
        await orchestrator._account_for_call(
            "groq", "m", None, user_id=None, course_id=None, feature="f",
            duration_seconds=0.0, prompt_name="free_form_name")
    assert logged[0]["prompt_version"] is None and sink[0].prompt_version is None
    assert logged[1]["prompt_version"] is None and sink[1].prompt_version is None


async def test_explicit_prompt_name_wins_over_the_scope(logged):
    from backend.services.ai import orchestrator

    with llm_call_scope(prompt_name="SYNTHESIS_DECK_QUIZ_PROMPT"):
        await orchestrator._account_for_call(
            "groq", "m", None, user_id=None, course_id=None, feature="f",
            duration_seconds=0.0, prompt_name="SYNTHESIS_QUIZ_REPAIR_PROMPT",
        )
    assert logged[0]["prompt_name"] == "SYNTHESIS_QUIZ_REPAIR_PROMPT"


async def test_outside_a_parse_rows_carry_no_run_context(logged):
    from backend.services.ai import orchestrator

    await orchestrator._account_for_call(
        "groq", "m", None, user_id=None, course_id=None, feature="tutor_chat", duration_seconds=0.0,
    )
    assert (logged[0]["run_id"], logged[0]["slide_indices"], logged[0]["prompt_name"]) == (None, None, None)


# ── log_llm_call SQL ─────────────────────────────────────────────────────────

class _Conn:
    def __init__(self, fail_first: BaseException | None = None):
        self.executed: list = []
        self._fail_first = fail_first

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    async def execute(self, query, *args):
        self.executed.append((query, args))
        if self._fail_first is not None and len(self.executed) == 1:
            raise self._fail_first
        return "INSERT 0 1"


@pytest.fixture
def conn_factory(monkeypatch):
    import backend.core.database as db

    def make(fail_first=None):
        conn = _Conn(fail_first)

        async def get_db_connection():
            return conn

        monkeypatch.setattr(db, "get_db_connection", get_db_connection)
        return conn

    return make


def _log_kwargs(**extra):
    from backend.services.ai.cost import LLMUsage
    return dict(user_id=None, course_id=None, feature="f", provider_id="groq", model="m",
                usage=LLMUsage(prompt_tokens=7, completion_tokens=3), cost_usd=0.0, **extra)


async def test_log_without_context_uses_the_legacy_insert(conn_factory):
    from backend.services.ai.cost import log_llm_call
    conn = conn_factory()
    await log_llm_call(**_log_kwargs())
    ((query, args),) = conn.executed
    assert "run_id" not in query and len(args) == 8


async def test_log_with_context_writes_the_run_columns(conn_factory):
    from backend.services.ai.cost import log_llm_call
    conn = conn_factory()
    await log_llm_call(**_log_kwargs(run_id="run-1", slide_indices=(0, 1), prompt_name="BATCH_SLIDE_PROMPT",
                                   prompt_version="v3"))
    ((query, args),) = conn.executed
    assert "run_id, slide_indices, prompt_name, prompt_version" in query
    assert args[8:] == ("run-1", [0, 1], "BATCH_SLIDE_PROMPT", "v3")


async def test_log_falls_back_to_legacy_insert_before_the_migration(conn_factory):
    from backend.services.ai.cost import log_llm_call
    conn = conn_factory(asyncpg.exceptions.UndefinedColumnError('column "run_id" does not exist'))
    await log_llm_call(**_log_kwargs(run_id="run-1", slide_indices=(0,), prompt_name="P"))
    assert len(conn.executed) == 2
    assert "run_id" not in conn.executed[1][0] and len(conn.executed[1][1]) == 8


async def test_log_never_raises(conn_factory):
    from backend.services.ai.cost import log_llm_call
    conn = conn_factory(RuntimeError("db down"))
    await log_llm_call(**_log_kwargs(run_id="run-1"))
    assert len(conn.executed) == 1


@pytest.fixture(autouse=True)
def fresh_missing_flag(monkeypatch):
    from backend.services.ai import cost as cost_module
    monkeypatch.setattr(cost_module, "_run_context_columns_missing", False)


async def test_missing_columns_fall_back_once_per_process(conn_factory, fresh_missing_flag, caplog):
    import logging
    from backend.services.ai.cost import log_llm_call
    conn = conn_factory(asyncpg.exceptions.UndefinedColumnError('column "run_id" does not exist'))
    with caplog.at_level(logging.WARNING, logger="backend.services.ai.cost"):
        await log_llm_call(**_log_kwargs(run_id="run-1", prompt_name="P"))
        await log_llm_call(**_log_kwargs(run_id="run-2", prompt_name="P"))
    # fail, legacy, legacy
    assert len(conn.executed) == 3
    assert "run_id" not in conn.executed[2][0]
    assert len([r for r in caplog.records if "run-context columns" in r.getMessage()]) == 1


async def test_log_never_raises_when_the_legacy_fallback_also_fails(conn_factory, fresh_missing_flag):
    from backend.services.ai.cost import log_llm_call

    class _Both(_Conn):
        async def execute(self, query, *args):
            self.executed.append((query, args))
            if len(self.executed) == 1:
                raise asyncpg.exceptions.UndefinedColumnError("no run_id")
            raise RuntimeError("db down")

    conn = _Both()
    import backend.core.database as db

    async def get_db_connection():
        return conn

    import pytest as _p
    mp = _p.MonkeyPatch()
    mp.setattr(db, "get_db_connection", get_db_connection)
    try:
        await log_llm_call(**_log_kwargs(run_id="run-1"))
    finally:
        mp.undo()
    assert len(conn.executed) == 2


async def test_vision_call_is_logged_once_and_lands_in_the_slide_receipt(logged, monkeypatch):
    """Merge of #84 into #92: analyze_slide_vision accounts through
    _account_for_call, so inside a slide scope the vision call is one llm_calls
    row AND one served call tagged with that slide (receipt: vision_metered)."""
    from backend.services.ai import vision
    from backend.services.ai.cost import LLMUsage

    usage = LLMUsage(prompt_tokens=800, completion_tokens=200)
    monkeypatch.setattr(vision, "_sync_analyze_vision_with_usage",
                        lambda *a, **k: ({"slide_type": "diagram"}, "openai_vision", usage))
    sink: list = []
    with llm_call_scope(run_id="run-1", calls=sink):
        with llm_call_scope(slide_indices=(4,), prompt_name="SLIDE_VISION_PROMPT"):
            out = await vision.analyze_slide_vision("b64", "", "openai")
    assert out == {"slide_type": "diagram"}
    (row,) = logged
    assert (row["provider_id"], row["feature"], row["run_id"], row["slide_indices"]) == (
        "openai", "vision", "run-1", (4,))
    (call,) = sink
    assert (call.provider, call.model, call.slide_indices, call.prompt_name) == (
        "openai", vision.OPENAI_VISION_MODEL, (4,), "SLIDE_VISION_PROMPT")
    assert (call.prompt_tokens, call.completion_tokens) == (800, 200)
