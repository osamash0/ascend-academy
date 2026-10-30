"""Person-level views: off by default, and when on, a person is someone else in every Space."""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.services.v4_landing_service as service
from backend.api.v1 import v4_landing
from backend.core.auth_middleware import verify_token
from backend.core.config import settings
from backend.core.rate_limit import limiter
from backend.services.insights.people import journey, strugglers
from backend.services.insights.sources.space import Event, LessonRow, SpaceData
from backend.services.utils.analytics_utils import space_pseudonym

OWNER = "11111111-1111-1111-1111-111111111111"
SPACE = uuid.UUID("33333333-3333-3333-3333-333333333333")
LESSON = "55555555-5555-5555-5555-555555555555"
NOW = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
SALT = "a-test-salt-that-is-long-enough-0123456789"  # the route wants at least 32 characters
UIDS = [f"00000000-0000-0000-0000-00000000000{i}" for i in range(6)]
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def _data():
    events = []
    for i, u in enumerate(UIDS):
        pages = 1 if i == 0 else 6  # one reader barely started
        for page in range(1, pages + 1):
            events.append(Event(u, "slide_view", {"lectureId": LESSON, "page": page, "duration_seconds": 30,
                                                   "sessionId": u}, NOW - timedelta(days=1)))
        events.append(Event(u, "checkpoint_attempt", {"lectureId": LESSON, "page": 1, "idea": "J", "kind": "choice",
                                                      "questionId": 1, "correct": i != 0}, NOW - timedelta(days=1)))
    return SpaceData(str(SPACE), "DBS", OWNER, frozenset(UIDS), (LessonRow(LESSON, "N", 1, 6),), tuple(events),
                     {}, {}, NOW)


def test_a_person_is_someone_else_in_every_space_and_never_their_account():
    a = space_pseudonym(UIDS[0], "space-a", SALT)
    assert a == space_pseudonym(UIDS[0], "space-a", SALT)
    assert a != space_pseudonym(UIDS[0], "space-b", SALT)
    assert a != space_pseudonym(UIDS[0], "space-a", "other-salt")
    assert re.fullmatch(r"p_[0-9a-f]{16}", a[0]) and UIDS[0] not in a[0] + a[1]


def test_strugglers_and_a_journey_carry_pseudonyms_only():
    data = _data()
    found = strugglers(data, SALT)
    assert found and not UUID_RE.search(json.dumps(found))
    person = space_pseudonym(UIDS[0], str(SPACE), SALT)[0]
    steps = journey(data, SALT, person, LESSON)
    assert steps[0] == {"page": 1, "seconds": 30, "foggy": None, "firstTry": False, "help": False}
    assert len(steps) == 6 and journey(data, SALT, "p_0000000000000000", LESSON) is None


@pytest.fixture
def client(monkeypatch):
    async def row(space_id, uid):
        return {"id": space_id, "title": "DBS", "professor_id": uuid.UUID(OWNER), "is_member": False}

    async def load(space_id, name, owner_id, **kw):
        return _data()

    monkeypatch.setattr(service, "space_row", row)
    monkeypatch.setattr(service, "load_space_data", load)
    app = FastAPI()
    app.state.limiter = limiter
    app.include_router(v4_landing.router, prefix="/api/v1")
    app.dependency_overrides[verify_token] = lambda: {"id": OWNER}
    return TestClient(app)


def test_off_by_default_even_for_the_owner(client, monkeypatch):
    monkeypatch.setattr(settings, "feature_landing_people", False)
    assert client.get(f"/api/v1/v4/spaces/{SPACE}/landing/people").status_code == 404
    monkeypatch.setattr(settings, "feature_landing_people", True)
    monkeypatch.setattr(settings, "landing_pseudonym_salt", "")
    assert client.get(f"/api/v1/v4/spaces/{SPACE}/landing/people").status_code == 404


def test_when_on_the_owner_sees_pseudonyms_and_can_follow_one(client, monkeypatch):
    monkeypatch.setattr(settings, "feature_landing_people", True)
    monkeypatch.setattr(settings, "landing_pseudonym_salt", SALT)
    body = client.get(f"/api/v1/v4/spaces/{SPACE}/landing/people").json()
    assert body["strugglers"] and not UUID_RE.search(json.dumps(body))
    person = body["strugglers"][0]["id"]
    steps = client.get(f"/api/v1/v4/spaces/{SPACE}/landing/people/{person}/journey?lesson={LESSON}")
    assert steps.status_code == 200 and steps.json()["steps"][0]["page"] == 1


def test_off_means_not_here_even_for_a_request_that_would_not_validate(client, monkeypatch):
    """No 422 that gives the route away: the flag is decided before the path and query are."""
    monkeypatch.setattr(settings, "feature_landing_people", False)
    monkeypatch.setattr(settings, "landing_pseudonym_salt", SALT)
    assert client.get(f"/api/v1/v4/spaces/{SPACE}/landing/people/p_0000000000000000/journey").status_code == 404
    assert client.get(f"/api/v1/v4/spaces/{SPACE}/landing/people/not-a-person/journey?lesson=x").status_code == 404
    assert client.get("/api/v1/v4/spaces/not-a-space/landing/people").status_code == 404


