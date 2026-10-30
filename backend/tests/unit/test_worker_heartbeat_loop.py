"""The worker heartbeat must not wait for a job slot.

Arq crons are jobs: they queue for a free ``max_jobs`` slot like any parse.
On 2026-10-30 four long parse_pdf_unified jobs filled every slot at 20:10 UTC,
the heartbeat cron never ran again, the key expired, and /health/ready went
503 ("backlog=13 with no worker heartbeat") while the worker was alive and
parsing. The heartbeat now runs as a background task started in startup().
"""
from __future__ import annotations

import asyncio

import pytest

from backend.core.worker_heartbeat import WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL_SECONDS
from backend.workers import arq_worker


class _FakeRedis:
    def __init__(self):
        self.sets: list[tuple[str, str, int]] = []

    async def set(self, key, value, ex=None):
        self.sets.append((key, value, ex))


@pytest.fixture
def quiet_startup(monkeypatch):
    """startup()/shutdown() without a database, a cache Redis or provider checks."""
    import backend.core.database as database
    import backend.core.redis as cache_redis
    import backend.services.ai.orchestrator as orchestrator

    async def _noop(*_a, **_k):
        return None

    monkeypatch.setattr(orchestrator, "assert_provider_mode", lambda: None)
    monkeypatch.setattr(database, "init_db_pool", _noop)
    monkeypatch.setattr(database, "db_pool", None)
    monkeypatch.setattr(cache_redis, "init_redis", _noop)
    monkeypatch.setattr(cache_redis, "close_redis", _noop)
    monkeypatch.setattr(arq_worker, "WORKER_HEARTBEAT_INTERVAL_SECONDS", 0.01)


def test_heartbeat_is_not_a_cron():
    names = {getattr(j.coroutine, "__name__", "") for j in arq_worker.WorkerSettings.cron_jobs}
    assert "worker_heartbeat" not in names


async def test_startup_beats_at_once_and_keeps_beating(quiet_startup):
    redis = _FakeRedis()
    ctx = {"redis": redis}
    await arq_worker.startup(ctx)
    try:
        await asyncio.sleep(0.05)
        assert len(redis.sets) >= 2
        assert redis.sets[0] == (WORKER_HEARTBEAT_KEY, "1", WORKER_HEARTBEAT_TTL_SECONDS)
    finally:
        await arq_worker.shutdown(ctx)


async def test_heartbeat_keeps_beating_while_long_jobs_run(quiet_startup):
    """The 2026-10-30 shape: every slot busy with a long job; the key must not lapse."""
    redis = _FakeRedis()
    ctx = {"redis": redis}
    await arq_worker.startup(ctx)
    try:
        before = len(redis.sets)
        busy = [asyncio.create_task(asyncio.sleep(0.1)) for _ in range(4)]  # four parses holding the slots
        await asyncio.gather(*busy)
        assert len(redis.sets) - before >= 3
    finally:
        await arq_worker.shutdown(ctx)


async def test_shutdown_stops_the_loop(quiet_startup):
    redis = _FakeRedis()
    ctx = {"redis": redis}
    await arq_worker.startup(ctx)
    await asyncio.sleep(0.02)
    await arq_worker.shutdown(ctx)
    beats = len(redis.sets)
    await asyncio.sleep(0.05)
    assert len(redis.sets) == beats
    assert "_worker_heartbeat_task" not in ctx


async def test_a_redis_error_does_not_kill_the_loop(quiet_startup):
    calls = {"n": 0}

    class _FlakyRedis:
        async def set(self, *_a, **_k):
            calls["n"] += 1
            if calls["n"] == 1:
                raise ConnectionError("redis blip")

    ctx = {"redis": _FlakyRedis()}
    await arq_worker.startup(ctx)
    try:
        await asyncio.sleep(0.05)
        assert calls["n"] >= 2
    finally:
        await arq_worker.shutdown(ctx)
