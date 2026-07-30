"""Unit tests for the idempotency dependency (backend/core/idempotency.py).

Guards against duplicate create requests (e.g. double-submitted create_course).
The Redis call is the only I/O — mocked here. Pins: no header => pass-through;
Redis down => fail-open (don't block writes on infra); first key => reserved
atomically with a 24h TTL; repeated key => 409 without touching the existing
reservation; keys are scoped per caller (bearer-token hash, not
`request.state.user_id` — nothing in this codebase ever sets that, which was
the actual bug: every real caller fell into one shared "anonymous" bucket) so
two different callers' identical key values don't collide; a handler that
raises releases the reservation so an immediate retry isn't locked out for
the rest of the 24h TTL.

`check_idempotency` is an async-generator dependency (so it can react to the
guarded handler raising, via FastAPI feeding the exception into the
generator at its `yield` — verified empirically against the pinned FastAPI
version in this repo). Drive it directly here with `__anext__`/`athrow`
rather than a plain `await`, since an async-generator function call returns
a generator object, not a coroutine.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.core import idempotency


class FakeRedis:
    """Minimal async Redis double tracking set(nx=)/delete() calls."""

    def __init__(self, existing: set[str] | None = None):
        self.store: set[str] = set(existing or [])
        self.set_calls: list[tuple[str, bool, int]] = []
        self.deleted: list[str] = []

    async def set(self, key: str, value: str, nx: bool = False, ex: int | None = None) -> bool:
        self.set_calls.append((key, nx, ex))
        if nx and key in self.store:
            return False
        self.store.add(key)
        return True

    async def delete(self, key: str) -> None:
        self.deleted.append(key)
        self.store.discard(key)


def _request(headers: dict | None = None):
    return SimpleNamespace(headers=headers or {}, state=SimpleNamespace())


def _patch_redis(monkeypatch, redis):
    async def _get():
        return redis
    monkeypatch.setattr(idempotency, "get_redis_client", _get)


async def _acquire(request):
    """Drive the generator up to its first (and only) yield, returning the
    yielded value and the still-open generator (so a test can simulate the
    guarded handler's outcome via athrow/aclose)."""
    gen = idempotency.check_idempotency(request)
    value = await gen.__anext__()
    return value, gen


# ── pass-through / fail-open ─────────────────────────────────────────────────

async def test_no_header_passes_through_without_touching_redis(monkeypatch):
    redis = FakeRedis()
    _patch_redis(monkeypatch, redis)
    value, gen = await _acquire(_request(headers={}))
    assert value is None
    assert redis.set_calls == []  # redis must not be touched when no key given
    await gen.aclose()


async def test_redis_unavailable_fails_open(monkeypatch):
    # If Redis can't be reached, don't block the write — yield None and proceed.
    async def _none():
        return None
    monkeypatch.setattr(idempotency, "get_redis_client", _none)
    value, gen = await _acquire(_request(headers={"Idempotency-Key": "k1"}))
    assert value is None
    await gen.aclose()


# ── acquire / duplicate ───────────────────────────────────────────────────────

async def test_first_use_reserves_key_with_24h_ttl(monkeypatch):
    redis = FakeRedis()
    _patch_redis(monkeypatch, redis)
    value, gen = await _acquire(
        _request(headers={"Idempotency-Key": "k1", "Authorization": "Bearer prof-1-token"})
    )
    assert value == "k1"
    assert len(redis.set_calls) == 1
    key, nx, ttl = redis.set_calls[0]
    assert nx is True
    assert ttl == 86400
    await gen.aclose()


async def test_duplicate_key_raises_409_without_new_reservation(monkeypatch):
    ns = idempotency._caller_namespace(_request(headers={"Authorization": "Bearer prof-1-token"}))
    redis = FakeRedis(existing={f"idempotency:{ns}:k1"})
    _patch_redis(monkeypatch, redis)
    with pytest.raises(HTTPException) as exc:
        await _acquire(
            _request(headers={"Idempotency-Key": "k1", "Authorization": "Bearer prof-1-token"})
        )
    assert exc.value.status_code == 409
    # SET NX itself is the only redis call — no separate exists()+setex() race,
    # and a duplicate's failed NX must not have overwritten the reservation.
    assert len(redis.set_calls) == 1


async def test_same_key_different_callers_do_not_collide(monkeypatch):
    ns1 = idempotency._caller_namespace(_request(headers={"Authorization": "Bearer prof-1-token"}))
    redis = FakeRedis(existing={f"idempotency:{ns1}:k1"})
    _patch_redis(monkeypatch, redis)
    # A different caller (different bearer token) reusing the same
    # client-chosen key value must still succeed — this is the actual bug
    # fix: the old implementation scoped by request.state.user_id, which no
    # code path ever sets, so every real caller fell into one "anonymous"
    # bucket and collided here.
    value, gen = await _acquire(
        _request(headers={"Idempotency-Key": "k1", "Authorization": "Bearer prof-2-token"})
    )
    assert value == "k1"
    await gen.aclose()


async def test_no_auth_header_still_scopes_consistently(monkeypatch):
    redis = FakeRedis()
    _patch_redis(monkeypatch, redis)
    value, gen = await _acquire(_request(headers={"Idempotency-Key": "k1"}))
    assert value == "k1"
    key, _, _ = redis.set_calls[0]
    assert key == "idempotency:no-auth:k1"
    await gen.aclose()


# ── release-on-failure (the other real bug: no 24h self-inflicted lockout) ──

async def test_handler_failure_releases_the_key(monkeypatch):
    redis = FakeRedis()
    _patch_redis(monkeypatch, redis)
    value, gen = await _acquire(
        _request(headers={"Idempotency-Key": "k1", "Authorization": "Bearer prof-1-token"})
    )
    assert value == "k1"
    key, _, _ = redis.set_calls[0]
    assert key in redis.store

    # Simulate the guarded handler raising — FastAPI throws the exception
    # into the generator at its `yield` point.
    with pytest.raises(RuntimeError):
        await gen.athrow(RuntimeError("handler blew up"))

    # The reservation must be released so an immediate retry with the same
    # key is not locked out for the rest of the 24h TTL.
    assert key not in redis.store
    assert redis.deleted == [key]


async def test_handler_success_leaves_the_key_reserved(monkeypatch):
    redis = FakeRedis()
    _patch_redis(monkeypatch, redis)
    value, gen = await _acquire(
        _request(headers={"Idempotency-Key": "k1", "Authorization": "Bearer prof-1-token"})
    )
    key, _, _ = redis.set_calls[0]

    # Simulate the guarded handler completing normally — the generator has
    # no second yield, so advancing it raises StopAsyncIteration.
    with pytest.raises(StopAsyncIteration):
        await gen.__anext__()

    # A successful call keeps the reservation for the full window, so a
    # genuine duplicate submission is still rejected.
    assert key in redis.store
    assert redis.deleted == []
