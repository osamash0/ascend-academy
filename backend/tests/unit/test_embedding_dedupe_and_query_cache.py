"""Unit tests for P3-2: content-hash embedding dedupe + query-embedding cache.

docs/ROADMAP_10X_FOUNDATION.md §8: `_safe_embedding_task` used to compute
`content_hash` *after* already paying for `generate_embeddings`, and nothing
ever read it to skip re-embedding — so every re-parse re-paid the embedding
API for every unchanged slide. Tutor query embeddings were also uncached, so
the same question asked twice embedded twice.

Covers:
- re-embedding an UNCHANGED slide (content_hash already stored, matches)
  results in ZERO calls to `generate_embeddings`.
- changing ONE slide's content re-embeds EXACTLY that slide, not the deck.
- repeated identical tutor questions within the cache TTL issue ONE query
  embedding call, not N.
"""
from __future__ import annotations

import asyncio
import hashlib

import pytest

from backend.services import file_parse_service as fps
from backend.services.ai import retrieval as retrieval_mod

PDF_HASH = "deadbeef" * 8


def _slide(title: str, content: str = "body text") -> dict:
    return {"title": title, "content": content, "summary": ""}


def _content_hash_for(slide: dict) -> str:
    text = fps._build_embedding_text(slide)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@pytest.fixture
def fake_embed(monkeypatch):
    """Patch `generate_embeddings` as imported into file_parse_service."""
    calls: list[str] = []

    async def _fake(text: str):
        calls.append(text)
        return [0.1] * 768

    monkeypatch.setattr(fps, "generate_embeddings", _fake, raising=True)
    return calls


async def _embed(idx: int, slide: dict, pdf_hash: str = PDF_HASH) -> list:
    """Run `_safe_embedding_task` for one slide; return the failed-queue."""
    failed: list = []
    sem = asyncio.Semaphore(2)
    await fps._safe_embedding_task(idx, slide, pdf_hash, failed, sem)
    return failed


# ── (a) unchanged slide → zero embedding calls ───────────────────────────────

async def test_unchanged_slide_skips_reembedding(patch_supabase, fake_embed):
    slide = _slide("Intro", "Same content every time")
    existing_hash = _content_hash_for(slide)

    patch_supabase.seed(
        "slide_embeddings",
        [
            {
                "pdf_hash": PDF_HASH,
                "slide_index": 0,
                "pipeline_version": fps.PIPELINE_VERSION,
                "content_hash": existing_hash,
                "embedding": [0.1] * 768,
                "metadata": {"title": "Intro"},
                "lecture_id": None,
            }
        ],
    )

    failed = await _embed(0, slide)

    assert fake_embed == []  # zero calls to generate_embeddings
    assert failed == []
    # No duplicate row was written — the pre-existing row is untouched.
    rows = [r for r in patch_supabase.tables.get("slide_embeddings", [])
            if r["slide_index"] == 0]
    assert len(rows) == 1
    assert rows[0]["content_hash"] == existing_hash


async def test_new_slide_with_no_existing_row_is_embedded(patch_supabase, fake_embed):
    """Sanity check: a slide with no prior row still embeds normally."""
    slide = _slide("Fresh", "Never embedded before")

    failed = await _embed(0, slide)

    assert len(fake_embed) == 1
    assert failed == []
    rows = patch_supabase.tables.get("slide_embeddings", [])
    assert len(rows) == 1
    assert rows[0]["content_hash"] == _content_hash_for(slide)


# ── (b) one changed slide → re-embeds exactly that slide ─────────────────────

