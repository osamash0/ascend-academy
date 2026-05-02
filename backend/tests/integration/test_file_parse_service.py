"""Integration tests for backend.services.file_parse_service.parse_pdf_stream.

All external dependencies (LLM providers, Supabase cache, OCR) are stubbed
via monkeypatch.  Tests assert end-to-end event ordering, route handling
(text/vision/skip), checkpoint resume, blueprint flow, and graceful
fallback behaviour when a stage raises.
"""
from __future__ import annotations

from typing import Any, Dict, List

import fitz
import pytest

from backend.services import file_parse_service as fps
from backend.services.layout_analyzer import PageLayout
from backend.services.slide_classifier import RoutingManifest


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _make_simple_pdf(n_pages: int = 3) -> bytes:
    doc = fitz.open()
    for i in range(n_pages):
        page = doc.new_page()
        page.insert_text(
            (72, 72),
            f"Slide {i + 1}: a sentence with enough words to look like content.",
        )
    out = doc.tobytes()
    doc.close()
    return out


def _fake_text_batch(slides, ai_model="groq", blueprint=None):
    """Stub for ``batch_analyze_text_slides`` returning one result per slide."""
    return [
        {
            "index": s["index"],
            "title": f"Title {s['index']}",
            "content": s["text"],
            "summary": f"Summary {s['index']}",
            "questions": [],
            "slide_type": "content",
        }
        for s in slides
    ]


def _fake_vision(b64, raw_text="", ai_model="groq", blueprint_context=""):
    return {
        "title": "Vision Title",
        "content_extraction": {
            "main_topic": "Diagram Topic",
            "key_points": ["Point A", "Point B"],
            "summary": "vision summary",
        },
        "metadata": {"lecture_title": "VL"},
        "quiz": {"question": "Q?", "options": ["a", "b", "c", "d"], "correctAnswer": 0},
        "slide_type": "diagram",
    }


def _no_blueprint_cache(*_a, **_kw):
    return None


def _async_none(*_a, **_kw):
    async def inner():
        return None

    return inner()


async def _async_value(value):
    return value


@pytest.fixture
def patch_pipeline_deps(monkeypatch):
    """Stub out every LLM/cache/OCR dep used by parse_pdf_stream.

    Returns a `state` dict the test can mutate (e.g. to override
    individual stubs) and inspect (call counts).
    """
    state: Dict[str, Any] = {
        "text_batch_calls": [],
        "vision_calls": [],
        "blueprint_calls": 0,
        "summary_calls": 0,
        "quiz_calls": 0,
        "store_blueprint_calls": [],
        "store_slide_calls": [],
        "is_metadata_returns": {},  # idx -> bool
    }

    async def text_batch(slides, ai_model="groq", blueprint=None):
        state["text_batch_calls"].append([s["index"] for s in slides])
        return _fake_text_batch(slides, ai_model, blueprint)

    async def vision(b64, raw_text="", ai_model="groq", blueprint_context=""):
        state["vision_calls"].append(raw_text[:20])
        return _fake_vision(b64, raw_text, ai_model, blueprint_context)

    async def deck_summary(*_a, **_kw):
        state["summary_calls"] += 1
        return "DECK_SUMMARY"

    async def deck_quiz(*_a, **_kw):
        state["quiz_calls"] += 1
        return [{"question": "q1", "options": ["a", "b"], "answer": 0}]

    async def hier_summary(*_a, **_kw):
        # async generator, produces a single "result" event
        yield {"type": "result", "data": "HIER"}

    async def gen_blueprint(*_a, **_kw):
        state["blueprint_calls"] += 1
        yield {
            "type": "result",
            "data": {
                "lecture_title": "L",
                "overall_summary": "BP_SUMMARY",
                "slide_plans": [],
                "version": 1,
            },
        }

    async def get_bp(*_a, **_kw):
        return None

    async def store_bp(pdf_hash, blueprint, version=1):
        state["store_blueprint_calls"].append((pdf_hash, version))

    async def get_cached_slides(*_a, **_kw):
        return {}

    async def store_slide(pdf_hash, idx, version, data):
        state["store_slide_calls"].append((idx, version))

    def is_metadata(text, idx, total, ai_model):
        return {"is_metadata": state["is_metadata_returns"].get(idx, False)}

    monkeypatch.setattr(fps, "batch_analyze_text_slides", text_batch)
    monkeypatch.setattr(fps, "analyze_slide_vision", vision)
    monkeypatch.setattr(fps, "generate_deck_summary", deck_summary)
    monkeypatch.setattr(fps, "generate_deck_quiz", deck_quiz)
    monkeypatch.setattr(fps, "generate_hierarchical_summary", hier_summary)
    monkeypatch.setattr(fps, "generate_blueprint", gen_blueprint)
    monkeypatch.setattr(fps, "get_cached_blueprint", get_bp)
    monkeypatch.setattr(fps, "store_cached_blueprint", store_bp)
    monkeypatch.setattr(fps, "get_cached_slide_results", get_cached_slides)
    monkeypatch.setattr(fps, "store_slide_parse_result", store_slide)
    monkeypatch.setattr(fps, "is_metadata_slide", is_metadata)
    # Force cerebras_client falsey so plan_model defaults to "groq" path
    monkeypatch.setattr(fps, "cerebras_client", None, raising=False)
    return state


