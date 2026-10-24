# backend/tests/unit/test_v4_luna_api.py
"""The Luna router: auth, access, SSE framing, and errors mapped before streaming."""
from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v1 import v4_luna
from backend.core.auth_middleware import verify_token
from backend.core.rate_limit import limiter
from backend.services.luna import session_service as svc

U = "22222222-2222-2222-2222-222222222222"
L = "11111111-1111-1111-1111-111111111111"


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.state.limiter = limiter
    app.include_router(v4_luna.router, prefix="/api/v1")
    app.dependency_overrides[verify_token] = lambda: {"id": U}

    async def can_view(lecture_id, uid):
        return str(lecture_id) == L

    async def lang(uid):
        return "en"

    monkeypatch.setattr(v4_luna.reader, "can_view_lecture", can_view)
    monkeypatch.setattr(v4_luna.reader, "preferred_language", lang)
    return TestClient(app)


def test_start_needs_a_lecture_the_caller_can_view(client, monkeypatch):
    async def start(store, **kw):
        return {"session": {"id": "s1", "plan": []}, "say": "hi"}

    monkeypatch.setattr(v4_luna.service, "start", start)
    ok = client.post("/api/v1/v4/luna/sessions", json={"space_id": U, "lecture_id": L, "page": 3, "opener": "exam"})
    assert ok.status_code == 200 and ok.json()["say"] == "hi"
    other = client.post("/api/v1/v4/luna/sessions", json={"space_id": U, "lecture_id": str(uuid.uuid4()), "page": 3})
    assert other.status_code == 404


def test_turn_streams_server_sent_events(client, monkeypatch):
    async def open_turn(store, **kw):
        async def gen():
            yield "move", {"lecture_id": L, "page": 4}
            yield "say", {"md": "Look here."}
            yield "end", {"turn_count": 1, "offer_wrap": False}
        return gen()

    monkeypatch.setattr(v4_luna.service, "open_turn", open_turn)
    res = client.post(f"/api/v1/v4/luna/sessions/{uuid.uuid4()}/turn",
                      json={"client_turn_id": str(uuid.uuid4()), "action": "accept_plan", "reading_at": 4})
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/event-stream")
    assert res.text.split("\n\n")[:2] == [
        f'event: move\ndata: {{"lecture_id": "{L}", "page": 4}}',
        'event: say\ndata: {"md": "Look here."}',
    ]


def test_turn_errors_are_http_errors_before_the_stream(client, monkeypatch):
    async def open_turn(store, **kw):
        raise svc.LunaError(409, "Luna is still answering.")

    monkeypatch.setattr(v4_luna.service, "open_turn", open_turn)
    res = client.post(f"/api/v1/v4/luna/sessions/{uuid.uuid4()}/turn",
                      json={"client_turn_id": str(uuid.uuid4()), "text": "hi"})
    assert res.status_code == 409 and res.json()["detail"] == "Luna is still answering."


def test_turn_needs_words_or_an_action(client):
    res = client.post(f"/api/v1/v4/luna/sessions/{uuid.uuid4()}/turn", json={"client_turn_id": str(uuid.uuid4())})
    assert res.status_code == 422


def test_memory_edit_is_bounded(client, monkeypatch):
    class Store:
        async def edit_memory(self, user_id, memory_id, text):
            return {"id": memory_id, "kind": "preference", "space_id": None, "text": text, "active": True, "updated_at": None}

    monkeypatch.setattr(v4_luna, "_store", lambda: Store())
    mid = str(uuid.uuid4())
    assert client.patch(f"/api/v1/v4/luna/memory/{mid}", json={"text": "examples first"}).json()["text"] == "examples first"
    assert client.patch(f"/api/v1/v4/luna/memory/{mid}", json={"text": "x" * 81}).status_code == 422


def test_turn_stream_is_always_closed(client, monkeypatch):
    closed = []

    class Events:
        def __init__(self):
            self._items = iter([("say", {"md": "hi"}), ("end", {"turn_count": 1, "offer_wrap": False})])

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                return next(self._items)
            except StopIteration:
                raise StopAsyncIteration

        async def aclose(self):
            closed.append(True)

    async def open_turn(store, **kw):
        return Events()

    monkeypatch.setattr(v4_luna.service, "open_turn", open_turn)
    res = client.post(f"/api/v1/v4/luna/sessions/{uuid.uuid4()}/turn",
                      json={"client_turn_id": str(uuid.uuid4()), "text": "hi"})
    assert res.status_code == 200 and "event: say" in res.text
    assert closed == [True]
