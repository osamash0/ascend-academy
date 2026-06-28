"""Unit tests for parser-version routing in upload_service.process_pdf_stream.

This is the live upload entrypoint and the highest-churn code (the unified v5
branch was ported in during the v1 restructure). The risk is routing to the
wrong pipeline or — the bug fixed in that merge — failing to thread user_id into
the server-authoritative unified parser (which needs it to own the lecture).

We force the Redis-down *sync* fallback (get_arq_pool raises) and replace the
orchestrators with fakes that just emit a `complete` event, so no real parsing /
Arq / Redis runs. We assert which orchestrator was invoked and with what args.
"""
from __future__ import annotations

import pytest

from backend.core.config import settings
from backend.services import upload_service
from backend.services.parser import unified_orchestrator, v4_orchestrator


async def _drain(agen, limit=50):
    chunks = []
    async for c in agen:
        chunks.append(c)
        if len(chunks) >= limit:
            break
    return chunks


@pytest.fixture
def routing(monkeypatch):
    """Force the sync fallback and capture which orchestrator ran + its kwargs."""
    calls: dict = {}

    async def _no_storage(*_a, **_k):
        return None

    async def _arq_down(*_a, **_k):
        raise RuntimeError("redis down")  # forces use_arq = False

    def _fake(name):
        async def _fn(*_a, emit_fn=None, **kwargs):
            calls[name] = kwargs
            await emit_fn("complete", {"total": 1})
        return _fn

    monkeypatch.setattr(upload_service, "upload_pdf_to_storage", _no_storage)
    monkeypatch.setattr(upload_service, "get_arq_pool", _arq_down)
    monkeypatch.setattr(unified_orchestrator, "parse_pdf_unified", _fake("unified"))
    monkeypatch.setattr(v4_orchestrator, "parse_pdf_v4", _fake("v4"))
    return calls


async def _run(parser="auto", user_id="prof-1"):
    return await _drain(upload_service.process_pdf_stream(
        content=b"%PDF-1.4 fake",
        filename="lecture.pdf",
        pdf_hash="h" * 64,
        page_count=3,
        ai_model="cerebras",
        use_blueprint=False,
        parsing_mode="ai",
        parser=parser,
        lecture_id=None,
        user_id=user_id,
    ))


async def test_v5_routes_to_unified_and_threads_user_id(routing, monkeypatch):
    monkeypatch.setattr(settings, "parser_version", "5", raising=False)
    chunks = await _run(parser="auto", user_id="prof-42")

    assert "unified" in routing and "v4" not in routing      # unified, not v4
    assert routing["unified"]["user_id"] == "prof-42"          # the merge bug-fix
    assert routing["unified"]["filename"] == "lecture.pdf"
    assert any("complete" in c for c in chunks)                # the event was streamed


async def test_v5_unified_uses_server_configured_model(routing, monkeypatch):
    monkeypatch.setattr(settings, "parser_version", "5", raising=False)
    monkeypatch.setattr(settings, "parser_llm_model", "server-llm", raising=False)
    await _run(parser="auto")
    # ai_model is the server-configured PARSER_LLM_MODEL, not the request's "cerebras".
    assert routing["unified"]["ai_model"] == "server-llm"


async def test_v4_routes_to_v4_orchestrator_not_unified(routing, monkeypatch):
    monkeypatch.setattr(settings, "parser_version", "4", raising=False)
    await _run(parser="auto")
    assert "v4" in routing and "unified" not in routing


async def test_parser_unified_forces_unified_even_at_version_4(routing, monkeypatch):
    monkeypatch.setattr(settings, "parser_version", "4", raising=False)
    await _run(parser="unified")
    assert "unified" in routing and "v4" not in routing
