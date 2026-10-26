import asyncio

import pytest

from backend.services import v4_reader_service
from backend.services.luna import session_service as ss


class LLMBudgetExceededError(Exception):
    pass


def _run(monkeypatch, behaviours):
    calls = []

    async def fake(prompt, *, user_id, course_id, feature, prefer):
        calls.append(prefer)
        return await behaviours[prefer]()

    monkeypatch.setattr(v4_reader_service, "_generate_json", fake)
    monkeypatch.setattr(ss, "LUNA_ATTEMPT_SECONDS", 0.05)
    return calls


def _call():
    return ss.default_ai("p", user_id="u", course_id=None, feature="f")


async def test_hung_provider_falls_over(monkeypatch):
    async def hang():
        await asyncio.sleep(999)

    async def ok():
        return {"a": 1}

    calls = _run(monkeypatch, {"groq": hang, "openai": ok})
    assert await _call() == {"a": 1}
    assert calls == ["groq", "openai"]


async def test_budget_error_stops_immediately(monkeypatch):
    async def budget():
        raise LLMBudgetExceededError("x")

    async def ok():
        return {"a": 1}

    calls = _run(monkeypatch, {"groq": budget, "openai": ok, "gemini": ok})
    with pytest.raises(LLMBudgetExceededError):
        await _call()
    assert calls == ["groq"]


async def test_all_fail_raises_last(monkeypatch):
    def failing(name):
        async def f():
            raise RuntimeError(name)
        return f

    _run(monkeypatch, {p: failing(p) for p in ("gemini", "groq", "openai")})
    with pytest.raises(RuntimeError, match="gemini"):
        await _call()


async def test_non_dict_moves_on(monkeypatch):
    async def lst():
        return ["x"]

    async def ok():
        return {"b": 2}

    calls = _run(monkeypatch, {"groq": lst, "openai": ok})
    assert await _call() == {"b": 2}
    assert calls == ["groq", "openai"]


def test_gemini_goes_last_and_attempts_are_bounded_at_15s(monkeypatch):
    monkeypatch.delenv("LUNA_ATTEMPT_SECONDS", raising=False)
    assert ss.LUNA_PROVIDERS == ("groq", "openai", "gemini")
    assert ss._attempt_seconds() == 15.0