async def _drain(gen):
    return [event async for event in gen]


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

async def test_happy_path_event_sequence(patch_pipeline_deps):
    pdf_bytes = _make_simple_pdf(3)
    events = await _drain(
        fps.parse_pdf_stream(
            pdf_bytes, filename="t.pdf", ai_model="groq", use_blueprint=False
        )
    )

    types = [e["type"] for e in events]

    # First event is the layout-analysis progress
    assert types[0] == "progress"

    # 3 slide events, then deck_complete, then complete
    slide_events = [e for e in events if e["type"] == "slide"]
    assert len(slide_events) == 3
    assert {e["index"] for e in slide_events} == {0, 1, 2}

    # deck_complete must appear before complete and after the last slide
    last_slide_pos = max(i for i, t in enumerate(types) if t == "slide")
    deck_pos = types.index("deck_complete")
    complete_pos = types.index("complete")
    assert last_slide_pos < deck_pos < complete_pos

    # deck_complete payload
    deck = events[deck_pos]
    assert deck["deck_summary"] == "DECK_SUMMARY"
    assert isinstance(deck["deck_quiz"], list) and deck["deck_quiz"]

    assert events[complete_pos] == {"type": "complete", "total": 3}

    # _meta enrichment
    for e in slide_events:
        assert "_meta" in e["slide"]
        assert e["slide"]["_meta"]["filename"] == "t.pdf"
        assert e["slide"]["_meta"]["engine"] == "Text"
        assert e["slide"]["_meta"]["page"] == e["index"] + 1


# ---------------------------------------------------------------------------
# Vision routing
# ---------------------------------------------------------------------------

async def test_vision_route_calls_vision_and_normalizes(patch_pipeline_deps, monkeypatch):
    """Force one page to VISION by stubbing build_routing_manifest."""
    pdf_bytes = _make_simple_pdf(3)

    real_build = fps.build_routing_manifest

    def forced_manifest(layouts, metadata_flags, ai_model):
        manifest = real_build(layouts, metadata_flags, ai_model)
        # Move slide 1 from text to vision
        if 1 in manifest.text_indices:
            manifest.text_indices.remove(1)
        if 1 not in manifest.vision_indices:
            manifest.vision_indices.append(1)
        return manifest

    monkeypatch.setattr(fps, "build_routing_manifest", forced_manifest)

    events = await _drain(
        fps.parse_pdf_stream(
            pdf_bytes, filename="t.pdf", ai_model="groq", use_blueprint=False
        )
    )

    state = patch_pipeline_deps
    assert len(state["vision_calls"]) == 1
    # Text batch should still have run for the other two slides
    flat = [i for batch in state["text_batch_calls"] for i in batch]
    assert sorted(flat) == [0, 2]

    slide_events = [e for e in events if e["type"] == "slide"]
    vision_slide = next(e for e in slide_events if e["index"] == 1)
    s = vision_slide["slide"]
    # Normalised vision result fields
    assert s["title"]
    assert "Diagram Topic" in s["content"]
    assert s["summary"] == "vision summary"
    assert s["_meta"]["engine"] == "Vision"


# ---------------------------------------------------------------------------
# SKIP routing
# ---------------------------------------------------------------------------

async def test_skip_route_yields_metadata_without_llm(patch_pipeline_deps):
    pdf_bytes = _make_simple_pdf(3)
    # Mark page 0 as metadata
    patch_pipeline_deps["is_metadata_returns"] = {0: True}

    events = await _drain(
        fps.parse_pdf_stream(
            pdf_bytes, filename="t.pdf", ai_model="groq", use_blueprint=False
        )
    )

    slide_events = {e["index"]: e["slide"] for e in events if e["type"] == "slide"}
    assert slide_events[0]["is_metadata"] is True
    assert slide_events[0]["slide_type"] == "metadata"
    assert slide_events[0]["_meta"]["engine"] == "Skip"

    # batch_analyze_text_slides should only have been called for slides 1 & 2
    flat = [i for batch in patch_pipeline_deps["text_batch_calls"] for i in batch]
    assert 0 not in flat
    assert sorted(flat) == [1, 2]


