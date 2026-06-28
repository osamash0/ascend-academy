"""Unit tests for the idempotency dependency (backend/core/idempotency.py).

Guards against duplicate create requests (e.g. double-submitted create_course).
The Redis call is the only I/O — mocked here. Pins: no header => pass-through;
Redis down => fail-open (don't block writes on infra); first key => reserved with
a 24h TTL; repeated key => 409; keys are scoped per user so two users' identical
keys don't collide.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.core import idempotency


class FakeRedis:
    """Minimal async Redis double tracking exists()/setex() calls."""

    def __init__(self, existing: set[str] | None = None):
        self.store: set[str] = set(existing or [])
        self.setex_calls: list[tuple[str, int, str]] = []

    async def exists(self, key: str) -> int:
        return 1 if key in self.store else 0

    async def setex(self, key: str, ttl: int, value: str) -> None:
        self.setex_calls.append((key, ttl, value))
        self.store.add(key)


def _request(headers: dict | None = None, user_id: str | None = "prof-1"):
    state = SimpleNamespace()
    if user_id is not None:
        state.user_id = user_id
    return SimpleNamespace(headers=headers or {}, state=state)


def _patch_redis(monkeypatch, redis):
    async def _get():
        return redis
    monkeypatch.setattr(idempotency, "get_redis_client", _get)


async def test_no_header_passes_through_without_touching_redis(monkeypatch):
    redis = FakeRedis()
    _patch_redis(monkeypatch, redis)
    result = await idempotency.check_idempotency(_request(headers={}))
    assert result is None
    assert redis.setex_calls == []  # redis must not be written when no key given


async def test_redis_unavailable_fails_open(monkeypatch):
    # If Redis can't be reached, don't block the write — return None and proceed.
    async def _none():
        return None
    monkeypatch.setattr(idempotency, "get_redis_client", _none)
    result = await idempotency.check_idempotency(
        _request(headers={"Idempotency-Key": "k1"})
    )
    assert result is None


async def test_first_use_reserves_key_with_24h_ttl(monkeypatch):
    redis = FakeRedis()
    _patch_redis(monkeypatch, redis)
    result = await idempotency.check_idempotency(
        _request(headers={"Idempotency-Key": "k1"}, user_id="prof-1")
    )
    assert result == "k1"
    assert len(redis.setex_calls) == 1
    key, ttl, _ = redis.setex_calls[0]
    assert key == "idempotency:prof-1:k1"
    assert ttl == 86400


async def test_duplicate_key_raises_409(monkeypatch):
    redis = FakeRedis(existing={"idempotency:prof-1:k1"})
    _patch_redis(monkeypatch, redis)
    with pytest.raises(HTTPException) as exc:
        await idempotency.check_idempotency(
            _request(headers={"Idempotency-Key": "k1"}, user_id="prof-1")
        )
    assert exc.value.status_code == 409
    # A duplicate must NOT refresh/extend the reservation.
    assert redis.setex_calls == []


async def test_same_key_different_users_do_not_collide(monkeypatch):
    redis = FakeRedis(existing={"idempotency:prof-1:k1"})
    _patch_redis(monkeypatch, redis)
    # prof-2 reusing the same client-chosen key must still succeed.
    result = await idempotency.check_idempotency(
        _request(headers={"Idempotency-Key": "k1"}, user_id="prof-2")
    )
    assert result == "k1"
    assert redis.setex_calls[0][0] == "idempotency:prof-2:k1"


async def test_missing_user_id_falls_back_to_anonymous_scope(monkeypatch):
    redis = FakeRedis()
    _patch_redis(monkeypatch, redis)
    await idempotency.check_idempotency(
        _request(headers={"Idempotency-Key": "k1"}, user_id=None)
    )
    assert redis.setex_calls[0][0] == "idempotency:anonymous:k1"
