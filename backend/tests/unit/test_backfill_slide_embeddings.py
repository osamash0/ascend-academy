"""Unit tests for `backend.scripts.backfill_slide_embeddings`.

Covers the contract that matters operationally:
- only slides missing from `slide_embeddings` get embedded (idempotent)
- metadata slides are skipped (matches `_safe_embedding_task`)
- slides with no usable text are skipped
- `--force` re-embeds even when rows exist
- `--dry-run` computes but never writes
- `lecture_id` is attached on rows after the backfill when a matching
  `lectures.pdf_hash` row exists
"""
from __future__ import annotations

import pytest

from backend.scripts import backfill_slide_embeddings as bf


# ── Fixtures ──────────────────────────────────────────────────────────────────

PDF_HASH = "deadbeef" * 8
PIPELINE = "2"


def _slide(title: str, content: str = "body text", **extra) -> dict:
    s = {"title": title, "content": content, "summary": ""}
    s.update(extra)
    return s


@pytest.fixture
def fake_embed(monkeypatch):
    """Patch generate_embeddings everywhere the backfill imports it from."""
    calls: list[str] = []

    async def _fake(text: str):
        calls.append(text)
        # 768-dim vector matching production shape
        return [0.1] * 768

    monkeypatch.setattr(bf, "generate_embeddings", _fake, raising=True)
    return calls


@pytest.fixture
def seed_cache(patch_supabase, monkeypatch):
    """Seed slide_parse_cache with a mix of real and metadata slides."""
    # The script imports `supabase_admin` into its own namespace at module
    # load, so the global patch in `patch_supabase` doesn't reach it.
    monkeypatch.setattr(bf, "supabase_admin", patch_supabase, raising=True)
    patch_supabase.seed(
        "slide_parse_cache",
        [
            {
                "pdf_hash": PDF_HASH,
                "slide_index": 0,
                "pipeline_version": PIPELINE,
                "slide_data": _slide(
                    "Title page", content="", is_metadata=True
                ),
            },
            {
                "pdf_hash": PDF_HASH,
                "slide_index": 1,
                "pipeline_version": PIPELINE,
                "slide_data": _slide("Intro", content="welcome to the lecture"),
            },
            {
                "pdf_hash": PDF_HASH,
                "slide_index": 2,
                "pipeline_version": PIPELINE,
                "slide_data": _slide("Recap", content="key points covered"),
            },
            {
                "pdf_hash": PDF_HASH,
                "slide_index": 3,
                "pipeline_version": PIPELINE,
                # no usable text → skipped
                "slide_data": {"title": "", "content": "", "summary": ""},
            },
        ],
    )
    return patch_supabase


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_backfill_embeds_missing_slides_and_skips_metadata(
    seed_cache, fake_embed
):
    stats = await bf.backfill(pipeline_version=PIPELINE)

    assert stats.pdf_hashes_seen == 1
    assert stats.slides_seen == 4
    assert stats.slides_skipped_metadata == 1
    assert stats.slides_skipped_no_text == 1
    assert stats.slides_embedded == 2
    assert stats.slides_failed == 0

    rows = seed_cache.tables.get("slide_embeddings", [])
    assert len(rows) == 2
    indices = sorted(r["slide_index"] for r in rows)
    assert indices == [1, 2]
    for r in rows:
        assert r["pdf_hash"] == PDF_HASH
        assert r["pipeline_version"] == PIPELINE
        assert r["lecture_id"] is None
        assert len(r["embedding"]) == 768
        assert r["metadata"]["title"] in {"Intro", "Recap"}


@pytest.mark.asyncio
async def test_backfill_is_idempotent_skips_already_embedded(
    seed_cache, fake_embed
):
    seed_cache.seed(
        "slide_embeddings",
        [
            {
                "pdf_hash": PDF_HASH,
                "slide_index": 1,
                "pipeline_version": PIPELINE,
                "embedding": [0.0] * 768,
                "metadata": {"title": "Intro"},
                "content_hash": "stale",
                "lecture_id": None,
            }
        ],
    )

    stats = await bf.backfill(pipeline_version=PIPELINE)

    assert stats.slides_already_embedded == 1
    assert stats.slides_embedded == 1  # only slide 2 needed embedding
    assert len(fake_embed) == 1


