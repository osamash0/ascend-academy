"""Every provider call must leave an accounting trace (audit ARCH-F-3).

Gemini embeddings — every embedding in the default `multi` provider mode —
wrote no `llm_calls` row and no metrics, so cost dashboards and the parse
receipt could not see them.
"""
from __future__ import annotations

from backend.services.ai import embeddings, orchestrator


async def test_gemini_embeddings_are_accounted_for(monkeypatch):
    monkeypatch.setattr(embeddings, "OPENAI_ONLY", False)
    monkeypatch.setattr(embeddings, "_sync_generate_embeddings", lambda text: [0.1] * 768)
    seen = []

    async def _record(provider_id, model, usage, **kwargs):
        seen.append((provider_id, model, kwargs.get("feature")))

    monkeypatch.setattr(orchestrator, "_account_for_call", _record)

    values = await embeddings.generate_embeddings("some slide text")

    assert len(values) == 768
    assert seen == [("gemini", embeddings.GEMINI_EMBEDDING_MODEL, "embedding")]
