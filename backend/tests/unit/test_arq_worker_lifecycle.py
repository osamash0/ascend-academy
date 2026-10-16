"""Arq worker startup/shutdown must initialise the cache Redis client so the
LLM provider limit/cost counters sync fleet-wide (the worker runs all PDF
parsing LLM calls). Redis trouble must never kill the worker."""
from __future__ import annotations

import logging

import pytest

from backend.tests.fake_redis import FakeRedis
from backend.workers.arq_worker import shutdown, startup


def _recorder(calls: list, name: str, exc: Exception | None = None):
    async def _fn(*args, **kwargs):
        calls.append(name)
        if exc is not None:
            raise exc

    return _fn


async def test_startup_inits_db_pool_and_redis(monkeypatch):
    calls: list = []
    monkeypatch.setattr("backend.core.database.init_db_pool", _recorder(calls, "db"))
    monkeypatch.setattr("backend.core.redis.init_redis", _recorder(calls, "redis"))

    await startup({})

    assert calls == ["db", "redis"]


async def test_startup_survives_redis_failure_and_warns(monkeypatch, caplog):
    calls: list = []
    monkeypatch.setattr("backend.core.database.init_db_pool", _recorder(calls, "db"))
    monkeypatch.setattr(
        "backend.core.redis.init_redis", _recorder(calls, "redis", RuntimeError("boom"))
    )

    with caplog.at_level(logging.WARNING, logger="backend.workers.arq_worker"):
        await startup({})

    assert calls == ["db", "redis"]
    assert any(
        "cache Redis unavailable in worker" in r.getMessage() and r.levelno == logging.WARNING
        for r in caplog.records
    )


async def test_shutdown_closes_redis(monkeypatch):
    calls: list = []
    monkeypatch.setattr("backend.core.redis.close_redis", _recorder(calls, "close"))

    await shutdown({})

    assert calls == ["close"]


async def test_shutdown_survives_close_redis_failure(monkeypatch):
    calls: list = []
    monkeypatch.setattr(
        "backend.core.redis.close_redis", _recorder(calls, "close", RuntimeError("boom"))
    )

    await shutdown({})

    assert calls == ["close"]


async def test_cost_accessor_sees_client_after_startup(monkeypatch):
    from backend.services.ai.cost import get_redis_or_none

    fake = FakeRedis()
    monkeypatch.setattr("backend.core.redis.redis_client", None)

    async def _fake_init_redis():
        monkeypatch.setattr("backend.core.redis.redis_client", fake)

    async def _noop():
        return None

    monkeypatch.setattr("backend.core.database.init_db_pool", _noop)
    monkeypatch.setattr("backend.core.redis.init_redis", _fake_init_redis)

    assert get_redis_or_none() is None
    await startup({})
    assert get_redis_or_none() is fake
