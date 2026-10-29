"""The owner's view of a Space: who may open it, and what it says."""
from __future__ import annotations

import asyncio
import uuid

import backend.services.v4_landing_service as service

OWNER = "11111111-1111-1111-1111-111111111111"
SPACE = uuid.UUID("33333333-3333-3333-3333-333333333333")


def test_the_personal_space_has_no_owners_view_and_reads_nothing(monkeypatch):
    async def boom():
        raise AssertionError("no database read for the personal Space")

    monkeypatch.setattr(service, "get_db_connection", boom)
    assert asyncio.run(service.space_row(uuid.UUID(OWNER), OWNER)) is None


def test_a_space_row_says_who_owns_it_and_whether_the_caller_belongs(monkeypatch):
    seen = {}

    class Conn:
        async def fetchrow(self, sql, *args):
            seen["args"] = args
            return {"id": SPACE, "title": "DBS", "professor_id": uuid.UUID(OWNER), "is_member": True}

    class Ctx:
        async def __aenter__(self):
            return Conn()

        async def __aexit__(self, *exc):
            return False

    async def connect():
        return Ctx()

    monkeypatch.setattr(service, "get_db_connection", connect)
    row = asyncio.run(service.space_row(SPACE, "u2"))
    assert row == {"id": SPACE, "title": "DBS", "professor_id": uuid.UUID(OWNER), "is_member": True}
    assert seen["args"] == (SPACE, "u2")
