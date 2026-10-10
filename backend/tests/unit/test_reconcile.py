"""Unit tests for backend.services.parser.reconcile (Milestone-4 R51/R52).

Mocks ``repos``/``persist`` at the module level (same pattern
test_unified_orchestrator.py uses for ``uo.repos``/``persist``) so no DB is
needed. These pin the core "stuck forever" fix's idempotency contract:
reconciling an already-terminal run is a no-op, recovering a run with real
slides never re-parses or duplicates anything, and a run with nothing
recoverable is marked FAILED with a real error instead of being left
untouched.
"""
from __future__ import annotations

from uuid import uuid4

import pytest

from backend.domain.parse_models import RunStatus
from backend.services.parser import reconcile


class _Run:
    def __init__(self, run_id, status, lecture_id=None):
        self.run_id = run_id
        self.status = status
        self.lecture_id = lecture_id


async def test_not_found_run(monkeypatch):
    async def fake_get(run_id):
        return None

    monkeypatch.setattr(reconcile.repos, "get_run_by_id", fake_get)
    result = await reconcile.reconcile_stalled_run(uuid4())
    assert result["action"] == "not_found"


@pytest.mark.parametrize("status", [RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED])
async def test_noop_on_already_terminal_run(monkeypatch, status):
    run = _Run(uuid4(), status)

    async def fake_get(run_id):
        return run

    async def boom(*a, **k):
        raise AssertionError("must not touch an already-terminal run")

    monkeypatch.setattr(reconcile.repos, "get_run_by_id", fake_get)
    monkeypatch.setattr(reconcile.persist, "get_slide_count", boom)
    monkeypatch.setattr(reconcile.persist, "sync_total_slides", boom)
    monkeypatch.setattr(reconcile.repos, "set_status", boom)
    monkeypatch.setattr(reconcile.repos, "set_error", boom)

    result = await reconcile.reconcile_stalled_run(run.run_id)
    assert result == {"run_id": str(run.run_id), "action": "noop", "status": status.value}


async def test_recovers_when_slides_already_persisted(monkeypatch):
    """The R51/R52 shape: a run stuck in 'extracting' whose lecture already
    has real slides — recovery must sync the true count and complete the
    run WITHOUT re-parsing or discarding anything."""
    lecture_id = uuid4()
    run = _Run(uuid4(), RunStatus.EXTRACTING, lecture_id=lecture_id)

    async def fake_get(run_id):
        return run

    async def fake_slide_count(lid):
        assert lid == lecture_id
        return 127

    synced = []

    async def fake_sync(lid):
        synced.append(lid)
        return 127

    statuses = []

    async def fake_set_status(run_id, status):
        statuses.append((run_id, status))

    async def boom_error(*a, **k):
        raise AssertionError("must not mark FAILED when content was recovered")

    monkeypatch.setattr(reconcile.repos, "get_run_by_id", fake_get)
    monkeypatch.setattr(reconcile.persist, "get_slide_count", fake_slide_count)
    monkeypatch.setattr(reconcile.persist, "sync_total_slides", fake_sync)
    monkeypatch.setattr(reconcile.repos, "set_status", fake_set_status)
    monkeypatch.setattr(reconcile.repos, "set_error", boom_error)

    result = await reconcile.reconcile_stalled_run(run.run_id)

    assert result == {"run_id": str(run.run_id), "action": "recovered", "slide_count": 127}
    assert synced == [lecture_id]
    assert statuses == [(run.run_id, RunStatus.COMPLETED)]


async def test_marks_failed_when_no_lecture_was_ever_linked(monkeypatch):
    run = _Run(uuid4(), RunStatus.EXTRACTING, lecture_id=None)

    async def fake_get(run_id):
        return run

    errors = []

    async def fake_set_error(run_id, message):
        errors.append((run_id, message))

    monkeypatch.setattr(reconcile.repos, "get_run_by_id", fake_get)
    monkeypatch.setattr(reconcile.repos, "set_error", fake_set_error)

    result = await reconcile.reconcile_stalled_run(run.run_id)

    assert result == {"run_id": str(run.run_id), "action": "failed_no_content"}
    assert errors == [(run.run_id, reconcile.NO_CONTENT_ERROR)]


