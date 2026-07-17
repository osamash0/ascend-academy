"""Unit tests for backend.services.slide_synth_service.

Lazy per-slide synthesis for the import-pdf-lazy pipeline. The LLM
(``batch_analyze_text_slides``) and the slide_parse_cache read/write helpers
are mocked at the module boundary, so we assert the deterministic control flow:
cache-first short-circuit, missing-layout / out-of-range guards, the empty-text
branch, neighbor-window assembly, target selection from the batch response,
LLM-failure fallback, and the stub/empty/enrich `_meta` blocks.
"""
from __future__ import annotations

import pytest

from backend.services import slide_synth_service as sss
from backend.services.layout_analyzer import PageLayout


def _layout_dict(index: int, raw_text: str = "some content", **overrides) -> dict:
    d = dict(
        index=index,
        page_number=index + 1,
        word_count=len(raw_text.split()),
        alpha_ratio=1.0,
        image_coverage=0.0,
        drawing_count=0,
        has_table=False,
        column_count=1,
        has_code_block=False,
        has_math=False,
        raw_text=raw_text,
        odl_table_md="",
    )
    d.update(overrides)
    return d


def _layout(index: int, raw_text: str = "some content", **overrides) -> PageLayout:
    return PageLayout(**_layout_dict(index, raw_text, **overrides))


@pytest.fixture
def synth(monkeypatch):
    """Wire the cache + LLM boundaries. Configure via the returned box."""
    box: dict = {
        "cached_slides": {},
        "pdf_cache": None,
        "batch_result": [],
        "batch_raises": False,
        "stored": [],
    }

    async def _get_cached_slide_results(pdf_hash, version):
        return box["cached_slides"]

    async def _get_cached_parse(pdf_hash):
        return box["pdf_cache"]

    async def _store(pdf_hash, idx, version, result):
        box["stored"].append((idx, result))

    async def _batch(slides_input, ai_model=None, blueprint=None):
        box["batch_input"] = slides_input
        if box["batch_raises"]:
            raise RuntimeError("llm down")
        return box["batch_result"]

    def _truncate(text):
        return text, None

    monkeypatch.setattr(sss, "get_cached_slide_results", _get_cached_slide_results)
    monkeypatch.setattr(sss, "get_cached_parse", _get_cached_parse)
    monkeypatch.setattr(sss, "store_slide_parse_result", _store)
    monkeypatch.setattr(sss, "batch_analyze_text_slides", _batch)
    monkeypatch.setattr(sss, "safe_truncate_text", _truncate)
    return box


# ── synthesize_slide control flow ─────────────────────────────────────────────

async def test_synthesize_returns_cached_slide(synth):
    synth["cached_slides"] = {2: {"title": "cached", "index": 2}}
    out = await sss.synthesize_slide("hash", 2)
    assert out == {"title": "cached", "index": 2}
    assert synth["stored"] == []  # cache hit → no write


async def test_synthesize_none_when_no_pdf_cache(synth):
    synth["pdf_cache"] = None
    assert await sss.synthesize_slide("hash", 0) is None


async def test_synthesize_none_when_no_layouts_key(synth):
    synth["pdf_cache"] = {"filename": "x.pdf"}  # no "layouts"
    assert await sss.synthesize_slide("hash", 0) is None


async def test_synthesize_none_when_index_out_of_range(synth):
    synth["pdf_cache"] = {"layouts": [_layout_dict(0)], "filename": "x.pdf"}
    assert await sss.synthesize_slide("hash", 5) is None
    assert await sss.synthesize_slide("hash", -1) is None


async def test_synthesize_empty_text_returns_metadata_slide_and_stores(synth):
    synth["pdf_cache"] = {"layouts": [_layout_dict(0, raw_text="   ")], "filename": "x.pdf"}
    out = await sss.synthesize_slide("hash", 0)
    assert out["is_metadata"] is True
    assert out["slide_type"] == "metadata"
    assert out["_meta"]["route"] == "skip"
    assert synth["stored"] and synth["stored"][0][0] == 0


