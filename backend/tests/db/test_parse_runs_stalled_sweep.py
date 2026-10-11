"""Real-Postgres validation of the stalled-run sweep's SQL.

The unit tests in backend/tests/unit/test_reconcile.py mock ``repos``, so they
pin the sweep's *decisions* but never execute a statement. These pin the two
statements themselves, where the behaviour lives in the SQL:

* ``requeue_run`` — the whole point is the columns it writes (``started_at``
  back to now, ``error``/``finished_at`` cleared). A mocked pool cannot show
  that, and getting it wrong is what makes a retry fail itself on the next
  sweep.
* ``list_stalled_runs`` — ``status = ANY($1::text[])`` against a column with
  no CHECK constraint, including the legacy ``pending`` value that no enum
  member wrote.

Gated behind `db` (needs a local Postgres or Docker + testcontainers), same
setup as test_parse_runs_batch_upsert.py.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

pytestmark = pytest.mark.db


@pytest.fixture
async def wired_pool(pg_dsn, applied_migrations):
    import asyncpg
    import backend.core.database as core

    pool = await asyncpg.create_pool(pg_dsn, min_size=1, max_size=4, statement_cache_size=0)
    old = core.db_pool
    core.db_pool = pool
    try:
        yield pool
    finally:
        core.db_pool = old
        await pool.close()


def _now():
    return datetime.now(timezone.utc)


async def _insert_run(pool, *, user_id, status: str, started_at, error=None, lecture_id=None):
    """Insert a parse_runs row in an exact state, including statuses and
    timestamps no application path can produce directly."""
    run_id = uuid4()
    await pool.execute(
        """
        INSERT INTO parse_runs (run_id, pdf_hash, lecture_id, pipeline_version,
                                status, started_at, error, user_id)
        VALUES ($1, $2, $3, '5', $4, $5, $6, $7)
        """,
        run_id, uuid4().hex + uuid4().hex, lecture_id, status, started_at, error, user_id,
    )
    return run_id


# ── requeue_run ─────────────────────────────────────────────────────────────


async def test_requeue_run_restarts_the_clock_and_clears_the_last_attempt(wired_pool, make_user):
    """A retried run must read as a NEW attempt: queued, started now, with no
    leftover error or finish time from the attempt that failed."""
    from backend.services.parser import repos

    prof = make_user(role="professor")
    old_start = _now() - timedelta(days=30)
    run_id = await _insert_run(
        wired_pool, user_id=prof, status="failed", started_at=old_start,
        error="Processing stalled and no content was recovered.",
    )
    await wired_pool.execute(
        "UPDATE parse_runs SET finished_at = $1 WHERE run_id = $2", old_start, run_id
    )

    before = _now()
    await repos.requeue_run(run_id)

    row = await wired_pool.fetchrow(
        "SELECT status, started_at, finished_at, error FROM parse_runs WHERE run_id = $1", run_id
    )
    assert row["status"] == "queued"
    assert row["error"] is None
    assert row["finished_at"] is None
    assert row["started_at"] >= before
    assert row["started_at"] > old_start


async def test_requeued_run_is_not_swept_as_stalled(wired_pool, make_user):
    """The regression requeue_run exists to prevent: retrying a months-old run
    must not hand the sweep a row that is already past the cutoff.

    With a plain set_status(QUEUED) the row keeps its original started_at, so
    it is born stale and the very next sweep fails it.
    """
    from backend.services.parser import repos
    from backend.services.parser.reconcile import WAITING_STATUSES

    prof = make_user(role="professor")
    run_id = await _insert_run(
        wired_pool, user_id=prof, status="failed",
        started_at=_now() - timedelta(days=30), error="boom",
    )

    await repos.requeue_run(run_id)

    cutoff = _now() - timedelta(hours=6)
    swept = {r.run_id for r in await repos.list_stalled_runs(WAITING_STATUSES, cutoff)}
    assert run_id not in swept


# ── list_stalled_runs ───────────────────────────────────────────────────────


async def test_list_stalled_runs_matches_every_waiting_status(wired_pool, make_user):
    """Both waiting values are selected — including legacy 'pending', which no
    enum member ever wrote and which the column's lack of a CHECK constraint
    still permits."""
    from backend.services.parser import repos
    from backend.services.parser.reconcile import WAITING_STATUSES

    prof = make_user(role="professor")
    stale = _now() - timedelta(days=2)
    queued = await _insert_run(wired_pool, user_id=prof, status="queued", started_at=stale)
    pending = await _insert_run(wired_pool, user_id=prof, status="pending", started_at=stale)

    found = {r.run_id for r in await repos.list_stalled_runs(WAITING_STATUSES, _now())}

    assert {queued, pending} <= found


async def test_list_stalled_runs_excludes_fresh_and_terminal_rows(wired_pool, make_user):
    """Only waiting rows older than the cutoff — a recent queued row is just
    waiting its turn, and a terminal row is nobody's problem."""
    from backend.services.parser import repos
    from backend.services.parser.reconcile import WAITING_STATUSES

    prof = make_user(role="professor")
    stale = _now() - timedelta(days=2)
    fresh = await _insert_run(
        wired_pool, user_id=prof, status="queued", started_at=_now() - timedelta(minutes=5)
    )
    completed = await _insert_run(wired_pool, user_id=prof, status="completed", started_at=stale)
    extracting = await _insert_run(wired_pool, user_id=prof, status="extracting", started_at=stale)
    target = await _insert_run(wired_pool, user_id=prof, status="queued", started_at=stale)

    cutoff = _now() - timedelta(hours=6)
    found = {r.run_id for r in await repos.list_stalled_runs(WAITING_STATUSES, cutoff)}

    assert target in found
    assert fresh not in found
    assert completed not in found
    # 'extracting' is swept by list_stalled_extracting_runs on its own, much
    # shorter threshold — it must not be pulled into the waiting-state pass.
    assert extracting not in found


async def test_list_stalled_runs_with_no_statuses_returns_nothing(wired_pool, make_user):
    """Empty status list short-circuits — never "match everything", which
    against ANY($1::text[]) would otherwise be an easy way to fail the table."""
    from backend.services.parser import repos

    prof = make_user(role="professor")
    await _insert_run(
        wired_pool, user_id=prof, status="queued", started_at=_now() - timedelta(days=2)
    )

    assert await repos.list_stalled_runs((), _now()) == []


# ── the legacy row loads at all ─────────────────────────────────────────────


async def test_legacy_pending_row_survives_model_mapping(wired_pool, make_user):
    """_run_from_row does RunStatus(row["status"]). Before RunStatus.PENDING
    existed this raised ValueError, so the sweep crashed on exactly the rows it
    was meant to clean rather than failing them."""
    from backend.domain.parse_models import RunStatus
    from backend.services.parser import repos

    prof = make_user(role="professor")
    run_id = await _insert_run(
        wired_pool, user_id=prof, status="pending", started_at=_now() - timedelta(days=2)
    )

    run = await repos.get_run_by_id(run_id)

    assert run is not None
    assert run.status is RunStatus.PENDING
