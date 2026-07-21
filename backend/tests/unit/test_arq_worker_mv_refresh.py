"""
Unit tests for the P5-2 (docs/ROADMAP_10X_FOUNDATION.md §13, OLTP/OLAP split)
scheduled materialized-view refresh cron job.

backend/workers/arq_worker.py::refresh_professor_overview_mv is what keeps
`mv_course_daily_activity` (supabase/migrations/
20260720000000_professor_overview_daily_activity_mv.sql) from going stale
forever — nothing else refreshes it. These tests exercise the function in
isolation (mocked asyncpg connection) rather than requiring a live worker;
the real-Postgres proof that the migration + REFRESH CONCURRENTLY actually
work together lives in
backend/tests/db/test_professor_overview_mv.py.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.workers.arq_worker import WorkerSettings, refresh_professor_overview_mv


class _FakeConnCtx:
    """Mimics `async with await get_db_connection() as conn: ...`."""

    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, *exc):
        return False


@pytest.mark.asyncio
async def test_refresh_issues_refresh_concurrently_on_the_mv():
    conn = MagicMock()
    conn.execute = AsyncMock()

    with patch(
        "backend.core.database.get_db_connection",
        new=AsyncMock(return_value=_FakeConnCtx(conn)),
    ):
        await refresh_professor_overview_mv(ctx={})

    conn.execute.assert_awaited_once_with(
        "REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_course_daily_activity"
    )


@pytest.mark.asyncio
async def test_refresh_swallows_undefined_table_before_migration_applied():
    """Before the migration has run (fresh local dev), the view doesn't
    exist yet. The job must log and return, not crash the worker's cron
    loop / bring the process down."""
    import asyncpg

    conn = MagicMock()
    conn.execute = AsyncMock(
        side_effect=asyncpg.UndefinedTableError("relation does not exist")
    )

    with patch(
        "backend.core.database.get_db_connection",
        new=AsyncMock(return_value=_FakeConnCtx(conn)),
    ):
        # Must not raise.
        await refresh_professor_overview_mv(ctx={})


@pytest.mark.asyncio
async def test_refresh_swallows_unexpected_errors():
    """A transient DB error (e.g. connection drop mid-refresh) must be
    logged, not propagated — a single failed refresh should not crash the
    Arq worker; the next scheduled run (10 min later) will retry."""
    conn = MagicMock()
    conn.execute = AsyncMock(side_effect=RuntimeError("boom"))

    with patch(
        "backend.core.database.get_db_connection",
        new=AsyncMock(return_value=_FakeConnCtx(conn)),
    ):
        # Must not raise.
        await refresh_professor_overview_mv(ctx={})


def test_worker_settings_registers_the_refresh_as_a_cron_job():
    """Guards against the cron job silently being dropped from
    WorkerSettings.cron_jobs (which would mean the view never refreshes,
    but nothing would fail loudly)."""
    job_coros = {job.coroutine for job in WorkerSettings.cron_jobs}
    assert refresh_professor_overview_mv in job_coros
