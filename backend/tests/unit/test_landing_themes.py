"""Themes: up to three, only where five or more people asked, metered to the owner, never a question verbatim."""
from __future__ import annotations

import asyncio

import pytest

import backend.services.insights.themes as themes
import backend.services.v4_reader_service as reader

ASKED = ["Why does the BCNF split lose a dependency?", "Is losing it the point?", "What is 3NF for?"]


@pytest.fixture
def model(monkeypatch):
    calls: list[dict] = []
    reply = {"value": {"themes": ["Why a split can lose a dependency", "What 3NF is for"]}}

    async def generate(prompt, **kw):
        calls.append({"prompt": prompt, **kw})
        if isinstance(reply["value"], Exception):
            raise reply["value"]
        return reply["value"]

    async def passthrough(key, view, compute, **kw):
        calls.append({"cache": (key, view, kw["params"])})
        return await compute()

    monkeypatch.setattr(reader, "_generate_json", generate)
    monkeypatch.setattr(themes.analytics_cache, "get_or_compute_async", passthrough)
    return calls, reply


def run(**over):
    args = dict(space_id="s1", owner_id="o1", lesson_id="l1", page=12, texts=ASKED, askers=6, lang="de")
    return asyncio.run(themes.themes_for(**{**args, **over}))


def test_themes_are_made_metered_to_the_owner_and_cached_per_number_of_askers(model):
    calls, _ = model
    assert run() == ["Why a split can lose a dependency", "What 3NF is for"]
    cache, call = calls
    assert cache["cache"] == ("s1", "themes", {"lesson": "l1", "page": 12, "askers": 6, "lang": "de", "v": "themes-v1"})
    assert (call["user_id"], call["course_id"], call["feature"], call["prefer"]) == ("o1", "s1", "v4_landing_themes", "openai")
    assert "German" in call["prompt"] and ASKED[0] in call["prompt"]


def test_fewer_than_five_askers_get_no_themes_and_no_model_call(model):
    calls, _ = model
    assert run(askers=4) == []
    assert calls == []


def test_a_failed_call_costs_the_owner_nothing_and_is_not_kept(model):
    calls, reply = model
    reply["value"] = RuntimeError("You have reached this month's AI allowance.")
    assert run() == []
    reply["value"] = {"themes": ["What 3NF is for"]}
    assert run() == ["What 3NF is for"]


def test_a_theme_that_repeats_a_question_is_dropped_and_three_is_the_most():
    out = themes.clean_themes({"themes": [ASKED[1], "  A  ", "B", "C", "D", 7]}, ASKED)
    assert out == ["A", "B", "C"]
    assert themes.clean_themes(["not", "a", "dict"], ASKED) == []
