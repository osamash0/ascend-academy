"""Tests for the outbound-access guard in `backend/tests/conftest.py`.

The guard exists because a single real connection from a unit test does not
fail *there* — `backend.core.database` caches its asyncpg pool at module level
while pytest-asyncio gives each test a fresh event loop, so the damage shows up
later as `another operation is in progress` / `Future attached to a different
loop` in an unrelated test. These tests pin the guard's own behaviour so it
cannot be silently defeated.
"""
from __future__ import annotations

import socket

import pytest

from backend.tests.network_guard import BlockedOutboundAccess


def test_guard_is_not_catchable_as_exception():
    """Product code wraps DB/HTTP calls in `except Exception` all over the place
    (`job_locks.acquire_job_lock`, `cost.log_llm_call`, `event_repo.insert_event`
    …). If the guard were an Exception, every one of those would swallow it and
    hand back the silent behaviour the guard exists to surface."""
    assert issubclass(BlockedOutboundAccess, BaseException)
    assert not issubclass(BlockedOutboundAccess, Exception)


async def test_asyncpg_pool_creation_is_blocked():
    import asyncpg

    with pytest.raises(BlockedOutboundAccess, match="Postgres"):
        await asyncpg.create_pool("postgresql://nope/nope")


async def test_get_db_connection_is_blocked(monkeypatch):
    """The guard has to fire through the app's own accessor, not just the raw
    driver — this is the call every service actually makes.

    `DB_URL` is patched because `get_db_connection` only reaches the driver when
    one is configured: `init_db_pool` returns early on a missing DATABASE_URL
    (database.py:156), leaving `db_pool` unset, so `get_db_connection` raises
    `RuntimeError("Database pool not initialized")` on the next line and the
    guard never gets a connection to block.

    Without this the test asserted different things in different environments --
    it passed locally off a populated .env and failed in CI, where DATABASE_URL
    is unset. Pinning the URL here makes the attempted connection, and therefore
    the guard, the actual subject of the test.
    """
    from backend.core import database

    monkeypatch.setattr(database, "DB_URL", "postgresql://nope/nope", raising=False)
    monkeypatch.setattr(database, "db_pool", None, raising=False)

    with pytest.raises(BlockedOutboundAccess, match="Postgres"):
        await database.get_db_connection()


def test_real_http_request_is_blocked():
    import httpx

    with pytest.raises(BlockedOutboundAccess, match="HTTP"):
        httpx.get("https://example.test/should-never-be-reached")


async def test_real_async_http_request_is_blocked():
    import httpx

    async with httpx.AsyncClient() as client:
        with pytest.raises(BlockedOutboundAccess, match="HTTP"):
            await client.get("https://example.test/should-never-be-reached")


def test_raw_socket_connect_is_blocked():
    with pytest.raises(BlockedOutboundAccess, match="socket"):
        socket.create_connection(("example.test", 80), timeout=0.1)

    with pytest.raises(BlockedOutboundAccess, match="socket"):
        socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect(("example.test", 80))


def test_asgi_transport_still_works(app_client):
    """The guard must only block *real* transports: Starlette's TestClient talks
    to the app in-process over ASGITransport and has to keep working."""
    assert app_client.get("/health").status_code == 200


async def test_redis_connections_are_faked_not_blocked(fake_redis):
    """Redis is faked rather than blocked, because product code opens its own
    throwaway connections several frames deep (parse/review in-flight locks)."""
    import redis.asyncio as aioredis

    conn = aioredis.from_url("redis://localhost:6379")
    assert conn is fake_redis
    assert await conn.set("joblock:x", "1", nx=True, ex=30) is True
    assert await conn.set("joblock:x", "1", nx=True, ex=30) is None  # held
    assert await conn.delete("joblock:x") == 1


async def test_arq_pool_is_faked(fake_redis):
    from backend.services.upload_service import get_arq_pool

    pool = await get_arq_pool()
    await pool.enqueue_job("rollup_analytics_cache", lecture_id="L1")
    assert fake_redis.enqueued == [("rollup_analytics_cache", {"lecture_id": "L1"})]


@pytest.mark.allow_network
def test_allow_network_marker_lifts_the_guard():
    """Escape hatch for a test that deliberately needs real access. Nothing is
    connected to here — reaching the raw driver call is proof enough that the
    guard stepped aside."""
    assert socket.socket.connect is socket.socket.__mro__[1].connect
