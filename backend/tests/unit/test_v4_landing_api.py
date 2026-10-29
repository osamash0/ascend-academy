"""The owner's view of a Space: who may open it, and what it says."""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.services.v4_landing_service as service
from backend.api.v1 import v4_landing
from backend.core.auth_middleware import verify_token
from backend.core.rate_limit import limiter
from backend.services.insights.sources.space import Event, LessonRow, SpaceData

OWNER = "11111111-1111-1111-1111-111111111111"
SPACE = uuid.UUID("33333333-3333-3333-3333-333333333333")
MEMBER = "22222222-2222-2222-2222-222222222222"
STRANGER = "44444444-4444-4444-4444-444444444444"
NOW = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
L1, L2 = "l-normalization", "l-joins"
ASKED = "Why does the BCNF split lose a dependency?"


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


def _events():
    out = []
    for i in range(10):
        u = f"m{i}"
        for page in (1, 2, 3, 4):
            out.append(Event(u, "slide_view", {"lectureId": L1, "page": page, "duration_seconds": 40, "sessionId": u},
                             NOW - timedelta(days=1)))
        rating = "confused" if i < 8 else "got_it"
        out.append(Event(u, "confidence_rating", {"lectureId": L1, "page": 3, "rating": rating}, NOW - timedelta(days=1)))
        if i < 7:
            out.append(Event(u, "ai_tutor_query", {"lectureId": L1, "page": 3, "kind": "ask", "query": f"{ASKED} {i}"},
                             NOW - timedelta(days=1)))
    for i in range(3):  # Joins: three readers, under the floor
        out.append(Event(f"m{i}", "slide_view", {"lectureId": L2, "page": 1, "duration_seconds": 40, "sessionId": "x"},
                         NOW - timedelta(days=1)))
    return tuple(out)


def _data(events=None):
    return SpaceData(
        space_id=str(SPACE), name="Database Systems", owner_id=OWNER,
        members=frozenset(f"m{i}" for i in range(12)),
        lessons=(LessonRow(L1, "Normalization", 1, 4), LessonRow(L2, "Joins", 2, 6)),
        events=_events() if events is None else events, slide_pages={}, question_pages={}, now=NOW,
    )


@pytest.fixture
def client(monkeypatch):
    async def row(space_id, uid):
        if uid == STRANGER:
            return {"id": space_id, "title": "Database Systems", "professor_id": uuid.UUID(OWNER), "is_member": False}
        return {"id": space_id, "title": "Database Systems", "professor_id": uuid.UUID(OWNER), "is_member": uid == MEMBER}

    async def load(space_id, name, owner_id, **kw):
        return _data()

    async def passthrough(key, view, compute, **kw):
        return await compute()

    async def model(prompt, **kw):
        return {"themes": ["Why a split can lose a dependency"]}

    import backend.services.v4_reader_service as reader

    monkeypatch.setattr(service, "space_row", row)
    monkeypatch.setattr(service, "load_space_data", load)
    monkeypatch.setattr(service.analytics_cache, "get_or_compute_async", passthrough)
    monkeypatch.setattr(reader, "_generate_json", model)

    who = {"id": OWNER}
    app = FastAPI()
    app.state.limiter = limiter
    app.include_router(v4_landing.router, prefix="/api/v1")
    app.dependency_overrides[verify_token] = lambda: who
    c = TestClient(app)
    c.who = who
    return c


def test_only_the_owner_opens_it_a_member_is_told_a_stranger_learns_nothing(client):
    url = f"/api/v1/v4/spaces/{SPACE}/landing"
    assert client.get(url).status_code == 200
    client.who["id"] = MEMBER
    assert client.get(url).status_code == 403
    client.who["id"] = STRANGER
    assert client.get(url).status_code == 404


def test_the_owner_sees_the_space_in_aggregate_and_never_a_question(client):
    body = client.get(f"/api/v1/v4/spaces/{SPACE}/landing?lang=en").json()
    assert (body["spaceName"], body["members"], body["readers"], body["floor"]) == ("Database Systems", 12, 10, 5)
    assert body["questions"] == []
    normalization, joins = body["lessons"]
    assert (normalization["order"], normalization["readers"], len(normalization["help"])) == (1, 10, 4)
    assert normalization["help"][2] == 1.0
    assert (joins["light"], "help" in joins) == ("few", False)
    top = body["insights"][0]
    assert (top["kind"], top["lessonId"], top["page"], top["themes"]) == ("confusion_hotspot", L1, 3, True)
    assert top["metrics"] == {"askers": 7, "foggy": 80}
    assert body["themes"] == [{"lessonId": L1, "page": 3, "askers": 7, "themes": ["Why a split can lose a dependency"]}]
    assert ASKED not in json.dumps(body)
    assert all(i["lessonId"] != L2 for i in body["insights"])


def test_under_the_spaces_floor_it_says_so_with_no_findings_and_no_light(monkeypatch):
    few = tuple(e for e in _events() if e.user_id in {"m0", "m1", "m2", "m3"})
    body = asyncio.run(service.landing_from(_data(few), "en"))
    assert body["readers"] == 4 and body["insights"] == [] and body["themes"] == []
    assert {l["light"] for l in body["lessons"]} == {"few"}
    assert all("help" not in l for l in body["lessons"])
    assert body["figures"]["landing"] == {"value": 0, "history": []}


def test_a_finding_beyond_the_lessons_last_page_is_dropped_but_not_when_its_pages_are_unknown():
    # Events are members' own inserts: ten of them can claim to be foggy on pages a Lesson does not have.
    def foggy_through_page_nine(lesson):
        out = []
        for i in range(10):
            u = f"m{i}"
            for page in range(1, 10):
                out.append(Event(u, "slide_view", {"lectureId": lesson, "page": page, "duration_seconds": 40, "sessionId": u},
                                 NOW - timedelta(days=1)))
            for page in range(3, 10):
                rating = "confused" if i < 8 else "got_it"
                out.append(Event(u, "confidence_rating", {"lectureId": lesson, "page": page, "rating": rating},
                                 NOW - timedelta(days=1)))
        return out

    data = SpaceData(
        space_id=str(SPACE), name="Database Systems", owner_id=OWNER,
        members=frozenset(f"m{i}" for i in range(10)),
        lessons=(LessonRow("has-four-pages", "Four", 1, 4), LessonRow("pages-unknown", "Unknown", 2, 0)),
        events=tuple(foggy_through_page_nine("has-four-pages") + foggy_through_page_nine("pages-unknown")),
        slide_pages={}, question_pages={}, now=NOW,
    )
    body = asyncio.run(service.landing_from(data, "en"))

    def about(lesson):
        return sorted((i["kind"], i.get("page", i.get("last"))) for i in body["insights"] if i["lessonId"] == lesson)

    assert about("has-four-pages") == [("confusion_hotspot", 3), ("confusion_hotspot", 4)]
    assert ("confusion_hotspot", 9) in about("pages-unknown") and ("confusion_block", 9) in about("pages-unknown")
