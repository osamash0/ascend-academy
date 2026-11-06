"""Home's ask bar (POST /v4/ask): the course tutor answers in a Space you are in.

You are in a Space when you joined it or when you made it. Making one does not
enrol you (an owner holds no enrolment in their own Space), so the tutor's
own check must let an owner in by ownership, not by enrolment.
"""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v1 import v4_spaces
from backend.core.auth_middleware import verify_token
from backend.core.rate_limit import limiter
from backend.services import search_service

ME = "22222222-2222-4222-8222-222222222222"
OTHER = "44444444-4444-4444-8444-444444444444"
SPACE = "11111111-1111-4111-8111-111111111111"
LESSON = "33333333-3333-4333-8333-333333333333"


class _Conn:
    """The Home query's answer: the Spaces the viewer is in; no database."""

    def __init__(self, rows):
        self.rows = rows

    async def fetch(self, *a):
        return self.rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _Courses:
    """supabase_admin for the tutor's owner scope: courses.professor_id -> ids."""

    def __init__(self, owned):
        self.owned = owned
        self.filters = {}

    def table(self, name):
        assert name == "courses"
        self.filters = {}
        return self

    def select(self, *a):
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def execute(self):
        if self.filters.get("is_archived") is not False:
            return SimpleNamespace(data=[])
        ids = self.owned.get(self.filters.get("professor_id"), [])
        return SimpleNamespace(data=[{"id": i} for i in ids])


@pytest.fixture
def ask(monkeypatch):
    def make(rows, owned, enrolled):
        retrieved_in = []

        async def get_db_connection():
            return _Conn(rows)

        async def retrieve(question, course_ids, k, threshold):
            retrieved_in.append(course_ids)
            return []

        async def tutor(question, retrieved, **kw):
            return {
                "reply": "From your slides.",
                "grounded": True,
                "citations": [{"lecture_id": LESSON, "lecture_title": "Week 1", "slide_index": 2}],
            }

        monkeypatch.setattr(v4_spaces.service, "get_db_connection", get_db_connection)
        monkeypatch.setattr(search_service, "supabase_admin", _Courses(owned))
        monkeypatch.setattr(search_service, "_student_visible_course_ids", lambda uid: set(enrolled.get(uid, [])))
        monkeypatch.setattr(search_service, "retrieve_relevant_slides_course_scoped", retrieve)
        monkeypatch.setattr(search_service, "chat_with_course", tutor)
        app = FastAPI()
        app.state.limiter = limiter
        app.include_router(v4_spaces.router, prefix="/api/v1")
        app.dependency_overrides[verify_token] = lambda: {"id": ME}
        client = TestClient(app, raise_server_exceptions=False)
        res = client.post("/api/v1/v4/ask", json={"question": "What is a p-value?", "space_id": SPACE})
        return res, retrieved_in

    return make


def test_an_owner_asks_in_the_space_they_made_without_joining_it(ask):
    res, retrieved_in = ask(
        rows=[{"id": SPACE, "title": "Statistics", "last_read": None, "owned": True}],
        owned={ME: [SPACE]},
        enrolled={},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["spaceId"] == SPACE and body["spaceName"] == "Statistics"
    assert body["reply"] == "From your slides." and body["grounded"] is True
    assert body["citations"] == [{"lessonId": LESSON, "lessonTitle": "Week 1", "page": 3}]
    assert retrieved_in == [[SPACE]]


def test_a_member_still_asks_in_a_space_they_joined(ask):
    res, retrieved_in = ask(
        rows=[{"id": SPACE, "title": "Statistics", "last_read": None, "owned": False}],
        owned={OTHER: [SPACE]},
        enrolled={ME: [SPACE]},
    )
    assert res.status_code == 200
    assert res.json()["spaceId"] == SPACE
    assert retrieved_in == [[SPACE]]
