"""Unit tests for parser routing in upload_service.process_pdf_stream.

This is the live upload entrypoint. As of the Phase-0 legacy sweep the unified
(v5) pipeline is the ONLY parse path: every upload routes to parse_pdf_unified
regardless of PARSER_VERSION, and a retired version just logs a warning. The
risks worth guarding: routing anywhere other than unified, and — the bug fixed
in the v1 restructure — failing to thread user_id into the server-authoritative
unified parser (which needs it to own the lecture).

We force the Redis-down *sync* fallback (get_arq_pool raises) and replace the
orchestrator with a fake that just emits a `complete` event, so no real parsing /
Arq / Redis runs. We assert the orchestrator was invoked and with what args.

The in-process sync fallback only runs in the development environment (in prod a
queue outage fails loudly instead of parsing inside the API event loop), so the
fixture pins ``settings.env = "development"`` to keep using it as the test vehicle.
"""
from __future__ import annotations

import pytest

from backend.core.config import settings
from backend.services import upload_service
from backend.services.parser import unified_orchestrator


async def _drain(agen, limit=50):
    chunks = []
    async for c in agen:
        chunks.append(c)
        if len(chunks) >= limit:
            break
    return chunks


@pytest.fixture
def routing(monkeypatch):
    """Force the sync fallback and capture the unified orchestrator's kwargs."""
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

    # The in-process fallback is dev-only; pin the env so the sync-fallback
    # vehicle this fixture relies on stays active regardless of .env.
    monkeypatch.setattr(settings, "env", "development", raising=False)
    monkeypatch.setattr(upload_service, "upload_pdf_to_storage", _no_storage)
    monkeypatch.setattr(upload_service, "get_arq_pool", _arq_down)
    monkeypatch.setattr(unified_orchestrator, "parse_pdf_unified", _fake("unified"))
    return calls


async def _run(parser="auto", user_id="prof-1", ai_model="cerebras"):
    return await _drain(upload_service.process_pdf_stream(
        content=b"%PDF-1.4 fake",
        filename="lecture.pdf",
        pdf_hash="h" * 64,
        page_count=3,
        ai_model=ai_model,
        use_blueprint=False,
        parsing_mode="ai",
        parser=parser,
        lecture_id=None,
        user_id=user_id,
    ))


async def test_routes_to_unified_and_threads_user_id(routing, monkeypatch):
    monkeypatch.setattr(settings, "parser_version", "5", raising=False)
    chunks = await _run(parser="auto", user_id="prof-42")

    assert "unified" in routing
    assert routing["unified"]["user_id"] == "prof-42"          # the merge bug-fix
    assert routing["unified"]["filename"] == "lecture.pdf"
    assert any("complete" in c for c in chunks)                # the event was streamed


async def test_unified_uses_server_configured_model_when_auto(routing, monkeypatch):
    monkeypatch.setattr(settings, "parser_version", "5", raising=False)
    monkeypatch.setattr(settings, "parser_llm_model", "server-llm", raising=False)
    # An explicit request model wins; "auto" defers to the server-configured model.
    await _run(parser="auto", ai_model="auto")
    assert routing["unified"]["ai_model"] == "server-llm"


async def test_explicit_request_model_overrides_server_default(routing, monkeypatch):
    monkeypatch.setattr(settings, "parser_version", "5", raising=False)
    monkeypatch.setattr(settings, "parser_llm_model", "server-llm", raising=False)
    await _run(parser="auto", ai_model="cerebras")
    assert routing["unified"]["ai_model"] == "cerebras"


async def test_retired_parser_version_still_routes_to_unified(routing, monkeypatch):
    """A retired PARSER_VERSION logs a warning but runs the unified pipeline."""
    monkeypatch.setattr(settings, "parser_version", "4", raising=False)
    await _run(parser="auto")
    assert "unified" in routing


async def test_explicit_legacy_parser_name_routes_to_unified(routing, monkeypatch):
    monkeypatch.setattr(settings, "parser_version", "5", raising=False)
    await _run(parser="v4")
    assert "unified" in routing
