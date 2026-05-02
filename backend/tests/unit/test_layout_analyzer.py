"""Unit tests for backend.services.layout_analyzer.

Covers:
  * Pure helper functions (column detection, alpha ratio, image coverage,
    code block / math detection, ODL markdown extraction).
  * The async ``analyze_page_layout_async`` round-trip on generated PDFs,
    including the error-fallback branch.
"""
from __future__ import annotations

import fitz
import pytest

from backend.services.layout_analyzer import (
    PageLayout,
    _compute_alpha_ratio,
    _compute_image_coverage,
    _detect_code_block,
    _detect_column_count,
    _detect_math,
    _extract_odl_table_md,
    analyze_page_layout_async,
)
from backend.services.pdf_reader import PDFReader


# ---------------------------------------------------------------------------
# _compute_image_coverage
# ---------------------------------------------------------------------------

def _img_block(x0: float, y0: float, x1: float, y1: float) -> dict:
    return {"type": 1, "bbox": [x0, y0, x1, y1]}


def _text_block(x0: float, y0: float, x1: float, y1: float, text: str = "hi", font: str = "Helvetica") -> dict:
    return {
        "type": 0,
        "bbox": [x0, y0, x1, y1],
        "lines": [{"spans": [{"text": text, "font": font}]}],
    }


def test_image_coverage_zero_area_returns_zero():
    assert _compute_image_coverage([_img_block(0, 0, 100, 100)], page_area=0) == 0.0


def test_image_coverage_only_qualifying_images_counted():
    page_area = 1000.0
    blocks = [
        # tiny image (2% of page) — excluded (< 5% threshold)
        _img_block(0, 0, 5, 4),    # area = 20
        # large image (40% of page) — included
        _img_block(0, 0, 20, 20),  # area = 400
        # text block — never counted
        _text_block(0, 0, 100, 100),
    ]
    coverage = _compute_image_coverage(blocks, page_area)
    assert coverage == pytest.approx(0.4, abs=1e-6)


def test_image_coverage_clamped_to_one():
    page_area = 100.0
    huge = _img_block(0, 0, 50, 50)  # area = 2500 > page_area
    assert _compute_image_coverage([huge], page_area) == 1.0


def test_image_coverage_no_blocks():
    assert _compute_image_coverage([], 1000.0) == 0.0


# ---------------------------------------------------------------------------
# _detect_column_count
# ---------------------------------------------------------------------------

def test_column_count_empty_input():
    assert _detect_column_count([], 612) == 1


def test_column_count_zero_page_width():
    assert _detect_column_count([10, 200], 0) == 1


def test_column_count_single_column():
    # All x-origins clustered near the left margin
    xs = [72, 75, 73, 74]
    assert _detect_column_count(xs, page_width=612) == 1


def test_column_count_two_columns():
    # Gap > 15% of 612 (= 91.8) between left and right column starts
    xs = [72, 75, 320, 322]
    assert _detect_column_count(xs, page_width=612) == 2


def test_column_count_three_columns_capped():
    xs = [50, 250, 450, 600]  # 4 columns; should be capped at 3
    assert _detect_column_count(xs, page_width=612) == 3


# ---------------------------------------------------------------------------
# _compute_alpha_ratio
# ---------------------------------------------------------------------------

def test_alpha_ratio_empty_text_returns_one():
    assert _compute_alpha_ratio("") == 1.0


def test_alpha_ratio_pure_letters():
    assert _compute_alpha_ratio("hello") == 1.0


def test_alpha_ratio_pure_digits():
    assert _compute_alpha_ratio("12345") == 0.0


def test_alpha_ratio_mixed():
    # 4 letters + 2 digits => 4/6
    assert _compute_alpha_ratio("abcd12") == pytest.approx(4 / 6)


def test_alpha_ratio_unicode_letters_count():
    # Greek letters count as 'L' too
    assert _compute_alpha_ratio("αβγ") == 1.0
    # Cyrillic
    assert _compute_alpha_ratio("привет") == 1.0


def test_alpha_ratio_punctuation_ignored():
    # Punctuation/whitespace has no L or Nd category
    assert _compute_alpha_ratio("...   ") == 1.0


# ---------------------------------------------------------------------------
# _detect_code_block
# ---------------------------------------------------------------------------

def test_detect_code_block_true_for_monospace_font():
    blocks = [_text_block(0, 0, 10, 10, text="x = 1", font="CourierNew")]
    assert _detect_code_block(blocks) is True


def test_detect_code_block_true_for_consolas():
    blocks = [_text_block(0, 0, 10, 10, font="Consolas-Bold")]
    assert _detect_code_block(blocks) is True


def test_detect_code_block_false_for_proportional_font():
    blocks = [_text_block(0, 0, 10, 10, font="Helvetica")]
    assert _detect_code_block(blocks) is False


def test_detect_code_block_skips_image_blocks():
    blocks = [{"type": 1, "bbox": [0, 0, 10, 10]}]
    assert _detect_code_block(blocks) is False


# ---------------------------------------------------------------------------
# _detect_math
# ---------------------------------------------------------------------------

def test_detect_math_greek_letter():
    assert _detect_math("Let α = 0.5") is True