async def test_marks_failed_when_lecture_has_zero_slides(monkeypatch):
    """A lecture row was created (lecture_id is set) but nothing was ever
    persisted to it — there's nothing to recover, so it's marked failed
    rather than silently completed with total_slides=0."""
    lecture_id = uuid4()
    run = _Run(uuid4(), RunStatus.EXTRACTING, lecture_id=lecture_id)

    async def fake_get(run_id):
        return run

    async def fake_slide_count(lid):
        return 0

    errors = []

    async def fake_set_error(run_id, message):
        errors.append((run_id, message))

    async def boom(*a, **k):
        raise AssertionError("must not sync/complete a lecture with 0 real slides")

    monkeypatch.setattr(reconcile.repos, "get_run_by_id", fake_get)
    monkeypatch.setattr(reconcile.persist, "get_slide_count", fake_slide_count)
    monkeypatch.setattr(reconcile.persist, "sync_total_slides", boom)
    monkeypatch.setattr(reconcile.repos, "set_status", boom)
    monkeypatch.setattr(reconcile.repos, "set_error", fake_set_error)

    result = await reconcile.reconcile_stalled_run(run.run_id)

    assert result == {"run_id": str(run.run_id), "action": "failed_no_content"}
    assert errors == [(run.run_id, reconcile.NO_CONTENT_ERROR)]


async def test_idempotent_calling_reconcile_twice_on_the_same_run(monkeypatch):
    """The core idempotent-finalization contract: calling reconcile twice on
    the same already-extracted run must not sync/complete a second time —
    the second call sees the (now-terminal, from the first call) status and
    short-circuits as a pure no-op."""
    lecture_id = uuid4()
    run = _Run(uuid4(), RunStatus.EXTRACTING, lecture_id=lecture_id)

    async def fake_get(run_id):
        return run

    async def fake_slide_count(lid):
        return 5

    sync_calls = []

    async def fake_sync(lid):
        sync_calls.append(lid)
        return 5

    async def fake_set_status(run_id, status):
        run.status = status  # mutate the same run object, like a real DB row would reflect

    monkeypatch.setattr(reconcile.repos, "get_run_by_id", fake_get)
    monkeypatch.setattr(reconcile.persist, "get_slide_count", fake_slide_count)
    monkeypatch.setattr(reconcile.persist, "sync_total_slides", fake_sync)
    monkeypatch.setattr(reconcile.repos, "set_status", fake_set_status)

    first = await reconcile.reconcile_stalled_run(run.run_id)
    assert first["action"] == "recovered"
    assert sync_calls == [lecture_id]

    second = await reconcile.reconcile_stalled_run(run.run_id)
    assert second == {"run_id": str(run.run_id), "action": "noop", "status": "completed"}
    # sync_total_slides did NOT run again on the second call.
    assert sync_calls == [lecture_id]


async def test_reconcile_all_stalled_is_best_effort_per_run(monkeypatch):
    """One run's reconciliation blowing up must never prevent the rest of
    the sweep from running."""
    ok_run = _Run(uuid4(), RunStatus.EXTRACTING, lecture_id=uuid4())
    boom_run = _Run(uuid4(), RunStatus.EXTRACTING, lecture_id=uuid4())

    async def fake_list(cutoff):
        return [boom_run, ok_run]

    call_order = []

    async def fake_reconcile(run_id, allow_recovery=True):
        call_order.append(run_id)
        if run_id == boom_run.run_id:
            raise RuntimeError("db exploded")
        return {"run_id": str(run_id), "action": "recovered", "slide_count": 3}

    monkeypatch.setattr(reconcile.repos, "list_stalled_extracting_runs", fake_list)
    monkeypatch.setattr(reconcile, "reconcile_stalled_run", fake_reconcile)

    import datetime as _dt
    results = await reconcile.reconcile_all_stalled(_dt.datetime.now(_dt.timezone.utc))

    assert call_order == [boom_run.run_id, ok_run.run_id]
    assert results[0]["action"] == "error"
    assert results[1]["action"] == "recovered"


# ── Widened sweep: queued / pending ────────────────────────────────────────
#
# repos.list_stalled_extracting_runs deliberately excluded 'queued' for two
# reasons (see its docstring): a queued run can legitimately wait under real
# backlog, and /retry resets status to QUEUED without bumping started_at, so a
# freshly-requeued row carries an old started_at while its lecture_id still
# points at the PREVIOUS attempt's slides. Sweeping those with recovery enabled
# would mark a just-started retry COMPLETED with a stale slide count. The
# widened sweep therefore uses a separate, longer cutoff and runs fail-only.


