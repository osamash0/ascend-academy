"""The language a reader request is answered in: the app's (?lang=), else the profile's."""
import asyncio


class _Req:
    def __init__(self, lang=None):
        self.query_params = {} if lang is None else {"lang": lang}


def test_the_app_language_wins_and_anything_else_falls_back_to_the_profile(monkeypatch):
    import backend.api.v1.v4_reader as api

    async def profile(uid):
        return "en"

    monkeypatch.setattr(api.service, "preferred_language", profile)
    assert asyncio.run(api._lang(_Req("de"), "u")) == "de"
    assert asyncio.run(api._lang(_Req(), "u")) == "en"
    assert asyncio.run(api._lang(_Req("fr"), "u")) == "en"
    assert asyncio.run(api._lang(_Req("de'; drop"), "u")) == "en"


def test_practice_passes_the_requested_language_after_checking_access(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    import backend.api.v1.v4_reader as api
    from backend.core.auth_middleware import verify_token
    from backend.services import v4_practice_service as practice

    seen = []

    async def access(lecture_id, user):
        seen.append("access")
        return "u"

    async def questions(lecture_id, *, locale):
        seen.append(locale)
        return []

    monkeypatch.setattr(api, "_lecture_access", access)
    monkeypatch.setattr(practice, "questions_for", questions)
    app = FastAPI()
    app.state.limiter = api.limiter
    app.include_router(api.router)
    app.dependency_overrides[verify_token] = lambda: {"id": "u"}
    response = TestClient(app).get('/v4/reader/lectures/11111111-1111-1111-1111-111111111111/practice?lang=de')
    assert response.status_code == 200 and response.json() == {"questions": []}
    assert seen == ["access", "de"]
