"""Unit tests for GET /health/ready's queue-drain check (Milestone-4 M34).

A raw "can we ping Redis" check stays green even when the Arq worker process
is completely dead — the queue just backs up forever while every upload
100% fails (M16). These pin the fix: readiness now also fails when there's
an actual backlog AND no worker has written its liveness heartbeat recently
enough to trust it's alive and draining that backlog. An idle queue (depth 0)
never needs a heartbeat at all — nothing to drain, so nothing can be stuck.

Uses the same `app`/`fake_redis` fixtures as the rest of the suite (see
conftest.py): `fake_redis` transparently backs both the app-cache Redis and
the Arq queue Redis with one shared in-memory `FakeRedis`, so queue depth
(zcard on arq's default queue key) and the heartbeat key live on the same
object a test can seed directly.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from arq.constants import default_queue_name
from backend.core.worker_heartbeat import WORKER_HEARTBEAT_KEY


@pytest.fixture(autouse=True)
def _stub_unrelated_readiness_checks(monkeypatch):
    """`/health/ready` also probes the asyncpg pool and the app-cache Redis
    (`backend.core.redis.get_redis_client()`), neither of which this test
    module's fixtures initialize — that's orthogonal to the M34 fix under
    test here (queue-drain health), so both are stubbed to "healthy" so a
    test failure here can only mean the job_worker check misbehaved.
    """
    from backend.core import database as _database

    monkeypatch.setattr(_database, "DB_URL", None, raising=False)

    from backend.core import redis as _redis_core

    class _FakeCacheRedis:
        async def ping(self) -> bool:
            return True

    monkeypatch.setattr(_redis_core, "redis_client", _FakeCacheRedis(), raising=False)


def test_ready_ok_when_queue_empty_even_without_heartbeat(app, fake_redis):
    """An empty queue needs no worker heartbeat — nothing to drain."""
    client = TestClient(app)
    resp = client.get("/health/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["checks"]["job_worker"] == "ok (queue empty)"


def test_ready_ok_when_backlog_present_and_heartbeat_fresh(app, fake_redis):
    """A backlog with a fresh worker heartbeat means it's actively draining
    — transient, not a failure."""
    fake_redis.store[default_queue_name] = {f"job-{i}": i for i in range(60)}
    fake_redis.store[WORKER_HEARTBEAT_KEY] = "1"

    client = TestClient(app)
    resp = client.get("/health/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "backlog=60" in body["checks"]["job_worker"]
    assert "heartbeat present" in body["checks"]["job_worker"]


def test_ready_fails_when_backlog_present_and_no_heartbeat(app, fake_redis):
    """M34's actual failure mode: a nonempty queue with NO worker heartbeat
    at all — the worker is likely dead and nothing will ever drain it. This
    must fail readiness (503), unlike a plain Redis ping which stays green."""
    fake_redis.store[default_queue_name] = {f"job-{i}": i for i in range(60)}
    # No heartbeat key set — simulates a dead/never-started worker.

    client = TestClient(app)
    resp = client.get("/health/ready")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "unavailable"
    assert "no worker heartbeat" in body["checks"]["job_worker"]
    assert "worker likely down" in body["checks"]["job_worker"]
