"""The first answer to a question is a quiz_attempt; every later one is a quiz_retry_attempt."""
from __future__ import annotations

import asyncio
import json
import uuid

import backend.services.v4_practice_service as svc

LEC = uuid.UUID("11111111-1111-1111-1111-111111111111")
Q = uuid.UUID("44444444-4444-4444-4444-444444444444")
SLIDE = uuid.UUID("33333333-3333-3333-3333-333333333333")


class _Tx:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeConn:
    def __init__(self, prior: int, first_answer=None):
        self.prior = prior
        self.first_answer = first_answer

    def transaction(self):
        return _Tx()

    async def fetchrow(self, sql, *args):
        if "FROM quiz_questions" in sql:
            return {"id": Q, "question_text": "Which?", "options": json.dumps(["a", "b", "c"]),
                    "correct_answer": 1, "metadata": "{}", "slide_number": 4, "slide_id": SLIDE}
        if "FROM learning_events" in sql:
            return {"n": self.prior, "first_answer": self.first_answer}
        raise AssertionError(sql)

    async def fetchval(self, sql, *args):
        return None  # XP already granted once: nothing inserted

    async def execute(self, sql, *args):
        return None


def _run(monkeypatch, conn, chosen):
    events = []

    class Ctx:
        async def __aenter__(self):
            return conn

        async def __aexit__(self, *exc):
            return False

    async def connect():
        return Ctx()

    async def record(c, user_id, event_type, data):
        events.append((event_type, data))
        return True

    monkeypatch.setattr(svc, "get_db_connection", connect)
    monkeypatch.setattr(svc, "record_event", record)
    out = asyncio.run(svc.answer(LEC, "u1", Q, chosen, session_id="s1"))
    return out, events


def test_the_first_answer_is_a_first_try(monkeypatch):
    out, [(kind, data)] = _run(monkeypatch, FakeConn(prior=0), "b")
    assert out["correct"] is True
    assert kind == "quiz_attempt"
    assert data["slideId"] == str(SLIDE) and data["selectedAnswer"] == 1 and data["sessionId"] == "s1"
    assert data["source"] == "v4_practice" and data["timestamp"]


def test_a_later_answer_is_a_retry_that_remembers_the_first(monkeypatch):
    out, [(kind, data)] = _run(monkeypatch, FakeConn(prior=2, first_answer=0), "c")
    assert out["correct"] is False
    assert kind == "quiz_retry_attempt"
    assert data["reviewIndex"] == 2 and data["firstAttemptAnswer"] == 0 and data["selectedAnswer"] == 2
