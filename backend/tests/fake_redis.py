"""In-memory stand-in for `redis.asyncio.Redis` / `arq.ArqRedis`.

Companion to `fake_supabase.FakeSupabaseClient` and to the outbound-access
guard in `conftest.py`: several product paths open a *throwaway* Redis
connection on their own (`unified_orchestrator`'s in-flight parse lock,
`card_factory`'s review-cards lock, `upload_service.get_arq_pool`), so a unit
test exercising them cannot avoid Redis by stubbing its own collaborators —
the connection is created several frames deep in the code under test.

Only the operations product code actually performs on those connections are
implemented. Anything else raises AttributeError, which is the desired
outcome: a loud failure pointing at the new operation, not a silent no-op that
makes a test look like it covered something it didn't.
"""
from __future__ import annotations

import time
from typing import Any


class FakeRedis:
    """Dict-backed async Redis. Shared by every connection in one test."""

    def __init__(self) -> None:
        self.store: dict[str, Any] = {}
        self.expiry: dict[str, float] = {}
        self.published: list[tuple[str, str]] = []
        self.enqueued: list[tuple[str, dict]] = []
        self.closed = False

    # ── internals ────────────────────────────────────────────────────────────
    def _live(self, key: str) -> bool:
        exp = self.expiry.get(key)
        if exp is not None and exp <= time.monotonic():
            self.store.pop(key, None)
            self.expiry.pop(key, None)
            return False
        return key in self.store

    # ── strings ──────────────────────────────────────────────────────────────
    async def set(self, key: str, value: Any, nx: bool = False, ex: int | None = None) -> bool | None:
        if nx and self._live(key):
            return None
        self.store[key] = value
        if ex:
            self.expiry[key] = time.monotonic() + ex
        return True

    async def setex(self, key: str, seconds: int, value: Any) -> bool:
        return bool(await self.set(key, value, ex=seconds))

    async def get(self, key: str) -> Any:
        return self.store.get(key) if self._live(key) else None

    async def incr(self, key: str, amount: int = 1) -> int:
        new = int(self.store.get(key, 0)) + amount
        self.store[key] = new
        return new

    async def incrbyfloat(self, key: str, amount: float) -> float:
        new = float(self.store.get(key, 0.0)) + amount
        self.store[key] = new
        return new

    async def delete(self, *keys: str) -> int:
        removed = 0
        for key in keys:
            if self.store.pop(key, None) is not None:
                removed += 1
            self.expiry.pop(key, None)
        return removed

    async def exists(self, *keys: str) -> int:
        return sum(1 for key in keys if self._live(key))

    async def expire(self, key: str, seconds: int) -> bool:
        if not self._live(key):
            return False
        self.expiry[key] = time.monotonic() + seconds
        return True

    # ── lists / hashes / sets ────────────────────────────────────────────────
    async def rpush(self, key: str, *values: Any) -> int:
        bucket = self.store.setdefault(key, [])
        bucket.extend(values)
        return len(bucket)

    async def lrange(self, key: str, start: int, end: int) -> list:
        bucket = self.store.get(key, [])
        return bucket[start:] if end == -1 else bucket[start:end + 1]

    async def llen(self, key: str) -> int:
        return len(self.store.get(key, []))

    async def hset(self, key: str, field: str | None = None, value: Any = None, mapping: dict | None = None) -> int:
        bucket = self.store.setdefault(key, {})
        if mapping:
            bucket.update(mapping)
        if field is not None:
            bucket[field] = value
        return len(bucket)

    async def hgetall(self, key: str) -> dict:
        return dict(self.store.get(key, {}))

    async def sadd(self, key: str, *values: Any) -> int:
        bucket = self.store.setdefault(key, set())
        before = len(bucket)
        bucket.update(values)
        return len(bucket) - before

    async def smembers(self, key: str) -> set:
        return set(self.store.get(key, set()))

    async def srem(self, key: str, *values: Any) -> int:
        bucket = self.store.get(key, set())
        before = len(bucket)
        bucket.difference_update(values)
        return before - len(bucket)

    async def zcard(self, key: str) -> int:
        return len(self.store.get(key, {}))

    # ── pub/sub + lifecycle ──────────────────────────────────────────────────
    async def publish(self, channel: str, message: str) -> int:
        self.published.append((channel, message))
        return 0

    async def ping(self) -> bool:
        return True

    async def aclose(self) -> None:
        self.closed = True

    async def close(self) -> None:
        self.closed = True

    # ── arq ──────────────────────────────────────────────────────────────────
    async def enqueue_job(self, function: str, *args: Any, **kwargs: Any):
        self.enqueued.append((function, kwargs))
        return None
