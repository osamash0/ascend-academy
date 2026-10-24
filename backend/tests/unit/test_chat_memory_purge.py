"""Erasure must be able to remove every tutor conversation of one person
from Redis: the session index, each session's metadata and its messages —
and nothing of anyone else's."""
from __future__ import annotations

from backend.services import chat_memory
from backend.tests.fake_redis import FakeRedis


async def test_purge_user_sessions_removes_index_meta_and_messages(monkeypatch):
    shared = FakeRedis()
    monkeypatch.setattr(chat_memory, "get_redis_client", lambda: shared)

    mine = await chat_memory.create_session("u-me", lecture_id="L1", title="t")
    await chat_memory.append_message(mine, "user", "my private question")
    theirs = await chat_memory.create_session("u-other", lecture_id="L1", title="t")
    await chat_memory.append_message(theirs, "user", "someone else's question")

    removed = await chat_memory.purge_user_sessions("u-me")

    assert removed == 1
    assert await chat_memory.get_session_metadata(mine) is None
    assert await chat_memory.get_history(mine) == []
    assert await chat_memory.get_user_sessions("u-me") == []
    # The other person's conversation is untouched.
    assert (await chat_memory.get_session_metadata(theirs))["user_id"] == "u-other"
    assert len(await chat_memory.get_history(theirs)) == 1


async def test_purge_is_a_no_op_for_an_unknown_user(monkeypatch):
    shared = FakeRedis()
    monkeypatch.setattr(chat_memory, "get_redis_client", lambda: shared)
    assert await chat_memory.purge_user_sessions("nobody") == 0