async def test_queued_run_with_stale_slides_is_never_recovered(monkeypatch):
    """The data-corruption case: a QUEUED row whose lecture_id still points at
    a previous attempt's slides must be failed honestly, never completed."""
    lecture_id = uuid4()
    run = _Run(uuid4(), RunStatus.QUEUED, lecture_id=lecture_id)
    errors: list = []

    async def fake_get(run_id):
        return run

    async def boom(*a, **k):
        raise AssertionError("must not recover a queued run from stale slides")

    async def fake_set_error(run_id, msg):
        errors.append((run_id, msg))

    monkeypatch.setattr(reconcile.repos, "get_run_by_id", fake_get)
    monkeypatch.setattr(reconcile.persist, "get_slide_count", boom)
    monkeypatch.setattr(reconcile.persist, "sync_total_slides", boom)
    monkeypatch.setattr(reconcile.repos, "set_status", boom)
    monkeypatch.setattr(reconcile.repos, "set_error", fake_set_error)

    result = await reconcile.reconcile_stalled_run(run.run_id, allow_recovery=False)

    assert result["action"] == "failed_no_content"
    assert errors == [(run.run_id, reconcile.NO_CONTENT_ERROR)]


async def test_extracting_run_still_recovers_by_default(monkeypatch):
    """Widening must not change the 'extracting' path: recovery stays on."""
    lecture_id = uuid4()
    run = _Run(uuid4(), RunStatus.EXTRACTING, lecture_id=lecture_id)
    completed: list = []

    async def fake_get(run_id):
        return run

    async def fake_count(lec_id):
        return 42

    async def fake_sync(lec_id):
        return None

    async def fake_set_status(run_id, status):
        completed.append(status)

    monkeypatch.setattr(reconcile.repos, "get_run_by_id", fake_get)
    monkeypatch.setattr(reconcile.persist, "get_slide_count", fake_count)
    monkeypatch.setattr(reconcile.persist, "sync_total_slides", fake_sync)
    monkeypatch.setattr(reconcile.repos, "set_status", fake_set_status)

    result = await reconcile.reconcile_stalled_run(run.run_id)

    assert result == {"run_id": str(run.run_id), "action": "recovered", "slide_count": 42}
    assert completed == [RunStatus.COMPLETED]


async def test_sweep_uses_separate_cutoff_and_fail_only_for_queued(monkeypatch):
    """reconcile_all_stalled sweeps both sets: 'extracting' at the normal
    cutoff with recovery on, 'queued'/'pending' at the longer cutoff with
    recovery off."""
    import datetime as _dt

    extracting_run = _Run(uuid4(), RunStatus.EXTRACTING, lecture_id=uuid4())
    queued_run = _Run(uuid4(), RunStatus.QUEUED, lecture_id=uuid4())

    seen: dict = {}

    async def fake_list_extracting(cutoff):
        seen["extracting_cutoff"] = cutoff
        return [extracting_run]

    async def fake_list_queued(statuses, cutoff):
        seen["queued_statuses"] = list(statuses)
        seen["queued_cutoff"] = cutoff
        return [queued_run]

    calls: list = []

    async def fake_reconcile(run_id, allow_recovery=True):
        calls.append((run_id, allow_recovery))
        return {"run_id": str(run_id), "action": "failed_no_content"}

    monkeypatch.setattr(reconcile.repos, "list_stalled_extracting_runs", fake_list_extracting)
    monkeypatch.setattr(reconcile.repos, "list_stalled_runs", fake_list_queued)
    monkeypatch.setattr(reconcile, "reconcile_stalled_run", fake_reconcile)

    now = _dt.datetime.now(_dt.timezone.utc)
    queued_cutoff = now - _dt.timedelta(hours=6)
    results = await reconcile.reconcile_all_stalled(now, queued_cutoff=queued_cutoff)

    assert seen["extracting_cutoff"] == now
    assert seen["queued_cutoff"] == queued_cutoff
    assert set(seen["queued_statuses"]) == {"queued", "pending"}
    assert calls == [(extracting_run.run_id, True), (queued_run.run_id, False)]
    assert len(results) == 2


async def test_sweep_skips_queued_when_no_queued_cutoff_given(monkeypatch):
    """Back-compat: called with one argument, the sweep behaves exactly as
    before — 'extracting' only."""
    import datetime as _dt

    run = _Run(uuid4(), RunStatus.EXTRACTING, lecture_id=uuid4())

    async def fake_list_extracting(cutoff):
        return [run]

    async def boom(*a, **k):
        raise AssertionError("must not sweep queued without an explicit cutoff")

    async def fake_reconcile(run_id, allow_recovery=True):
        return {"run_id": str(run_id), "action": "recovered", "slide_count": 1}

    monkeypatch.setattr(reconcile.repos, "list_stalled_extracting_runs", fake_list_extracting)
    monkeypatch.setattr(reconcile.repos, "list_stalled_runs", boom)
    monkeypatch.setattr(reconcile, "reconcile_stalled_run", fake_reconcile)

    results = await reconcile.reconcile_all_stalled(_dt.datetime.now(_dt.timezone.utc))
    assert len(results) == 1
