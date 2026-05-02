"""Unit tests for slide_utils.extract_visual_title."""
import fitz

from backend.services.slide_utils import extract_visual_title


def _page_with_title(title: str, body: str = "") -> fitz.Page:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 60), title, fontsize=24)  # near top, large font
    if body:
        page.insert_text((72, 300), body, fontsize=10)
    return page


def test_returns_title_at_top():
    page = _page_with_title("Cellular Respiration")
    title = extract_visual_title(page)
    assert "Cellular Respiration" in title


def test_strips_leading_number():
    page = _page_with_title("1. Introduction")
    title = extract_visual_title(page)
    # Leading "1. " should be stripped
    assert not title.startswith("1.")
    assert "Introduction" in title


def test_empty_page_returns_empty():
    doc = fitz.open()
    page = doc.new_page()
    assert extract_visual_title(page) == ""


def test_title_truncated_at_120_chars():
    long_title = "A" * 200
    page = _page_with_title(long_title)
    title = extract_visual_title(page)
    assert len(title) <= 120
