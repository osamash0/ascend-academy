"""The reader's routes record help, check-ins and server-graded checkpoints."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v1 import v4_reader
from backend.core.auth_middleware import verify_token
from backend.core.rate_limit import limiter
import backend.services.v4_rehearsal_service as rehearsal
import backend.services.v4_teachback_service as teachback
import backend.services.v4_telemetry as tel

U = "22222222-2222-2222-2222-222222222222"
L = "11111111-1111-1111-1111-111111111111"
CP = {"idea": "Joins", "first": 4, "last": 9, "questions": [
    {"id": 1, "kind": "choice", "page": 9, "idea": "Joins",
     "options": [{"text": "natural"}, {"text": "equi", "correct": True}]},
]}


@pytest.fixture
def calls(monkeypatch):
    seen: dict[str, list] = {"help": [], "check_in": [], "checkpoint": []}

    async def can_view(lecture_id, uid):
        return str(lecture_id) == L

    async def lang(uid):
        return "en"

    async def help_(*a, **k):
        seen["help"].append(a)

    async def check_in(*a, **k):
        seen["check_in"].append(a)

    async def checkpoint(*a, **k):
        seen["checkpoint"].append((a, k))

    async def explain(*a, **k):
        return {"title": "t", "blocks": [], "cached": True}

    async def ask(*a, **k):
        return {"title": "t", "blocks": [], "cached": False}

    async def cached(lecture_id, first, last, locale):
        return CP if (first, last) == (4, 9) else None

    async def teach(*a, **k):
        return {"idea": "Joins", "first": 4, "last": 9, "verdict": "partial", "points": [], "wrong": [], "next": ""}

    monkeypatch.setattr(v4_reader.service, "can_view_lecture", can_view)
    monkeypatch.setattr(v4_reader.service, "preferred_language", lang)
    monkeypatch.setattr(v4_reader.service, "explain_page", explain)
    monkeypatch.setattr(v4_reader.service, "ask_page", ask)
    monkeypatch.setattr(tel, "record_help", help_)
    monkeypatch.setattr(tel, "record_check_in", check_in)
    monkeypatch.setattr(tel, "record_checkpoint", checkpoint)
    monkeypatch.setattr(rehearsal, "cached_checkpoint", cached)
    monkeypatch.setattr(teachback, "teach_back", teach)
    return seen


@pytest.fixture
def client(calls):
    app = FastAPI()
    app.state.limiter = limiter
    app.include_router(v4_reader.router, prefix="/api/v1")
    app.dependency_overrides[verify_token] = lambda: {"id": U}
    return TestClient(app)


def test_explain_and_ask_count_as_help_on_their_page(client, calls):
    assert client.post(f"/api/v1/v4/reader/lectures/{L}/pages/12/explain", json={"session_id": "s1"}).status_code == 200
    assert client.post(f"/api/v1/v4/reader/lectures/{L}/pages/12/explain", json={}).status_code == 200
    assert client.post(f"/api/v1/v4/reader/lectures/{L}/pages/12/ask",
                       json={"question": "Why BCNF?", "session_id": "s1"}).status_code == 200
    (_, uid, page, kind, query, session), (_, _, _, kind2, _, fresh), (_, _, _, kind3, q3, _) = calls["help"]
    assert (uid, page, kind, query, session) == (U, 12, "explain", "", "s1")
    assert kind2 == "explain" and fresh and fresh != "s1"
    assert (kind3, q3) == ("ask", "Why BCNF?")


def test_explain_left_open_while_turning_pages_is_not_help(client, calls):
    base = f"/api/v1/v4/reader/lectures/{L}/pages"
    assert client.post(f"{base}/13/explain", json={"session_id": "s1", "opened": False}).status_code == 200
    assert calls["help"] == []
    assert client.post(f"{base}/13/explain", json={"session_id": "s1", "opened": True}).status_code == 200
    [(_, uid, page, kind, _, session)] = calls["help"]
    assert (uid, page, kind, session) == (U, 13, "explain", "s1")


def test_a_checkpoint_answer_is_graded_and_recorded_here(client, calls):
    right = client.post(f"/api/v1/v4/reader/lectures/{L}/checkpoint/answer",
                        json={"first": 4, "last": 9, "question_id": 1, "answer": {"kind": "choice", "index": 1}, "session_id": "s1"})
    wrong = client.post(f"/api/v1/v4/reader/lectures/{L}/checkpoint/answer",
                        json={"first": 4, "last": 9, "question_id": 1, "answer": {"kind": "choice", "index": 0}})
    assert right.json() == {"correct": True} and wrong.json() == {"correct": False}
    (args, kw), _ = calls["checkpoint"]
    assert args[:2][1] == U and kw == {
        "page": 9, "idea": "Joins", "kind": "choice", "correct": True, "session_id": "s1", "question_id": 1,
    }


def test_an_expired_checkpoint_is_a_conflict_not_a_guess(client, calls):
    res = client.post(f"/api/v1/v4/reader/lectures/{L}/checkpoint/answer",
                      json={"first": 1, "last": 3, "question_id": 1, "answer": {"kind": "choice", "index": 1}})
    assert res.status_code == 409 and calls["checkpoint"] == []


def test_the_check_in_is_recorded_on_the_idea(client, calls):
    res = client.post(f"/api/v1/v4/reader/lectures/{L}/check-in",
                      json={"first": 4, "last": 9, "idea": "Joins", "rating": "confused", "session_id": "s1"})
    assert res.status_code == 204
    assert calls["check_in"] == [(rehearsal.UUID(L), U, 4, "Joins", "confused", "s1")]
    assert client.post(f"/api/v1/v4/reader/lectures/{L}/check-in",
                       json={"first": 4, "last": 9, "idea": "Joins", "rating": "meh"}).status_code == 422


def test_teach_back_records_its_verdict(client, calls):
    res = client.post(f"/api/v1/v4/reader/lectures/{L}/teach-back",
                      json={"first": 4, "last": 9, "idea": "Joins", "explanation": "A join pairs rows by a key.", "session_id": "s1"})
    assert res.status_code == 200
    [(args, kw)] = calls["checkpoint"]
    assert kw == {"page": 4, "idea": "Joins", "kind": "teach", "correct": False, "session_id": "s1"}
