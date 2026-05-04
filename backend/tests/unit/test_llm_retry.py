"""Unit tests for backend.domain.llm._with_retry."""
import pytest

from backend.domain import llm


def test_returns_value_on_success():
    assert llm._with_retry(lambda: 42) == 42


def test_retries_on_rate_limit_then_succeeds(monkeypatch):
    sleeps: list[float] = []
    monkeypatch.setattr(llm.time, "sleep", lambda d: sleeps.append(d))

    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 2:
            raise RuntimeError("429 rate_limit exceeded")
        return "ok"

    assert llm._with_retry(flaky) == "ok"
    assert calls["n"] == 2
    assert sleeps == [2.0]


def test_does_not_retry_other_errors():
    def boom():
        raise ValueError("boom")

    with pytest.raises(ValueError):
        llm._with_retry(boom, max_attempts=3)


def test_gives_up_after_max_attempts(monkeypatch):
    monkeypatch.setattr(llm.time, "sleep", lambda d: None)

    def always_429():
        raise RuntimeError("rate limit hit")

    with pytest.raises(RuntimeError):
        llm._with_retry(always_429, max_attempts=2)


def test_parse_json_with_code_fence():
    out = llm._parse_json('```json\n{"x": 1}\n```')
    assert out == {"x": 1}


def test_parse_json_with_prose_around():
    out = llm._parse_json('Sure, here you go: {"a": [1, 2]} thanks.')
    assert out == {"a": [1, 2]}


def test_parse_json_plain():
    out = llm._parse_json('{"k":"v"}')
    assert out == {"k": "v"}
