"""Unit tests for backend/workers/dlq.py (Roadmap P2-3).

DB access is mocked (a real-Postgres pass for the migration/table itself is
covered manually — see the P2-3 report — not in this fast unit suite).
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.workers import dlq


def _fake_pool(fetchval_side_effect=None):
    conn = AsyncMock()
    conn.execute = AsyncMock()
    if fetchval_side_effect is not None:
        conn.fetchval = AsyncMock(side_effect=fetchval_side_effect)

    class _AcquireCtx:
        async def __aenter__(self_inner):
            return conn

        async def __aexit__(self_inner, *a):
            return False

    pool = SimpleNamespace(acquire=lambda: _AcquireCtx())
    return pool, conn


async def test_capture_dlq_on_job_end_noop_without_job_id():
    # No job_id in ctx (e.g. a hook misfire) — must not touch Job()/redis.
    with patch("backend.workers.dlq.Job") as job_cls:
        await dlq.capture_dlq_on_job_end({"redis": object()})
        job_cls.assert_not_called()


async def test_capture_dlq_on_job_end_noop_without_redis():
    with patch("backend.workers.dlq.Job") as job_cls:
        await dlq.capture_dlq_on_job_end({"job_id": "abc"})
        job_cls.assert_not_called()


async def test_capture_dlq_on_job_end_skips_successful_jobs():
    fake_info = SimpleNamespace(success=True, function="parse_pdf_unified", args=(), kwargs={}, result=None)
    with patch("backend.workers.dlq.Job") as job_cls:
        job_cls.return_value.result_info = AsyncMock(return_value=fake_info)
        with patch("backend.workers.dlq._insert_dlq_row", new=AsyncMock()) as insert:
            await dlq.capture_dlq_on_job_end({"job_id": "abc", "redis": object(), "job_try": 1})
            insert.assert_not_called()


async def test_capture_dlq_on_job_end_writes_row_on_permanent_failure():
    fake_info = SimpleNamespace(
        success=False,
        function="parse_pdf_unified",
        args=("hash123",),
        kwargs={"lecture_id": "lec-1"},
        result=RuntimeError("boom"),
    )
    with patch("backend.workers.dlq.Job") as job_cls:
        job_cls.return_value.result_info = AsyncMock(return_value=fake_info)
        with patch("backend.workers.dlq._insert_dlq_row", new=AsyncMock()) as insert:
            await dlq.capture_dlq_on_job_end({"job_id": "abc", "redis": object(), "job_try": 5})
            insert.assert_awaited_once()
            _, kwargs = insert.await_args
            assert kwargs["function_name"] == "parse_pdf_unified"
            assert kwargs["job_id"] == "abc"
            assert kwargs["job_try"] == 5
            assert "boom" in kwargs["error"]


async def test_capture_dlq_on_job_end_never_raises_on_internal_error():
    with patch("backend.workers.dlq.Job", side_effect=RuntimeError("redis exploded")):
        # Must swallow the error, not propagate — a DLQ bug must never crash
        # job processing.
        await dlq.capture_dlq_on_job_end({"job_id": "abc", "redis": object()})


async def test_insert_dlq_row_swallows_db_errors():
    with patch("backend.core.database.db_pool", None), \
         patch("backend.core.database.init_db_pool", new=AsyncMock()):
        # No pool available even after init attempt -> must not raise.
        await dlq._insert_dlq_row("fn", "job-1", (), {}, 1, "err")


async def test_insert_dlq_row_happy_path():
    pool, conn = _fake_pool()
    with patch("backend.core.database.db_pool", pool):
        await dlq._insert_dlq_row("parse_pdf_unified", "job-1", ("h",), {"k": "v"}, 3, "boom")
    conn.execute.assert_awaited_once()
    args = conn.execute.await_args.args
    assert "INSERT INTO dead_letter_jobs" in args[0]
    assert args[1] == "parse_pdf_unified"
    assert args[2] == "job-1"


async def test_get_worker_health_summary_reports_queue_and_dlq_counts():
    pool, conn = _fake_pool(fetchval_side_effect=[7, 2])
    fake_redis = AsyncMock()
    fake_redis.zcard = AsyncMock(return_value=4)
    fake_redis.aclose = AsyncMock()

    with patch("redis.asyncio.from_url", return_value=fake_redis), \
         patch("backend.core.database.db_pool", pool):
        summary = await dlq.get_worker_health_summary()

    assert summary["queued"] == 4
    assert summary["dead_letter"] == 7
    assert summary["dead_letter_unresolved"] == 2
    assert summary["error"] is None


async def test_get_worker_health_summary_degrades_gracefully_on_redis_error():
    with patch("redis.asyncio.from_url", side_effect=ConnectionError("no redis")), \
         patch("backend.core.database.db_pool", None), \
         patch("backend.core.database.init_db_pool", new=AsyncMock()):
        summary = await dlq.get_worker_health_summary()
    assert summary["queued"] is None
    assert "redis" in summary["error"]