# ---------------------------------------------------------------------------
# Checkpoint resume
# ---------------------------------------------------------------------------

async def test_checkpoint_resume_skips_already_processed(monkeypatch, patch_pipeline_deps):
    pdf_bytes = _make_simple_pdf(3)

    cached = {
        1: {
            "index": 1,
            "title": "Cached Slide 2",
            "content": "from cache",
            "summary": "",
            "questions": [],
            "slide_type": "content",
            "_meta": {"engine": "Text", "filename": "t.pdf", "page": 2},
        }
    }

    async def get_cached(*_a, **_kw):
        return cached

    monkeypatch.setattr(fps, "get_cached_slide_results", get_cached)

    events = await _drain(
        fps.parse_pdf_stream(
            pdf_bytes, filename="t.pdf", ai_model="groq", use_blueprint=False
        )
    )

    slide_events = [e for e in events if e["type"] == "slide"]
    by_idx = {e["index"]: e["slide"] for e in slide_events}
    assert by_idx[1]["title"] == "Cached Slide 2"
    assert by_idx[1]["content"] == "from cache"

    # Pages 0 and 2 should have been the only ones sent to the LLM
    flat = [i for batch in patch_pipeline_deps["text_batch_calls"] for i in batch]
    assert sorted(flat) == [0, 2]


# ---------------------------------------------------------------------------
# Failure path: batch raises → per-slide fallback also fails → fallback slide
# ---------------------------------------------------------------------------

async def test_batch_failure_emits_fallback_slides(monkeypatch, patch_pipeline_deps):
    pdf_bytes = _make_simple_pdf(2)

    async def raising_batch(slides, ai_model="groq", blueprint=None):
        raise RuntimeError("upstream LLM blew up")

    monkeypatch.setattr(fps, "batch_analyze_text_slides", raising_batch)

    events = await _drain(
        fps.parse_pdf_stream(
            pdf_bytes, filename="t.pdf", ai_model="groq", use_blueprint=False
        )
    )

    slide_events = [e for e in events if e["type"] == "slide"]
    assert len(slide_events) == 2
    for e in slide_events:
        s = e["slide"]
        assert s.get("parse_error") == "processing_failed"
        # _enrich_result still ran
        assert "_meta" in s
        assert s["_meta"]["engine"] == "Text"


# ---------------------------------------------------------------------------
# Blueprint flow — generated, then cached short-circuit
# ---------------------------------------------------------------------------

async def test_blueprint_generated_when_use_blueprint_true(patch_pipeline_deps):
    pdf_bytes = _make_simple_pdf(2)
    events = await _drain(
        fps.parse_pdf_stream(
            pdf_bytes, filename="t.pdf", ai_model="groq", use_blueprint=True
        )
    )

    state = patch_pipeline_deps
    assert state["blueprint_calls"] == 1
    assert state["store_blueprint_calls"], "blueprint should be persisted to cache"

    # When blueprint provides overall_summary, the deck-summary stage skips
    # generate_deck_summary entirely and just runs the quiz step.
    assert state["summary_calls"] == 0
    assert state["quiz_calls"] == 1

    # An extra "Master Plan ready" progress event is emitted after planning
    progress_msgs = [e["message"] for e in events if e["type"] == "progress"]
    assert any("Master Plan ready" in m for m in progress_msgs)


async def test_cached_blueprint_short_circuits_planning(monkeypatch, patch_pipeline_deps):
    pdf_bytes = _make_simple_pdf(2)
    cached_bp = {
        "lecture_title": "Cached",
        "overall_summary": "FROM_CACHE",
        "slide_plans": [],
        "version": 1,
    }

    async def get_bp(*_a, **_kw):
        return cached_bp

    monkeypatch.setattr(fps, "get_cached_blueprint", get_bp)

    await _drain(
        fps.parse_pdf_stream(
            pdf_bytes, filename="t.pdf", ai_model="groq", use_blueprint=True
        )
    )

    state = patch_pipeline_deps
    # generate_blueprint must not have been called
    assert state["blueprint_calls"] == 0
    # And it should not have been re-stored
    assert state["store_blueprint_calls"] == []
