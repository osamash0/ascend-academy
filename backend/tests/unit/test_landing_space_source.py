"""The Space read takes a bounded share from each member, so one member cannot crowd out the rest."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import backend.services.insights.sources.space as source

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc)


def _read_with(monkeypatch, event_rows):
    seen: dict[str, tuple] = {}

    class Conn:
        async def fetch(self, sql, *args):
            if sql is source._MEMBERS_SQL:
                return [{"user_id": "member-a"}, {"user_id": "member-b"}]
            if sql is source._LESSONS_SQL:
                return [{"id": "lesson-1", "title": "Normalization", "pages": 4}]
            if sql is source._EVENTS_SQL:
                seen["sql"], seen["args"] = sql, args
                return event_rows
            return []

    class Ctx:
        async def __aenter__(self):
            return Conn()

        async def __aexit__(self, *exc):
            return False

    async def connect():
        return Ctx()

    monkeypatch.setattr(source, "get_db_connection", connect)
    data = asyncio.run(source.load_space_data("space-0000", "Database Systems", "owner", now=NOW))
    return data, seen


def test_the_read_ranks_each_members_events_and_is_given_a_per_member_cap(monkeypatch):
    _, seen = _read_with(monkeypatch, [])
    assert source.PER_MEMBER_CAP == 5_000
    assert "PARTITION BY user_id ORDER BY created_at DESC" in seen["sql"]
    assert "rn <= $7" in seen["sql"] and "LIMIT $6" in seen["sql"]
    assert seen["args"][-2:] == (source.EVENT_CAP, source.PER_MEMBER_CAP)


def test_a_member_who_hit_the_cap_is_warned_about_without_being_named_to_the_owner(monkeypatch, caplog):
    rows = [
        {"user_id": "member-a", "event_type": "slide_view", "event_data": {"lectureId": "lesson-1"}, "created_at": NOW}
        for _ in range(3)
    ] + [{"user_id": "member-b", "event_type": "slide_view", "event_data": {"lectureId": "lesson-1"}, "created_at": NOW}]
    from unittest import mock

    with mock.patch.object(source, "PER_MEMBER_CAP", 3), caplog.at_level("WARNING", logger=source.__name__):
        data, _ = _read_with(monkeypatch, rows)
    assert len(data.events) == 4
    assert "per-member cap" in caplog.text and "1 member" in caplog.text
