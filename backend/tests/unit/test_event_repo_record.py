"""record_event: one validated write path for asyncpg callers (the v4 reader)."""
from __future__ import annotations

import asyncio
import json

from backend.repositories.event_repo import record_event


class _Savepoint:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        self.conn.savepoints += 1

    async def __aexit__(self, *exc):
        return False


class FakeConn:
    def __init__(self, fail: bool = False):
        self.fail = fail
        self.savepoints = 0
        self.rows: list[tuple[str, str, dict]] = []

    def transaction(self):
        return _Savepoint(self)

    async def execute(self, sql, *args):
        if self.fail:
            raise RuntimeError("new row violates check constraint")
        user_id, event_type, data = args
        self.rows.append((user_id, event_type, json.loads(data)))


GOOD = {"lectureId": "L1", "slideId": None, "page": 2, "duration_seconds": 5,
        "sessionId": "s1", "timestamp": "2026-10-27T00:00:00Z", "source": "v4_reader"}


def test_a_valid_event_is_written_in_a_savepoint():
    conn = FakeConn()
    assert asyncio.run(record_event(conn, "u1", "slide_view", GOOD)) is True
    assert conn.savepoints == 1
    assert conn.rows == [("u1", "slide_view", GOOD)]


def test_a_payload_the_registry_refuses_is_dropped_not_raised():
    conn = FakeConn()
    assert asyncio.run(record_event(conn, "u1", "slide_view", {**GOOD, "response": "x"})) is False
    assert asyncio.run(record_event(conn, "u1", "made_up", GOOD)) is False
    assert conn.rows == []


def test_a_write_the_database_refuses_is_dropped_not_raised():
    conn = FakeConn(fail=True)
    assert asyncio.run(record_event(conn, "u1", "slide_view", GOOD)) is False