async def test_synthesize_happy_path_enriches_and_stores(synth):
    synth["pdf_cache"] = {
        "layouts": [_layout_dict(0), _layout_dict(1, "target text"), _layout_dict(2)],
        "filename": "deck.pdf",
    }
    synth["batch_result"] = [
        {"index": 0, "title": "n-1"},
        {"index": 1, "title": "Target", "slide_type": "text", "content": "c"},
        {"index": 2, "title": "n+1"},
    ]
    out = await sss.synthesize_slide("hash", 1)
    assert out["title"] == "Target"
    assert out["_meta"]["engine"] == "lazy_text"
    assert out["_meta"]["route"] == "lazy"
    assert synth["stored"][0][0] == 1


async def test_synthesize_builds_neighbor_window_with_context_flags(synth):
    synth["pdf_cache"] = {
        "layouts": [_layout_dict(i) for i in range(4)],
        "filename": "deck.pdf",
    }
    synth["batch_result"] = [{"index": 1, "title": "T"}]
    await sss.synthesize_slide("hash", 1)
    inp = synth["batch_input"]
    # idx=1 with radius 1 → windows 0,1,2. Neighbors flagged context_only.
    idxs = {e["index"]: e for e in inp}
    assert set(idxs) == {0, 1, 2}
    assert idxs[0].get("context_only") is True
    assert idxs[2].get("context_only") is True
    assert "context_only" not in idxs[1]  # the target is not context-only


async def test_synthesize_returns_none_when_llm_raises(synth):
    synth["pdf_cache"] = {"layouts": [_layout_dict(0, "text here")], "filename": "x.pdf"}
    synth["batch_raises"] = True
    assert await sss.synthesize_slide("hash", 0) is None
    assert synth["stored"] == []  # nothing persisted on failure


async def test_synthesize_returns_none_when_target_missing_from_batch(synth):
    synth["pdf_cache"] = {"layouts": [_layout_dict(0, "text here")], "filename": "x.pdf"}
    synth["batch_result"] = [{"index": 99, "title": "wrong slide"}]  # no index 0
    assert await sss.synthesize_slide("hash", 0) is None


# ── make_stub_slide ───────────────────────────────────────────────────────────

def test_make_stub_slide_title_from_first_line():
    layout = _layout(3, "Binary Search Trees\ndetails follow")
    stub = sss.make_stub_slide(3, layout, "deck.pdf")
    assert stub["title"] == "Binary Search Trees"
    assert stub["content"] == "Binary Search Trees\ndetails follow"[:500]
    assert stub["slide_type"] == "stub"
    assert stub["_meta"]["route"] == "lazy_stub"
    assert stub["_meta"]["engine"] == "none"


def test_make_stub_slide_placeholder_title_when_empty():
    layout = _layout(0, "   ")
    stub = sss.make_stub_slide(0, layout, "deck.pdf")
    assert stub["title"] == "Slide 1"
    assert stub["content"] == ""


def test_make_stub_slide_truncates_long_title_and_content():
    long_first_line = "X" * 200
    layout = _layout(0, long_first_line + "\n" + "Y" * 400)  # total 601 chars
    stub = sss.make_stub_slide(0, layout, "deck.pdf")
    assert len(stub["title"]) == 80
    assert len(stub["content"]) == 500


# ── _make_empty_slide ─────────────────────────────────────────────────────────

def test_make_empty_slide_is_metadata():
    layout = _layout(4, "")
    slide = sss._make_empty_slide(4, layout, "deck.pdf")
    assert slide["is_metadata"] is True
    assert slide["title"] == "Slide 5"
    assert slide["_meta"]["route"] == "skip"
    assert slide["_meta"]["route_reason"] == "empty raw_text"


# ── _enrich ───────────────────────────────────────────────────────────────────

def test_enrich_sets_defaults_and_meta():
    layout = _layout(2, "content", column_count=2, has_math=True)
    result = {"index": 2, "content": "c"}
    sss._enrich(result, layout, "deck.pdf")
    assert result["slide_index"] == 2
    assert result["title"] == "Slide 3"           # default title filled
    assert result["_meta"]["engine"] == "lazy_text"
    assert result["_meta"]["column_count"] == 2
    assert result["_meta"]["has_math"] is True


def test_enrich_preserves_existing_title():
    layout = _layout(0, "content")
    result = {"index": 0, "title": "Kept", "slide_type": "math-diagram"}
    sss._enrich(result, layout, "deck.pdf")
    assert result["title"] == "Kept"
    assert result["_meta"]["type"] == "math-diagram"
