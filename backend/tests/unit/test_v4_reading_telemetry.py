"""A v4 progress ping: progress as before, plus a validated slide_view, the way back, and the finish."""
from __future__ import annotations

import asyncio
import uuid

import backend.services.v4_reading_service as svc
from backend.schemas.learning_events import validate_event

LEC = uuid.UUID("11111111-1111-1111-1111-111111111111")


class _Tx:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeConn:
    """Answers the reading service's queries; remembers what it was told to write."""

    def __init__(self, *, total=12, read_after=None, completed_at=None, durations=0):
        self.total = total
        self.read_after = read_after or [1, 2, 3]
        self.completed_at = completed_at
        self.durations = durations
        self.updates: list[str] = []

    def transaction(self):
        return _Tx()

    async def fetchrow(self, sql, *args):
        if "FROM lectures" in sql:
            return {"course_id": uuid.uuid4(), "total": self.total}
        if "INSERT INTO student_progress" in sql:
            return {"completed_slides": self.read_after, "completed_at": self.completed_at}
        raise AssertionError(sql)

    async def fetchval(self, sql, *args):
        if "lecture_visits" in sql:
            return True  # a recent visit: no new row
        if "FROM slides" in sql:
            return f"slide-{args[1]}"
        if "SUM(" in sql:
            return self.durations
        raise AssertionError(sql)

    async def execute(self, sql, *args):
        self.updates.append(sql)


def _run(monkeypatch, conn, **kw):
    events: list[tuple[str, dict]] = []

    class Ctx:
        async def __aenter__(self):
            return conn

        async def __aexit__(self, *exc):
            return False

    async def connect():
        return Ctx()

    async def record(c, user_id, event_type, data):
        # The real record_event drops a row the registry refuses, silently; here it must fail the test.
        validate_event(event_type, data)
        events.append((event_type, data))
        return True

    monkeypatch.setattr(svc, "get_db_connection", connect)
    monkeypatch.setattr(svc, "record_event", record)
    out = asyncio.run(svc.record_reading(LEC, "u1", **kw))
    return out, events


def test_a_page_read_writes_a_slide_view_with_its_session(monkeypatch):
    _, events = _run(monkeypatch, FakeConn(), page=3, seconds=40.4, session_id="s1")
    [(kind, data)] = events
    assert kind == "slide_view"
    assert data == {
        "lectureId": str(LEC), "slideId": "slide-3", "page": 3, "duration_seconds": 40,
        "sessionId": "s1", "timestamp": data["timestamp"], "source": "v4_reader",
    }


def test_turning_back_is_recorded_even_after_a_glance(monkeypatch):
    _, events = _run(monkeypatch, FakeConn(), page=8, seconds=1.0, session_id="s1", to_page=7)
    assert [k for k, _ in events] == ["slide_back_navigation"]
    back = events[0][1]
    assert (back["fromSlideId"], back["toSlideId"], back["fromPage"], back["toPage"]) == ("slide-8", "slide-7", 8, 7)


def test_turning_forward_is_not_a_way_back(monkeypatch):
    _, events = _run(monkeypatch, FakeConn(), page=3, seconds=10, session_id="s1", to_page=4)
    assert [k for k, _ in events] == ["slide_view"]


def test_the_last_unread_page_finishes_the_lesson_once(monkeypatch):
    conn = FakeConn(total=3, read_after=[1, 2, 3], completed_at=None, durations=125)
    out, events = _run(monkeypatch, conn, page=3, seconds=20, session_id="s1")
    assert [k for k, _ in events] == ["slide_view", "lecture_complete"]
    done = events[1][1]
    assert done["total_duration_seconds"] == 125 and done["sessionId"] == "s1" and done["source"] == "v4_reader"
    assert any("completed_at = now()" in u for u in conn.updates)
    assert out == {"pagesRead": 3, "percentComplete": 100}


def test_an_already_finished_lesson_does_not_finish_again(monkeypatch):
    import datetime

    conn = FakeConn(total=3, read_after=[1, 2, 3], completed_at=datetime.datetime.now())
    _, events = _run(monkeypatch, conn, page=2, seconds=20, session_id="s1")
    assert [k for k, _ in events] == ["slide_view"]


def test_the_seconds_sum_never_casts_a_stored_duration_unguarded():
    """One odd stored duration must not abort the progress transaction (and the finish with it)."""
    import re

    sql = svc._SECONDS_READ_SQL
    assert "::int" not in sql  # the old bare cast raises on "40.0"
    [pattern] = re.findall(r"~ '([^']+)'", sql)  # the guard Postgres applies before the numeric cast
    for fine in ("0", "40", "40.0", "12.75"):
        assert re.search(pattern, fine), fine
    for odd in ("", "abc", "1e3", "-5", "40.", ".5", "4 0"):
        assert not re.search(pattern, odd), odd


def test_a_decimal_sum_from_the_database_still_finishes_with_an_int(monkeypatch):
    from decimal import Decimal

    conn = FakeConn(total=3, read_after=[1, 2, 3], completed_at=None, durations=Decimal("125"))
    _, events = _run(monkeypatch, conn, page=3, seconds=20, session_id="s1")
    done = events[1][1]
    assert done["total_duration_seconds"] == 125 and isinstance(done["total_duration_seconds"], int)
