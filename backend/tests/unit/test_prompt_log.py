"""Unit tests for flag-gated prompt/response logging (Roadmap P1-3).

Pins: logging is a no-op unless settings.feature_llm_prompt_logging is on
(the default) — a bad-output report can't be replayed unless logging was
deliberately enabled; when on, a logged pair round-trips through
get_logged_prompt_response with the configured TTL.
"""
from __future__ import annotations

import json

import pytest

from backend.core.config import settings
from backend.services.ai import prompt_log


class FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    async def setex(self, key: str, ttl: int, value: str) -> None:
        self.store[key] = value
        self.ttls[key] = ttl

    async def get(self, key: str):
        return self.store.get(key)


@pytest.mark.asyncio
async def test_log_prompt_response_is_noop_when_flag_disabled(monkeypatch):
    monkeypatch.setattr(settings, "feature_llm_prompt_logging", False)
    monkeypatch.setattr(prompt_log, "_get_redis_or_none", lambda: (_ for _ in ()).throw(
        AssertionError("must not touch redis when flag is off")
    ))
    log_id = await prompt_log.log_prompt_response("test_feature", "prompt", "response")
    assert log_id is None


@pytest.mark.asyncio
async def test_log_prompt_response_fails_open_when_redis_unavailable(monkeypatch):
    monkeypatch.setattr(settings, "feature_llm_prompt_logging", True)
    monkeypatch.setattr(prompt_log, "_get_redis_or_none", lambda: None)
    log_id = await prompt_log.log_prompt_response("test_feature", "prompt", "response")
    assert log_id is None


@pytest.mark.asyncio
async def test_log_and_replay_round_trip(monkeypatch):
    monkeypatch.setattr(settings, "feature_llm_prompt_logging", True)
    monkeypatch.setattr(settings, "llm_prompt_log_ttl_seconds", 3600)
    redis = FakeRedis()
    monkeypatch.setattr(prompt_log, "_get_redis_or_none", lambda: redis)

    log_id = await prompt_log.log_prompt_response("ask_professor_chat", "what is TCP?", "TCP is...")
    assert log_id is not None

    key = prompt_log._log_key(log_id)
    assert redis.ttls[key] == 3600
    stored = json.loads(redis.store[key])
    assert stored == {"feature": "ask_professor_chat", "prompt": "what is TCP?", "response": "TCP is..."}

    replayed = await prompt_log.get_logged_prompt_response(log_id)
    assert replayed == stored


@pytest.mark.asyncio
async def test_replay_missing_log_id_returns_none(monkeypatch):
    monkeypatch.setattr(prompt_log, "_get_redis_or_none", lambda: FakeRedis())
    assert await prompt_log.get_logged_prompt_response("does-not-exist") is None
