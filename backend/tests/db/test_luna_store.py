# backend/tests/db/test_luna_store.py
"""PgStore against real Postgres: ownership, idempotency, the lock, memory, owned cards."""
from __future__ import annotations

import uuid

import asyncpg
import pytest

from backend.services.luna.store import PgStore

pytestmark = pytest.mark.db


class _Conn:
    def __init__(self, dsn: str):
        self.dsn = dsn

    async def __aenter__(self):
        self.c = await asyncpg.connect(self.dsn)
        return self.c

    async def __aexit__(self, *exc):
        await self.c.close()


@pytest.fixture
def store(pg_dsn, applied_migrations):
    async def connect():
        return _Conn(pg_dsn)

    return PgStore(connect=connect)


PLAN = [{"id": "s1", "kind": "look", "title": "t", "target": {"lecture_id": "x", "page": 1}, "status": "todo"}]


async def test_sessions_belong_to_their_learner_and_turns_are_idempotent(store, make_user, make_lecture):
    a, b, prof = make_user(), make_user(), make_user(role="professor")
    lecture = make_lecture(prof)
    s = await store.create_session(str(a), str(a), str(lecture), "exam Friday", PLAN)
    assert (await store.get_session(s["id"], str(a)))["plan"] == PLAN
    assert await store.get_session(s["id"], str(b)) is None

    ct = str(uuid.uuid4())
    await store.add_turns(s["id"], str(a), ct, [("learner", {"text": "hi"}), ("luna", {"say": "hello"})])
    await store.add_turns(s["id"], str(a), ct, [("learner", {"text": "hi"}), ("luna", {"say": "hello"})])
    assert [t["role"] for t in await store.turns_for_client_id(s["id"], ct)] == ["learner", "luna"]
    assert len(await store.recent_turns(s["id"], 8)) == 2


async def test_one_turn_in_flight(store, make_user):
    a = make_user()
    s = await store.create_session(str(a), str(a), None, "", PLAN)
    assert await store.claim(s["id"]) is True
    assert await store.claim(s["id"]) is False
    await store.release(s["id"])
    assert await store.claim(s["id"]) is True


async def test_memory_scopes_and_forgetting(store, make_user):
    a = make_user()
    added = await store.add_memory(str(a), [
        {"kind": "preference", "space_scoped": False, "text": "examples first"},
        {"kind": "shaky", "space_scoped": True, "text": "outer joins"},
    ], space_id="space-1", session_id=None)
    assert len(added) == 2
    assert {m["text"] for m in await store.active_memory(str(a), "space-1")} == {"examples first", "outer joins"}
    assert {m["text"] for m in await store.active_memory(str(a), "space-2")} == {"examples first"}
    await store.retire_memory(str(a), [added[1]["id"]])
    listed = await store.list_memory(str(a))
    assert [m["active"] for m in sorted(listed, key=lambda m: m["text"])] == [True, False]
    assert await store.forget_all(str(a)) == 2


async def test_owned_cards_are_scheduled_due_and_graded_only_by_their_owner(store, make_user, make_lecture):
    a, b, prof = make_user(), make_user(), make_user(role="professor")
    lecture = make_lecture(prof)
    card = {"question": "Does it hold?", "options": [{"text": "Yes", "correct": False, "why": "a"},
                                                    {"text": "No", "correct": True, "why": "b"}], "page": 1}
    assert await store.insert_owned_cards(str(a), str(lecture), [card, card]) == 1
    due = await store.due_cards(str(a), str(lecture))
    assert len(due) == 1 and due[0]["front"]["question"] == "Does it hold?"
    # The legacy review UI reads correct_answer/explanation; the deck reads correct/why.
    assert due[0]["back"] == {"correct": 1, "why": ["a", "b"], "correct_answer": "No", "explanation": "b"}
    assert await store.due_cards(str(b), str(lecture)) == []
    assert await store.grade_owned_card(str(b), due[0]["card_id"], 3) is None
    graded = await store.grade_owned_card(str(a), due[0]["card_id"], 3)
    assert graded["card_id"] == due[0]["card_id"]
    assert await store.due_cards(str(a), str(lecture)) == []


async def test_faded_memory_older_than_30_days_is_purged_before_luna_reads(store, make_user, db_conn):
    a = make_user()
    added = await store.add_memory(str(a), [
        {"kind": "preference", "space_scoped": False, "text": "examples first"},
        {"kind": "shaky", "space_scoped": False, "text": "outer joins"},
    ], space_id=None, session_id=None)
    await store.retire_memory(str(a), [added[1]["id"]])
    with db_conn.cursor() as cur:
        cur.execute("UPDATE learner_memory SET retired_at = now() - interval '31 days' WHERE id = %s", (added[1]["id"],))
    assert {m["text"] for m in await store.active_memory(str(a), "space-1")} == {"examples first"}
    with db_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM learner_memory WHERE user_id = %s", (str(a),))
        assert cur.fetchone()[0] == 1
