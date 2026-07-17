"""Unit tests for backend.services.deterministic_extractor.

The deterministic (zero-LLM) extractor turns a Pass-1 ``PageLayout`` into an
AI-pipeline-shaped slide dict using only heuristics. Everything here is pure —
no I/O, no LLM — so we assert the exact title/content splitting, the truncation
guard, metadata routing, and the telemetry ``_meta`` block.
"""
from __future__ import annotations

from backend.services.layout_analyzer import PageLayout
from backend.services.slide_classifier import (
    ROUTE_SKIP,
    ROUTE_TEXT,
    RoutingManifest,
)
from backend.services import deterministic_extractor as de


def _layout(index: int = 0, raw_text: str = "", **overrides) -> PageLayout:
    base = dict(
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
    base.update(overrides)
    return PageLayout(**base)


# ── _split_first_nonempty_line ────────────────────────────────────────────────

def test_split_empty_text():
    assert de._split_first_nonempty_line("") == ("", "")


def test_split_peels_first_line():
    title, rest = de._split_first_nonempty_line("Intro to Graphs\nnodes and edges\nmore")
    assert title == "Intro to Graphs"
    assert rest == "nodes and edges\nmore"


def test_split_skips_leading_blank_lines():
    title, rest = de._split_first_nonempty_line("\n   \nReal Title\nbody")
    assert title == "Real Title"
    assert rest == "body"


def test_split_all_whitespace_returns_empty_title_with_original():
    raw = "   \n\t\n  "
    title, rest = de._split_first_nonempty_line(raw)
    assert title == ""
    assert rest == raw


# ── _looks_like_title ─────────────────────────────────────────────────────────

def test_looks_like_title_accepts_short_phrase():
    assert de._looks_like_title("Dynamic Programming") is True


def test_looks_like_title_rejects_empty():
    assert de._looks_like_title("") is False


def test_looks_like_title_rejects_overlong_char_count():
    assert de._looks_like_title("x" * 141) is False


def test_looks_like_title_rejects_too_many_words():
    assert de._looks_like_title(" ".join(["word"] * 17)) is False


def test_looks_like_title_rejects_sentence_with_terminal_punctuation():
    sentence = "This is clearly a full sentence that ends with a period here."
    assert len(sentence.split()) > 8
    assert de._looks_like_title(sentence) is False


def test_looks_like_title_accepts_short_line_ending_in_period():
    # Terminal punctuation only disqualifies when the line is also long (>8 words).
    assert de._looks_like_title("Fig. 1.") is True


# ── build_slide_from_layout ───────────────────────────────────────────────────

def test_build_slide_uses_first_line_as_title():
    slide = de.build_slide_from_layout(
        _layout(0, "Hashing\nchaining vs open addressing"), "deck.pdf"
    )
    assert slide["title"] == "Hashing"
    assert slide["content"] == "chaining vs open addressing"
    assert slide["slide_type"] == "content"
    assert slide["is_metadata"] is False
    assert slide["ai_enhanced"] is False
    assert slide["summary"] == ""
    assert slide["questions"] == []


def test_build_slide_falls_back_to_placeholder_title_and_keeps_full_text():
    # First line is a long sentence → not title-shaped → keep everything as content.
    raw = "This paragraph is not shaped like a title at all and runs long enough."
    slide = de.build_slide_from_layout(_layout(4, raw), "deck.pdf")
    assert slide["title"] == "Slide 5"           # 0-based index 4 → page 5
    assert slide["content"] == raw               # full text preserved


def test_build_slide_truncates_long_content():
    body = "y" * 7000
    slide = de.build_slide_from_layout(_layout(0, "Title\n" + body), "deck.pdf")
    assert len(slide["content"]) <= de._CONTENT_MAX_CHARS + 1  # +1 for the ellipsis
    assert slide["content"].endswith("…")


def test_build_slide_metadata_sets_skip_route():
    slide = de.build_slide_from_layout(
        _layout(0, "Prof. Smith\noffice hours"), "deck.pdf", is_metadata=True
    )
    assert slide["slide_type"] == "metadata"
    assert slide["is_metadata"] is True
    assert slide["_meta"]["route"] == ROUTE_SKIP


def test_build_slide_content_sets_text_route():
    slide = de.build_slide_from_layout(_layout(0, "Topic\nbody"), "deck.pdf")
    assert slide["_meta"]["route"] == ROUTE_TEXT


def test_build_slide_route_reason_from_manifest():
    manifest = RoutingManifest()
    manifest.reasons[2] = "image_coverage_high"
    slide = de.build_slide_from_layout(_layout(2, "T\nb"), "deck.pdf", manifest=manifest)
    assert slide["_meta"]["route_reason"] == "image_coverage_high"


def test_build_slide_route_reason_defaults_without_manifest():
    slide = de.build_slide_from_layout(_layout(0, "T\nb"), "deck.pdf")
    assert slide["_meta"]["route_reason"] == "deterministic_extractor"


def test_build_slide_meta_block_fields():
    layout = _layout(1, "Recursion\ndetails here", column_count=2, has_math=True, has_code_block=True)
    slide = de.build_slide_from_layout(layout, "lecture.pdf")
    meta = slide["_meta"]
    assert meta["filename"] == "lecture.pdf"
    assert meta["page"] == 2
    assert meta["engine"] == de.ENGINE_NAME
    assert meta["tokens"] == layout.word_count * 4
    assert meta["column_count"] == 2
    assert meta["has_math"] is True
    assert meta["has_code"] is True
    assert meta["parsing_mode"] == "on_demand"
    assert "layout_features" in meta


# ── build_slides_from_layouts ────────────────────────────────────────────────

def test_build_slides_bulk_sorted_and_metadata_flags_applied():
    layouts = {
        2: _layout(2, "Third\nc"),
        0: _layout(0, "First\na"),
        1: _layout(1, "Second\nb"),
    }
    flags = {1: True}
    slides = de.build_slides_from_layouts(layouts, "deck.pdf", metadata_flags=flags)
    assert [s["index"] for s in slides] == [0, 1, 2]  # sorted ascending
    assert slides[1]["is_metadata"] is True
    assert slides[1]["slide_type"] == "metadata"
    assert slides[0]["is_metadata"] is False


def test_build_slides_empty_input():
    assert de.build_slides_from_layouts({}, "deck.pdf") == []
