"""P5-3 — async ingestion / rollup pipeline.

Three things must be true about the design:
  (a) a student write's response latency does NOT include the analytics
      rollup work — the rollup is *enqueued* (fire-and-forget), never
      awaited inline before the write handler returns.
  (b) rollups are eventually consistent — running the rollup job (whenever
      it happens to execute) converges the aggregate to the correct state.
  (c) a failed rollup is retried/self-heals on a later run rather than
      silently losing that rollup forever.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from backend.repositories import event_repo
from backend.services import analytics_rollup


# ── (a) write path never awaits the rollup inline ──────────────────────────

async def test_insert_event_enqueues_rollup_instead_of_awaiting_it(fake_supabase):
    """The old code called analytics_cache.invalidate(...) synchronously,
    inline, inside insert_event — a second blocking Supabase round-trip on
    every event write. Prove that's gone: insert_event only ever calls
    pool.enqueue_job, and never touches analytics_cache directly."""
    enqueue_mock = AsyncMock()
    fake_pool = SimpleNamespace(enqueue_job=enqueue_mock)

    with patch(
        "backend.services.upload_service.get_arq_pool",
        new=AsyncMock(return_value=fake_pool),
    ), patch(
        "backend.services.analytics_cache.invalidate"
    ) as invalidate_mock:
        await event_repo.insert_event(
            fake_supabase, "u-1", "slide_view", {"lectureId": "L1", "slideId": "s1"}
        )

    # The row landed fast (a single insert)...
    assert len(fake_supabase.tables["learning_events"]) == 1
    # ...and analytics bookkeeping was *enqueued*, not run inline.
    invalidate_mock.assert_not_called()
    enqueue_mock.assert_awaited_once_with("rollup_analytics_cache", lecture_id="L1")


async def test_grade_rollup_enqueued_not_awaited_inline(monkeypatch):
    """Same shape for the review-grade write path: mastery.record_grade used
    to run inside the request's DB transaction. It must now only ever be
    invoked from inside the Arq job function, never from the endpoint
    module directly."""
    import backend.api.v1.review as review_module

    assert not hasattr(review_module, "mastery"), (
        "review.py should no longer import backend.services.review.mastery "
        "directly — that recompute now lives behind the Arq job in "
        "analytics_rollup.rollup_concept_mastery."
    )


# ── (b) eventual consistency: the rollup job converges the aggregate ──────

async def test_rollup_analytics_cache_converges_state(fake_supabase):
    """Simulate the job running some time after the write: it must produce
    the same end state as the old inline call did (cache rows for the
    lecture gone), regardless of when it actually executes."""
    lecture_id = str(uuid4())
    fake_supabase.seed(
        "analytics_cache",
        [
            {"id": "c1", "lecture_id": lecture_id, "view_name": "overview", "payload": {}},
            {"id": "c2", "lecture_id": lecture_id, "view_name": "dropoff", "payload": {}},
            {"id": "c3", "lecture_id": "other-lecture", "view_name": "overview", "payload": {}},
        ],
    )
    with patch("backend.services.analytics_cache.supabase_admin", fake_supabase):
        # The write already happened (event row landed, response already
        # returned to the client) — the job runs later, out-of-band.
        result = await analytics_rollup.rollup_analytics_cache({}, lecture_id)

    remaining = [r for r in fake_supabase.tables["analytics_cache"] if r["lecture_id"] == lecture_id]
    assert remaining == []
    other = [r for r in fake_supabase.tables["analytics_cache"] if r["lecture_id"] == "other-lecture"]
    assert len(other) == 1
    assert result["lecture_id"] == lecture_id


async def test_rollup_concept_mastery_converges_state():
    """The mastery rollup job, run out-of-band, must land the same
    attempts/correct/mastery_score a synchronous inline call would have."""
    user_id = str(uuid4())
    card_id = str(uuid4())
    concept_id = str(uuid4())

    fake_conn = AsyncMock()
    fake_conn.fetchval = AsyncMock(return_value=concept_id)
    fake_conn.fetchrow = AsyncMock(return_value={"attempts": 2, "correct": 1})
    fake_conn.execute = AsyncMock()

    class _CM:
        async def __aenter__(self_inner):
            return fake_conn

        async def __aexit__(self_inner, *a):
            return False

    with patch(
        "backend.core.database.get_db_connection", new=AsyncMock(return_value=_CM())
    ):
        result = await analytics_rollup.rollup_concept_mastery({}, user_id, card_id, rating=4)

    assert result == {"user_id": user_id, "card_id": card_id, "rating": 4}
    # attempts 2->3, correct 1->2 (rating >= 3 counts as correct)
    upsert_call = fake_conn.execute.call_args
    args = upsert_call.args
    assert args[3] == 3  # attempts
    assert args[4] == 2  # correct


# ── (c) a failed rollup is retried / self-heals on the next run ───────────

async def test_failed_rollup_is_observable_and_retried_on_next_run(fake_supabase, caplog):
    """Simulate one failed attempt (e.g. a transient DB error) followed by a
    successful retry — the pattern Arq itself drives via max_tries. The job
    must (1) log loudly and (2) re-raise so Arq's retry logic actually
    fires, rather than swallowing the error and losing the rollup."""
    lecture_id = str(uuid4())
    fake_supabase.seed(
        "analytics_cache",
        [{"id": "c1", "lecture_id": lecture_id, "view_name": "overview", "payload": {}}],
    )

    from backend.services import analytics_cache as ac_module

    # First run ("this attempt"): the underlying invalidate call fails
    # transiently. The job must log the failure clearly and re-raise (not
    # swallow it) so Arq's own retry mechanism schedules another attempt.
    with caplog.at_level("ERROR"), \
         patch.object(ac_module, "supabase_admin", fake_supabase), \
         patch(
             "backend.services.analytics_cache.invalidate",
             side_effect=RuntimeError("transient DB blip"),
         ):
        with pytest.raises(RuntimeError):
            await analytics_rollup.rollup_analytics_cache({}, lecture_id)

    assert any("FAILED" in rec.message for rec in caplog.records)

    # The cache row must still be present — the failed attempt did not
    # silently mark anything done, so there is real work left for the retry.
    remaining = [r for r in fake_supabase.tables["analytics_cache"] if r["lecture_id"] == lecture_id]
    assert len(remaining) == 1

    # Second run ("the next scheduled/triggered run"): succeeds, self-heals,
    # converging to the correct end state without any special-casing for
    # the prior failure.
    with patch.object(ac_module, "supabase_admin", fake_supabase):
        result = await analytics_rollup.rollup_analytics_cache({}, lecture_id)

    remaining_after = [r for r in fake_supabase.tables["analytics_cache"] if r["lecture_id"] == lecture_id]
    assert remaining_after == []
    assert result["lecture_id"] == lecture_id
