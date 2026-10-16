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
