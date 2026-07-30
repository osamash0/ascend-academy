"""Unit tests for backend/core/job_locks.py (Roadmap P2-3).

Acceptance criterion under test: "Re-enqueuing the same pdf_hash while one is
in flight does not double-process." We test this at the lock-acquisition
level — two concurrent attempts to acquire the same key, only one should
win — rather than driving a full Arq worker end-to-end.

`FakeRedis.set(..., nx=True)` below reproduces Redis's real guarantee: SET NX
is atomic server-side, so under true concurrency exactly one caller ever
observes the key absent. We model that with an `asyncio.Lock` guarding the
check-and-set, which is the same atomicity Redis gives for free.
"""
from __future__ import annotations

import asyncio

import pytest

from backend.core.job_locks import (
    acquire_job_lock,
    parse_lock_key,
    release_job_lock,
    review_cards_lock_key,
)


class FakeRedis:
    """Minimal async Redis double with atomic SET NX semantics."""

    def __init__(self):
        self.store: dict[str, str] = {}
        self._mutex = asyncio.Lock()
        self.set_calls: list[tuple[str, bool]] = []

    async def set(self, key: str, value: str, nx: bool = False, ex: int | None = None):
        async with self._mutex:
            # Simulate real Redis latency so two truly-concurrent callers
            # actually interleave instead of trivially running sequentially.
            await asyncio.sleep(0)
            if nx and key in self.store:
                self.set_calls.append((key, False))
                return None
            self.store[key] = value
            self.set_calls.append((key, True))
            return True

    async def delete(self, key: str):
        self.store.pop(key, None)


class BrokenRedis:
    async def set(self, *a, **kw):
        raise ConnectionError("redis down")

    async def delete(self, *a, **kw):
        raise ConnectionError("redis down")


def test_lock_key_helpers_are_namespaced_and_distinct():
    assert parse_lock_key("abc123") == "joblock:parse:abc123"
    assert review_cards_lock_key("lec-1") == "joblock:review_cards:lec-1"
    assert parse_lock_key("x") != review_cards_lock_key("x")


async def test_single_acquire_succeeds():
    redis = FakeRedis()
    got = await acquire_job_lock(redis, "joblock:parse:hash1", ttl_seconds=60)
    assert got is True
    assert redis.store["joblock:parse:hash1"] == "1"


async def test_second_acquire_while_held_fails():
    redis = FakeRedis()
    first = await acquire_job_lock(redis, "joblock:parse:hash1", ttl_seconds=60)
    second = await acquire_job_lock(redis, "joblock:parse:hash1", ttl_seconds=60)
    assert first is True
    assert second is False


async def test_two_concurrent_acquires_exactly_one_wins():
    """The core P2-3 acceptance test: simulate re-enqueuing the same
    pdf_hash while a first attempt is in flight — exactly one of the two
    concurrent lock attempts must succeed, proving the pipeline cannot
    double-process the same natural key."""
    redis = FakeRedis()
    key = parse_lock_key("same-pdf-hash")

    results = await asyncio.gather(
        acquire_job_lock(redis, key, ttl_seconds=60),
        acquire_job_lock(redis, key, ttl_seconds=60),
    )

    assert sorted(results) == [False, True]
    assert results.count(True) == 1


async def test_release_then_reacquire_succeeds():
    redis = FakeRedis()
    key = parse_lock_key("hash2")
    await acquire_job_lock(redis, key, ttl_seconds=60)
    await release_job_lock(redis, key)
    got_again = await acquire_job_lock(redis, key, ttl_seconds=60)
    assert got_again is True


async def test_none_redis_degrades_to_proceed_without_lock():
    # No connection available (e.g. dev fallback with no redis wired up) —
    # must not block the job, just skip locking.
    assert await acquire_job_lock(None, "joblock:parse:x", ttl_seconds=60) is True
    # release is a no-op, must not raise
    await release_job_lock(None, "joblock:parse:x")


async def test_redis_outage_fails_open_not_closed():
    # A broken Redis must not block job processing — treated as "proceed
    # without a lock" rather than an error that stalls the pipeline.
    redis = BrokenRedis()
    got = await acquire_job_lock(redis, "joblock:parse:x", ttl_seconds=60)
    assert got is True
    # release must also swallow the error
    await release_job_lock(redis, "joblock:parse:x")
