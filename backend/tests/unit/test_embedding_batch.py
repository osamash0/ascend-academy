"""Arc 8: batched embedding call for the semantic grounding eval. The Gemini
client is faked; nothing leaves the process."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.services.ai import embeddings as emb_mod


class _Models:
    def __init__(self, dims=None, drop=0):
        self.dims = dims or emb_mod.EMBEDDING_DIMS
        self.drop = drop
        self.calls: list = []

    def embed_content(self, model, contents, config=None):
        self.calls.append(contents)
        texts = [contents] if isinstance(contents, str) else list(contents)
        texts = texts[: len(texts) - self.drop]
        # First component encodes the text's numeric suffix so order is checkable.
        out = [
            SimpleNamespace(values=[float(t.split("-")[1]) + 1.0] + [0.5] * (self.dims - 1))
            for t in texts
        ]
        return SimpleNamespace(embeddings=out)


def _client(monkeypatch, **kw):
    models = _Models(**kw)
    monkeypatch.setattr(emb_mod, "gemini_client", SimpleNamespace(models=models))
    return models


async def test_empty_input_returns_empty_without_calling_the_api(monkeypatch):
    models = _client(monkeypatch)
    assert await emb_mod.generate_embeddings_batch([]) == []
    assert models.calls == []


async def test_chunks_at_the_batch_limit_and_preserves_order(monkeypatch):
    models = _client(monkeypatch)
    n = emb_mod.EMBED_BATCH_MAX * 2 + 5
    texts = [f"t-{i}" for i in range(n)]
    out = await emb_mod.generate_embeddings_batch(texts)
    assert [len(c) for c in models.calls] == [100, 100, 5]
    assert [v[0] for v in out] == [i + 1.0 for i in range(n)]


async def test_exactly_one_chunk_at_the_limit(monkeypatch):
    models = _client(monkeypatch)
    await emb_mod.generate_embeddings_batch([f"t-{i}" for i in range(emb_mod.EMBED_BATCH_MAX)])
    assert len(models.calls) == 1


async def test_count_mismatch_raises_loudly(monkeypatch):
    _client(monkeypatch, drop=1)
    with pytest.raises(RuntimeError, match="2 embeddings for 3 texts"):
        await emb_mod.generate_embeddings_batch(["t-0", "t-1", "t-2"])


async def test_blank_text_is_refused_before_any_call(monkeypatch):
    models = _client(monkeypatch)
    with pytest.raises(emb_mod.EmbeddingUnavailableError):
        await emb_mod.generate_embeddings_batch(["t-0", "  "])
    assert models.calls == []


async def test_unconfigured_client_raises(monkeypatch):
    monkeypatch.setattr(emb_mod, "gemini_client", None)
    with pytest.raises(emb_mod.EmbeddingUnavailableError):
        await emb_mod.generate_embeddings_batch(["t-0"])


async def test_oversized_vectors_are_trimmed_and_short_ones_padded(monkeypatch):
    _client(monkeypatch, dims=3072)
    (v,) = await emb_mod.generate_embeddings_batch(["t-0"])
    assert len(v) == emb_mod.EMBEDDING_DIMS
    _client(monkeypatch, dims=10)
    (v,) = await emb_mod.generate_embeddings_batch(["t-0"])
    assert len(v) == emb_mod.EMBEDDING_DIMS and v[-1] == 0.0


def test_sync_embed_reports_no_tokens_when_statistics_absent(monkeypatch):
    _client(monkeypatch)
    vectors, tokens = emb_mod._sync_embed(["t-0", "t-1"])
    assert len(vectors) == 2 and tokens is None


def test_model_id_names_model_and_dims():
    assert emb_mod.EMBEDDING_MODEL_ID == f"{emb_mod.GEMINI_EMBEDDING_MODEL}@{emb_mod.EMBEDDING_DIMS}"


def test_model_id_is_pinned_to_the_cached_gemini_value(monkeypatch):
    # The eval cache and threshold are Gemini-specific; redefining
    # EMBEDDING_MODEL (PR #92) must not change the id.
    assert emb_mod.EMBEDDING_MODEL_ID == "gemini-embedding-001@768"
    monkeypatch.setattr(emb_mod, "EMBEDDING_MODEL", "other")
    assert emb_mod.EMBEDDING_MODEL_ID == "gemini-embedding-001@768"
