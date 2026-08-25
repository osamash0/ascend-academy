"""Unit tests: no code path may persist an all-zero embedding vector.

Why this matters more than "a useless row". pgvector returns NaN for cosine
distance against a zero vector, and Postgres orders NaN above every real
float:

    SELECT 1 - ('[0,0,0]'::vector <=> '[1,0,0]'::vector);  -->  NaN
    SELECT (NaN > 0.65);                                   -->  true

So a zero row survives `match_slides_by_lecture`'s similarity filter -- the
filter whose whole job is dropping irrelevant slides. It does sort last (that
RPC orders by distance ascending, where NaN is largest), so it cannot
displace a genuine match; but it fills leftover top-k slots whenever fewer
slides clear the threshold than were requested, feeding a semantically
unrelated slide into the tutor's grounding context. Both halves are pinned
against a real Postgres in
backend/tests/db/test_zero_vector_retrieval_hazard.py.

Two independent producers of zero vectors existed:
  1. `_sync_generate_embeddings` returned [0.0] * 768 when GEMINI_API_KEY was
     unset (`gemini_client is None`).
  2. `generate_embeddings` returned [0.0] * 768 for blank input text.

Neither was caught downstream: a 768-zero list is truthy, so
`if not embedding` (file_parse_service) passed it through, and it is not
None, so `if embedding is None` (cache.store_slide_embedding) did too.

The corruption also latched. `content_hash` is derived from the real slide
text and stored alongside the zero vector, so a later re-parse -- even with
a working key -- hit the `existing_hash == content_hash` dedupe check and
skipped re-embedding. It could never self-heal.
"""
from __future__ import annotations

import asyncio
import hashlib

import pytest

from backend.services import cache as cache_mod
from backend.services import file_parse_service as fps
from backend.services.ai import embeddings as emb_mod

PDF_HASH = "cafebabe" * 8


def _slide(title: str = "Intro", content: str = "real teaching content") -> dict:
    return {"title": title, "content": content, "summary": ""}


def _content_hash_for(slide: dict) -> str:
    text = fps._build_embedding_text(slide)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@pytest.fixture
def no_api_key(monkeypatch):
    """Simulate an absent GEMINI_API_KEY (orchestrator leaves the client None)."""
    monkeypatch.setattr(emb_mod, "gemini_client", None, raising=True)


# ── (a) the producer must signal, not fabricate ──────────────────────────────


async def test_missing_api_key_raises_instead_of_returning_zeros(no_api_key):
    """A missing key is a configuration fault. It must surface as an
    exception, not as 768 zeros that look like a real vector."""
    with pytest.raises(emb_mod.EmbeddingUnavailableError):
        await emb_mod.generate_embeddings("some slide text")


async def test_blank_text_raises_rather_than_returning_zeros(monkeypatch):
    """The second zero-vector producer: blank input. Callers already skip
    empty text upstream, so raising here cannot regress the parse path -- it
    only closes the hole for any future caller that forgets to check."""
    with pytest.raises(emb_mod.EmbeddingUnavailableError):
        await emb_mod.generate_embeddings("   ")


# ── (b) the persistence layer must refuse zeros regardless of producer ──────


async def test_store_slide_embedding_rejects_all_zero_vector(patch_supabase):
    """Backstop at the single chokepoint every writer funnels through --
    including backfill_slide_embeddings.py, which does not share the
    parse path's guards."""
    ok = await cache_mod.store_slide_embedding(
        lecture_id=None,
        slide_index=0,
        embedding=[0.0] * 768,
        metadata={},
        content_hash="whatever",
        pdf_hash=PDF_HASH,
        pipeline_version="5",
    )

    assert ok is False
    assert patch_supabase.tables.get("slide_embeddings", []) == []


async def test_store_slide_embedding_accepts_a_real_vector(patch_supabase):
    """Control: the guard must not reject legitimate vectors, including ones
    that merely *contain* zeros."""
    vector = [0.0] * 767 + [0.5]

    ok = await cache_mod.store_slide_embedding(
        lecture_id=None,
        slide_index=0,
        embedding=vector,
        metadata={},
        content_hash="h0",
        pdf_hash=PDF_HASH,
        pipeline_version="5",
    )

    assert ok is True
    rows = patch_supabase.tables.get("slide_embeddings", [])
    assert len(rows) == 1
    assert rows[0]["embedding"] == vector


# ── (c) the parse path degrades safely and stays retryable ──────────────────


async def test_no_row_written_when_key_missing(patch_supabase, no_api_key):
    """`_safe_embedding_task` must never fail the parse, but must also never
    leave a fabricated row behind."""
    failed: list = []
    await fps._safe_embedding_task(0, _slide(), PDF_HASH, failed, asyncio.Semaphore(2))

    assert patch_supabase.tables.get("slide_embeddings", []) == []
    assert len(failed) == 1, "the slide must be queued for retry, not dropped"


async def test_failed_embedding_does_not_latch_via_content_hash(
    patch_supabase, no_api_key, monkeypatch
):
    """The regression that made this bug permanent.

    A failed attempt must leave no content_hash behind, so that a later
    attempt with a working key actually re-embeds instead of hitting the
    dedupe short-circuit and preserving the bad state forever.
    """
    slide = _slide()

    # Attempt 1: no API key. Must write nothing at all.
    failed: list = []
    await fps._safe_embedding_task(0, slide, PDF_HASH, failed, asyncio.Semaphore(2))
    assert patch_supabase.tables.get("slide_embeddings", []) == []

    # Attempt 2: key restored. Must genuinely embed, not skip as "unchanged".
    calls: list[str] = []

    async def _working_embed(text: str):
        calls.append(text)
        return [0.1] * 768

    monkeypatch.setattr(fps, "generate_embeddings", _working_embed, raising=True)

    await fps._safe_embedding_task(0, slide, PDF_HASH, [], asyncio.Semaphore(2))

    assert len(calls) == 1, "second attempt was wrongly skipped by content-hash dedupe"
    rows = patch_supabase.tables.get("slide_embeddings", [])
    assert len(rows) == 1
    assert rows[0]["embedding"] == [0.1] * 768
    assert rows[0]["content_hash"] == _content_hash_for(slide)