@pytest.mark.asyncio
async def test_force_re_embeds_existing_rows(seed_cache, fake_embed):
    seed_cache.seed(
        "slide_embeddings",
        [
            {
                "pdf_hash": PDF_HASH,
                "slide_index": 1,
                "pipeline_version": PIPELINE,
                "embedding": [0.0] * 768,
                "metadata": {"title": "Stale"},
                "content_hash": "stale",
                "lecture_id": None,
            }
        ],
    )

    stats = await bf.backfill(pipeline_version=PIPELINE, force=True)

    assert stats.slides_already_embedded == 0
    assert stats.slides_embedded == 2
    rows = seed_cache.tables.get("slide_embeddings", [])
    # store_slide_embedding deletes-then-inserts, so the stale "Stale" row
    # is replaced by one with the real title.
    titles = sorted(r["metadata"]["title"] for r in rows)
    assert titles == ["Intro", "Recap"]


@pytest.mark.asyncio
async def test_dry_run_does_not_write(seed_cache, fake_embed):
    stats = await bf.backfill(pipeline_version=PIPELINE, dry_run=True)

    assert stats.slides_embedded == 2
    assert seed_cache.tables.get("slide_embeddings", []) == []
    # generate_embeddings still ran so failures would surface
    assert len(fake_embed) == 2


@pytest.mark.asyncio
async def test_attaches_lecture_id_when_lecture_exists(seed_cache, fake_embed):
    seed_cache.seed(
        "lectures",
        [{"id": "lec-123", "pdf_hash": PDF_HASH}],
    )

    stats = await bf.backfill(pipeline_version=PIPELINE)

    assert stats.lectures_linked == 1
    rows = seed_cache.tables.get("slide_embeddings", [])
    assert len(rows) == 2
    assert all(r["lecture_id"] == "lec-123" for r in rows)


@pytest.mark.asyncio
async def test_pdf_hash_filter_restricts_scope(seed_cache, fake_embed):
    other = "feedface" * 8
    seed_cache.seed(
        "slide_parse_cache",
        seed_cache.tables["slide_parse_cache"]
        + [
            {
                "pdf_hash": other,
                "slide_index": 0,
                "pipeline_version": PIPELINE,
                "slide_data": _slide("Other", content="other lecture"),
            }
        ],
    )

    stats = await bf.backfill(pipeline_version=PIPELINE, pdf_hash=other)

    assert stats.pdf_hashes_seen == 1
    assert stats.slides_embedded == 1
    rows = seed_cache.tables.get("slide_embeddings", [])
    assert [r["pdf_hash"] for r in rows] == [other]


@pytest.mark.asyncio
async def test_store_failure_is_surfaced(seed_cache, fake_embed, monkeypatch):
    async def _bad_store(**_):
        return False

    monkeypatch.setattr(bf, "store_slide_embedding", _bad_store, raising=True)

    stats = await bf.backfill(pipeline_version=PIPELINE)

    assert stats.slides_embedded == 0
    assert stats.slides_failed == 2
    assert len(stats.failures) == 2
    assert all("store returned False" in f for f in stats.failures)


@pytest.mark.asyncio
async def test_attach_failure_is_surfaced(seed_cache, fake_embed, monkeypatch):
    seed_cache.seed("lectures", [{"id": "lec-X", "pdf_hash": PDF_HASH}])

    async def _bad_attach(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(bf, "attach_lecture_id_to_embeddings", _bad_attach, raising=True)

    stats = await bf.backfill(pipeline_version=PIPELINE)

    assert stats.lectures_linked == 0
    assert any("0 rows updated" in f for f in stats.failures)


@pytest.mark.asyncio
async def test_pipeline_version_isolates_results(seed_cache, fake_embed):
    seed_cache.seed(
        "slide_parse_cache",
        seed_cache.tables["slide_parse_cache"]
        + [
            {
                "pdf_hash": PDF_HASH,
                "slide_index": 0,
                "pipeline_version": "1",  # legacy version
                "slide_data": _slide("Legacy", content="legacy body"),
            }
        ],
    )

    stats = await bf.backfill(pipeline_version="1")

    assert stats.slides_embedded == 1
    rows = seed_cache.tables.get("slide_embeddings", [])
    assert len(rows) == 1
    assert rows[0]["pipeline_version"] == "1"
    assert rows[0]["metadata"]["title"] == "Legacy"
