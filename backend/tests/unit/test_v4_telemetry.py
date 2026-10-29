"""The v4 reader's small telemetry writers: one connection, one validated row, never a raised error."""
from __future__ import annotations

import asyncio
import uuid

import backend.services.v4_telemetry as tel

LEC = uuid.UUID("11111111-1111-1111-1111-111111111111")
SLIDE = "33333333-3333-3333-3333-333333333333"


def _fake_db(monkeypatch, *, slide=SLIDE, fail_connect=False):
    written: list[tuple[str, str, dict]] = []

    class Conn:
        async def fetchval(self, sql, *args):
            assert "FROM slides" in sql
            return slide

    class Ctx:
        async def __aenter__(self):
            return Conn()

        async def __aexit__(self, *exc):
            return False

    async def connect():
        if fail_connect:
            raise OSError("db down")
        return Ctx()

    async def record(conn, user_id, event_type, data):
        written.append((user_id, event_type, data))
        return True

    monkeypatch.setattr(tel, "get_db_connection", connect)
    monkeypatch.setattr(tel, "record_event", record)
    return written


def test_help_is_an_ai_tutor_query_on_its_page(monkeypatch):
    written = _fake_db(monkeypatch)
    asyncio.run(tel.record_help(LEC, "u1", 12, "ask", "Why BCNF?", "s1"))
    [(uid, kind, data)] = written
    assert (uid, kind) == ("u1", "ai_tutor_query")
    assert data["lectureId"] == str(LEC) and data["slideId"] == SLIDE and data["page"] == 12
    assert data["kind"] == "ask" and data["query"] == "Why BCNF?" and data["sessionId"] == "s1"
    assert data["source"] == "v4_reader" and data["timestamp"]


def test_check_in_and_checkpoint_rows(monkeypatch):
    written = _fake_db(monkeypatch, slide=None)
    asyncio.run(tel.record_check_in(LEC, "u1", 9, "Joins", "confused", "s1"))
    asyncio.run(tel.record_checkpoint(LEC, "u1", 9, "Joins", "choice", False, "s1"))
    (_, k1, d1), (_, k2, d2) = written
    assert k1 == "confidence_rating" and d1["rating"] == "confused" and d1["idea"] == "Joins" and d1["slideId"] is None
    assert k2 == "checkpoint_attempt" and d2["kind"] == "choice" and d2["correct"] is False and d2["page"] == 9


def test_a_database_that_is_down_costs_nothing(monkeypatch):
    _fake_db(monkeypatch, fail_connect=True)
    asyncio.run(tel.record_help(LEC, "u1", 1, "explain", "", "s1"))  # must not raise


def test_a_missing_session_becomes_a_fresh_one():
    assert tel.session_or_new("abc") == "abc"
    fresh = tel.session_or_new("")
    assert fresh and fresh != tel.session_or_new("")
