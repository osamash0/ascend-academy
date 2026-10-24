"""``generate_slide_title`` must be a real coroutine.

It used to be a sync lambda over ``process_slide_batch`` (a blocking provider
call) that both callers ``await``-ed — so ``/ai/suggest-title`` and
``/ai/slides/{id}/regenerate-title`` raised ``TypeError`` after stalling the
event loop. The endpoint tests never noticed because they patched the symbol
with an async fake.
"""
from __future__ import annotations

import inspect

import pytest

from backend.services.ai import orchestrator, tutor_service


@pytest.fixture
def stub_generate_text(monkeypatch):
    seen: list[dict] = []

    async def _fake(prompt, ai_model="cerebras", **kwargs):
        seen.append({"prompt": prompt, **kwargs})
        return '{"title": "Newton\'s three laws"}'

    monkeypatch.setattr(orchestrator, "generate_text", _fake)
    return seen


def test_generate_slide_title_is_a_coroutine_function():
    assert inspect.iscoroutinefunction(orchestrator.generate_slide_title)


async def test_orchestrator_title_comes_from_generate_text_json(stub_generate_text):
    title = await orchestrator.generate_slide_title("F = ma. Every action has a reaction.")
    assert title == "Newton's three laws"
    assert stub_generate_text[0]["json_mode"] is True
    assert "F = ma" in stub_generate_text[0]["prompt"]


async def test_tutor_service_wrapper_awaits_the_orchestrator(stub_generate_text):
    assert await tutor_service.generate_slide_title("some slide text") == "Newton's three laws"


async def test_unparseable_reply_falls_back_to_untitled(monkeypatch):
    async def _garbage(prompt, ai_model="cerebras", **kwargs):
        return "not json at all"

    monkeypatch.setattr(orchestrator, "generate_text", _garbage)
    assert await orchestrator.generate_slide_title("x") == "Untitled"
