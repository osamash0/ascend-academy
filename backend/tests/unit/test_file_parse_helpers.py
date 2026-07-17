"""Unit tests for the deterministic helpers in file_parse_service.

These pure functions shape the text sent to the LLM and the slides shown on
failure/skip — no I/O, no model calls. We assert batch assembly (ODL/OCR
injection + context flagging), embedding-text selection, header/footer
detection, title heuristics, and the fallback slide shape.
"""
from __future__ import annotations

from backend.services import file_parse_service as fps
from backend.services.layout_analyzer import PageLayout


def _layout(index: int, raw_text: str = "", odl_table_md: str = "", **overrides) -> PageLayout:
    base = dict(
        index=index, page_number=index + 1, word_count=len(raw_text.split()),
        alpha_ratio=1.0, image_coverage=0.0, drawing_count=0, has_table=False,
        column_count=1, has_code_block=False, has_math=False,
        raw_text=raw_text, odl_table_md=odl_table_md,
    )
    base.update(overrides)
    return PageLayout(**base)


# ── _build_text_batch ─────────────────────────────────────────────────────────

def test_build_text_batch_plain_text():
    layouts = {0: _layout(0, "slide zero"), 1: _layout(1, "slide one")}
    out = fps._build_text_batch([0, 1], layouts, [], "cerebras")
    assert [e["index"] for e in out] == [0, 1]
    assert out[0]["page_number"] == 1
    assert out[0]["text"] == "slide zero"
    assert "context_only" not in out[0]


def test_build_text_batch_injects_odl_table_markdown():
    layouts = {0: _layout(0, "raw", odl_table_md="| a | b |\n|---|---|")}
    out = fps._build_text_batch([0], layouts, odl_table_indices=[0], ai_model="cerebras")
    assert "structured table" in out[0]["text"]
    assert "| a | b |" in out[0]["text"]


def test_build_text_batch_injects_ocr_override():
    layouts = {0: _layout(0, "garbled� text")}
    out = fps._build_text_batch(
        [0], layouts, [], "cerebras", ocr_overrides={0: "clean OCR text"}
    )
    assert "OCR fallback applied" in out[0]["text"]
    assert "clean OCR text" in out[0]["text"]


def test_build_text_batch_flags_context_only_prefix():
    layouts = {i: _layout(i, f"s{i}") for i in range(3)}
    out = fps._build_text_batch([0, 1, 2], layouts, [], "cerebras", context_count=2)
    assert out[0]["context_only"] is True
    assert out[1]["context_only"] is True
    assert "context_only" not in out[2]  # the real target


# ── _make_fallback_slide ──────────────────────────────────────────────────────

def test_make_fallback_slide_shape_and_truncation():
    slide = fps._make_fallback_slide(4, "x" * 900)
    assert slide["index"] == 4
    assert slide["slide_index"] == 4
    assert slide["title"] == "Slide 5"
    assert len(slide["content"]) == 500
    assert slide["parse_error"] == "processing_failed"
    assert slide["questions"] == []


def test_make_fallback_slide_empty_text():
    slide = fps._make_fallback_slide(0, "")
    assert slide["content"] == ""


# ── _build_embedding_text ─────────────────────────────────────────────────────

def test_embedding_text_combines_title_summary_content():
    text = fps._build_embedding_text(
        {"title": "Hashing", "summary": "a summary", "content": "the body"}
    )
    assert text == "Hashing\n\na summary\n\nthe body"


def test_embedding_text_skips_placeholder_title():
    text = fps._build_embedding_text({"title": "Slide 7", "content": "body"})
    assert "Slide 7" not in text
    assert text == "body"


def test_embedding_text_truncates_long_content():
    text = fps._build_embedding_text({"title": "T", "content": "y" * 5000})
    # title + \n\n + 2400 chars of content
    assert len(text) == len("T") + 2 + 2400


def test_embedding_text_empty_when_no_usable_text():
    assert fps._build_embedding_text({"title": "Slide 3", "content": "", "summary": ""}) == ""


# ── _detect_repeating_lines ──────────────────────────────────────────────────

def test_detect_repeating_lines_returns_empty_for_small_deck():
    layouts = {i: _layout(i, "Course Header\nunique line") for i in range(3)}  # < 4 pages
    assert fps._detect_repeating_lines(layouts) == frozenset()


def test_detect_repeating_lines_flags_common_header():
    # 5 pages; "Course Header" on all → repeats; body lines are unique.
    layouts = {
        i: _layout(i, f"Course Header\nunique body line {i}") for i in range(5)
    }
    repeats = fps._detect_repeating_lines(layouts)
    assert "Course Header" in repeats
    assert "unique body line 0" not in repeats


def test_detect_repeating_lines_ignores_short_lines():
    # "ab" is <= 2 chars → never counted even if it repeats everywhere.
    layouts = {i: _layout(i, "ab\nReal Repeating Footer") for i in range(5)}
    repeats = fps._detect_repeating_lines(layouts)
    assert "ab" not in repeats
    assert "Real Repeating Footer" in repeats


# ── _title_from_layout ────────────────────────────────────────────────────────

def test_title_from_layout_uses_first_meaningful_line():
    assert fps._title_from_layout(_layout(0, "Binary Trees\nbody"), 0) == "Binary Trees"


def test_title_from_layout_skips_repeating_lines():
    skip = frozenset({"Course Header"})
    title = fps._title_from_layout(_layout(2, "Course Header\nActual Topic"), 2, skip)
    assert title == "Actual Topic"


def test_title_from_layout_falls_back_when_only_skip_lines():
    # Every non-empty line is a skip line → fall back to the first line.
    skip = frozenset({"Course Header"})
    title = fps._title_from_layout(_layout(0, "Course Header"), 0, skip)
    assert title == "Course Header"


def test_title_from_layout_placeholder_when_empty():
    assert fps._title_from_layout(_layout(6, ""), 6) == "Slide 7"


def test_title_from_layout_truncates_to_80_chars():
    long_title = "T" * 200
    assert fps._title_from_layout(_layout(0, long_title), 0) == "T" * 80