def test_only_the_owner_follows_people_and_an_unknown_one_is_not_found(client, monkeypatch):
    monkeypatch.setattr(settings, "feature_landing_people", True)
    monkeypatch.setattr(settings, "landing_pseudonym_salt", SALT)
    known = space_pseudonym(UIDS[0], str(SPACE), SALT)[0]
    base = f"/api/v1/v4/spaces/{SPACE}/landing/people"
    assert client.get(f"{base}/p_0000000000000000/journey?lesson={LESSON}").status_code == 404
    assert client.get(f"{base}/{known}/journey?lesson={uuid.uuid4()}").status_code == 404

    async def as_member(space_id, uid):
        return {"id": space_id, "title": "DBS", "professor_id": uuid.UUID(OWNER), "is_member": True}

    monkeypatch.setattr(service, "space_row", as_member)
    client.app.dependency_overrides[verify_token] = lambda: {"id": UIDS[0]}
    assert client.get(base).status_code == 403
    assert client.get(f"{base}/{known}/journey?lesson={LESSON}").status_code == 403


def _with(data, events=None, lessons=None):
    return SpaceData(data.space_id, data.name, data.owner_id, data.members, lessons or data.lessons,
                     data.events if events is None else tuple(events), {}, {}, data.now)


def test_nobody_is_named_and_no_one_followed_while_too_few_people_have_read(client, monkeypatch):
    data = _data()
    few = _with(data, [e for e in data.events if e.user_id in UIDS[:4]])
    person = space_pseudonym(UIDS[1], str(SPACE), SALT)[0]
    assert journey(data, SALT, person, LESSON) is not None
    assert strugglers(few, SALT) == []
    assert journey(few, SALT, person, LESSON) is None

    async def load(space_id, name, owner_id, **kw):
        return few

    monkeypatch.setattr(service, "load_space_data", load)
    monkeypatch.setattr(settings, "feature_landing_people", True)
    monkeypatch.setattr(settings, "landing_pseudonym_salt", SALT)
    base = f"/api/v1/v4/spaces/{SPACE}/landing/people"
    assert client.get(base).json() == {"strugglers": []}
    assert client.get(f"{base}/{person}/journey?lesson={LESSON}").status_code == 404


def test_a_page_a_member_invents_does_not_stretch_a_lesson():
    data = _data()
    forged = Event(UIDS[1], "slide_view", {"lectureId": LESSON, "page": 2000, "duration_seconds": 30,
                                           "sessionId": "x"}, NOW)
    stretched = _with(data, data.events + (forged,))
    person = space_pseudonym(UIDS[1], str(SPACE), SALT)[0]
    assert strugglers(stretched, SALT) == strugglers(data, SALT)
    assert len(journey(stretched, SALT, person, LESSON)) == 6
    # a Lesson whose length is not known falls back to the highest page seen, as the Landing does
    unknown = _with(data, data.events, (LessonRow(LESSON, "N", 1, 0),))
    assert len(journey(unknown, SALT, person, LESSON)) == 6


def _everyone_reads(pages, questions):
    events = [Event(u, "slide_view", {"lectureId": LESSON, "page": page, "duration_seconds": 30, "sessionId": u},
                    NOW - timedelta(days=1)) for u in UIDS for page in range(1, pages + 1)]
    if questions:
        events += [Event(UIDS[0], "checkpoint_attempt", {"lectureId": LESSON, "page": 1, "idea": "J", "kind": "choice",
                                                         "questionId": 1, "correct": False}, NOW - timedelta(days=1))]
    return events


def test_reading_everything_is_not_struggling_just_because_no_question_was_tried():
    data = _data()
    assert strugglers(_with(data, _everyone_reads(6, questions=False)), SALT) == []


def test_someone_who_barely_read_and_tried_nothing_is_listed_without_a_score():
    data = _data()
    events = [e for e in _everyone_reads(6, questions=False) if e.user_id != UIDS[0] or e.data["page"] == 1]
    found = strugglers(_with(data, events), SALT)
    assert [(p["progress"], p["firstTry"], p["help"]) for p in found] == [(17, None, 0)]
    # a person who did try keeps their own first-try figure
    events += [Event(UIDS[0], "checkpoint_attempt", {"lectureId": LESSON, "page": 1, "idea": "J", "kind": "choice",
                                                     "questionId": 1, "correct": False}, NOW)]
    assert [p["firstTry"] for p in strugglers(_with(data, events), SALT)] == [0]


def test_a_salt_that_is_short_is_no_salt(client, monkeypatch):
    monkeypatch.setattr(settings, "feature_landing_people", True)
    monkeypatch.setattr(settings, "landing_pseudonym_salt", SALT[:31])
    assert client.get(f"/api/v1/v4/spaces/{SPACE}/landing/people").status_code == 404
    monkeypatch.setattr(settings, "landing_pseudonym_salt", SALT[:32])
    assert client.get(f"/api/v1/v4/spaces/{SPACE}/landing/people").status_code == 200


def test_a_forged_reading_time_does_not_count_and_does_not_break_the_journey():
    data = _data()
    forged = [Event(UIDS[1], "slide_view", {"lectureId": LESSON, "page": 2, "duration_seconds": v,
                                             "sessionId": "x"}, NOW) for v in ("soon", True, -5, None, [3])]
    data = SpaceData(data.space_id, data.name, data.owner_id, data.members, data.lessons,
                     data.events + tuple(forged), {}, {}, data.now)
    person = space_pseudonym(UIDS[1], str(SPACE), SALT)[0]
    assert [s["seconds"] for s in journey(data, SALT, person, LESSON)] == [30] * 6