async def test_changed_slide_reembeds_only_that_slide(patch_supabase, fake_embed):
    unchanged = _slide("Intro", "This slide never changes")
    changed_old = _slide("Methods", "old method description")
    changed_new = _slide("Methods", "brand new method description")
    third = _slide("Conclusion", "wrap-up content")

    patch_supabase.seed(
        "slide_embeddings",
        [
            {
                "pdf_hash": PDF_HASH,
                "slide_index": 0,
                "pipeline_version": fps.PIPELINE_VERSION,
                "content_hash": _content_hash_for(unchanged),
                "embedding": [0.1] * 768,
                "metadata": {"title": "Intro"},
                "lecture_id": None,
            },
            {
                "pdf_hash": PDF_HASH,
                "slide_index": 1,
                "pipeline_version": fps.PIPELINE_VERSION,
                "content_hash": _content_hash_for(changed_old),
                "embedding": [0.2] * 768,
                "metadata": {"title": "Methods"},
                "lecture_id": None,
            },
            {
                "pdf_hash": PDF_HASH,
                "slide_index": 2,
                "pipeline_version": fps.PIPELINE_VERSION,
                "content_hash": _content_hash_for(third),
                "embedding": [0.3] * 768,
                "metadata": {"title": "Conclusion"},
                "lecture_id": None,
            },
        ],
    )

    # Re-parse the whole 3-slide deck: two slides unchanged, one (index 1)
    # has new content.
    await _embed(0, unchanged)
    await _embed(1, changed_new)
    await _embed(2, third)

    # Only the changed slide (index 1) actually called generate_embeddings.
    assert len(fake_embed) == 1

    rows_by_index = {
        r["slide_index"]: r for r in patch_supabase.tables.get("slide_embeddings", [])
    }
    assert len(rows_by_index) == 3
    assert rows_by_index[1]["content_hash"] == _content_hash_for(changed_new)
    # Untouched slides keep their original stored embedding vector.
    assert rows_by_index[0]["embedding"] == [0.1] * 768
    assert rows_by_index[2]["embedding"] == [0.3] * 768
    # The changed slide got a freshly-stored vector (from fake_embed's [0.1]*768
    # default — different call site, but the point is it went through
    # store_slide_embedding again instead of being skipped).
    assert rows_by_index[1]["embedding"] == [0.1] * 768


# ── (c) repeated tutor query → one query embedding call ──────────────────────

class _FakeRedis:
    """Minimal in-memory stand-in for the Redis client used by the query
    embedding cache — enough surface (get/setex) for this test, no real
    Redis connection required."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def setex(self, key: str, ttl: int, value: str):
        self.store[key] = value


@pytest.fixture
def fake_redis(monkeypatch):
    client = _FakeRedis()
    import backend.core.redis as redis_module

    monkeypatch.setattr(redis_module, "get_redis_client", lambda: client, raising=True)
    return client


@pytest.fixture
def fake_query_embed(monkeypatch):
    calls: list[str] = []

    async def _fake(text: str):
        calls.append(text)
        return [0.42] * 768

    monkeypatch.setattr(retrieval_mod, "generate_embeddings", _fake, raising=True)
    return calls


async def test_repeated_tutor_question_embeds_once(
    monkeypatch, fake_redis, fake_query_embed
):
    """Two calls to retrieve_relevant_slides with the identical question
    should only call generate_embeddings once — the second call is served
    from the Redis query-embedding cache."""

    async def _no_matches(*args, **kwargs):
        return []

    # P1-4 replaced the unscoped get_similar_slides wrapper with the
    # SQL-scoped get_similar_slides_by_lecture RPC — that's what
    # retrieve_relevant_slides calls now; stub it out so this test focuses
    # purely on the query-embedding cache behavior.
    monkeypatch.setattr(retrieval_mod, "get_similar_slides_by_lecture", _no_matches, raising=True)

    query = "What is backpropagation?"

    await retrieval_mod.retrieve_relevant_slides(query, lecture_id="lecture-1")
    await retrieval_mod.retrieve_relevant_slides(query, lecture_id="lecture-1")

    assert len(fake_query_embed) == 1


async def test_different_tutor_questions_each_embed(
    monkeypatch, fake_redis, fake_query_embed
):
    """Sanity check: distinct questions are NOT conflated by the cache."""

    async def _no_matches(*args, **kwargs):
        return []

    # P1-4 replaced the unscoped get_similar_slides wrapper with the
    # SQL-scoped get_similar_slides_by_lecture RPC — that's what
    # retrieve_relevant_slides calls now; stub it out so this test focuses
    # purely on the query-embedding cache behavior.
    monkeypatch.setattr(retrieval_mod, "get_similar_slides_by_lecture", _no_matches, raising=True)

    await retrieval_mod.retrieve_relevant_slides("question one", lecture_id="lecture-1")
    await retrieval_mod.retrieve_relevant_slides("question two", lecture_id="lecture-1")

    assert len(fake_query_embed) == 2