def test_detect_math_operator_symbol():
    assert _detect_math("∀x ∈ S") is True


def test_detect_math_keyword_only():
    assert _detect_math("Theorem of large numbers") is True


def test_detect_math_lowercase_keyword():
    assert _detect_math("the gradient descent algorithm") is True


def test_detect_math_plain_prose_false():
    assert _detect_math("The cat sat on the mat") is False


# ---------------------------------------------------------------------------
# _extract_odl_table_md
# ---------------------------------------------------------------------------

def test_odl_table_md_none_input_returns_empty_string():
    assert _extract_odl_table_md(None) == ""
    assert _extract_odl_table_md({}) == ""


def test_odl_table_md_direct_table_type():
    page = {"type": "table", "content": "| A | B |\n| 1 | 2 |"}
    out = _extract_odl_table_md(page)
    assert out.startswith("| A | B |")


def test_odl_table_md_table_type_text_field_fallback():
    page = {"type": "table", "text": "| col1 | col2 |\n|--|--|"}
    assert "col1" in _extract_odl_table_md(page)


def test_odl_table_md_table_type_no_pipes_returns_empty():
    page = {"type": "table", "content": "no pipe characters here"}
    assert _extract_odl_table_md(page) == ""


def test_odl_table_md_tables_list():
    page = {
        "tables": [
            {"markdown": "| A | B |\n| 1 | 2 |"},
            {"content": "| C | D |\n| 3 | 4 |"},
        ]
    }
    out = _extract_odl_table_md(page)
    assert "| A | B |" in out
    assert "| C | D |" in out


def test_odl_table_md_tables_skips_entries_without_pipes():
    page = {"tables": [{"markdown": "no pipes here"}]}
    assert _extract_odl_table_md(page) == ""


def test_odl_table_md_text_looks_like_table():
    page = {"text": "| a | b |\n|--|--|\n| 1 | 2 |"}
    out = _extract_odl_table_md(page)
    assert out.startswith("|")


def test_odl_table_md_text_too_few_pipes():
    page = {"text": "just two | pipes\nand a newline"}
    assert _extract_odl_table_md(page) == ""


# ---------------------------------------------------------------------------
# analyze_page_layout_async — round trip
# ---------------------------------------------------------------------------

def _make_two_column_pdf() -> bytes:
    """Two real columns of text on a US-letter page (612 pt wide)."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    # Left column (x ~ 72)
    for i, line in enumerate([
        "Left column line one with several words.",
        "Left column line two continues the topic.",
        "Left column line three keeps going for words.",
    ]):
        page.insert_text((72, 100 + i * 20), line)
    # Right column (x ~ 340 — gap of 268 > 91.8 (15% of 612))
    for i, line in enumerate([
        "Right column line one introduces ideas.",
        "Right column line two adds more details.",
        "Right column line three wraps the column.",
    ]):
        page.insert_text((340, 100 + i * 20), line)
    out = doc.tobytes()
    doc.close()
    return out


async def test_analyze_page_layout_two_columns():
    pdf_bytes = _make_two_column_pdf()
    reader = PDFReader(pdf_bytes)
    layout = await analyze_page_layout_async(reader, 0)

    assert isinstance(layout, PageLayout)
    assert layout.index == 0
    assert layout.page_number == 1
    assert layout.column_count == 2
    assert layout.word_count > 0
    # Reading order: all of left column should come before all of right column
    text = layout.raw_text
    assert "Left column" in text
    assert "Right column" in text
    left_pos = text.find("Left column line one")
    right_pos = text.find("Right column line one")
    assert 0 <= left_pos < right_pos, (
        f"column-ordered text should put left before right; got: {text!r}"
    )
    assert layout.alpha_ratio > 0.5
    assert layout.image_coverage == 0.0
    assert layout.has_table is False
    assert layout.has_code_block is False
    assert layout.odl_table_md == ""


async def test_analyze_page_layout_single_column(sample_pdf_bytes):
    reader = PDFReader(sample_pdf_bytes)
    layout = await analyze_page_layout_async(reader, 0)
    assert layout.column_count == 1
    assert "Slide 1" in layout.raw_text


async def test_analyze_page_layout_invalid_index_returns_fallback(sample_pdf_bytes):
    """Out-of-range page index hits the except branch → safe fallback PageLayout."""
    reader = PDFReader(sample_pdf_bytes)
    layout = await analyze_page_layout_async(reader, 99)
    assert layout.index == 99
    assert layout.page_number == 100
    assert layout.word_count == 0
    assert layout.alpha_ratio == 1.0
    assert layout.image_coverage == 0.0
    assert layout.drawing_count == 0
    assert layout.has_table is False
    assert layout.column_count == 1
    assert layout.raw_text == ""
    assert layout.odl_table_md == ""


async def test_analyze_page_layout_passes_odl_data(sample_pdf_bytes):
    reader = PDFReader(sample_pdf_bytes)
    odl = {"type": "table", "content": "| a | b |\n| 1 | 2 |"}
    layout = await analyze_page_layout_async(reader, 0, odl_page=odl)
    assert "| a | b |" in layout.odl_table_md
