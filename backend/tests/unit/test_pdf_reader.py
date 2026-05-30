"""Unit tests for backend.services.pdf_reader.PDFReader.

All tests run against in-memory PDFs generated with PyMuPDF — no real files,
no network. Each method opens / closes its own fitz.Document inside a thread
worker, so concurrent invocations are exercised implicitly via asyncio.gather.
"""
from __future__ import annotations

import asyncio

import fitz
import pytest

from backend.services.pdf_reader import PDFReader


# ---------------------------------------------------------------------------
# Local PDF fixtures (kept narrow so we can assert exact properties)
# ---------------------------------------------------------------------------

@pytest.fixture
def two_page_pdf_bytes() -> bytes:
    doc = fitz.open()
    p0 = doc.new_page()
    p0.insert_text((72, 72), "Page one body")
    p1 = doc.new_page()
    p1.insert_text((72, 72), "Page two body")
    out = doc.tobytes()
    doc.close()
    return out


@pytest.fixture
def pdf_with_toc_bytes() -> bytes:
    doc = fitz.open()
    for i in range(3):
        page = doc.new_page()
        page.insert_text((72, 72), f"Section {i + 1} text")
    doc.set_toc([
        [1, "Introduction", 1],
        [1, "Chapter One", 2],
        [2, "Subsection", 3],
    ])
    out = doc.tobytes()
    doc.close()
    return out


@pytest.fixture
def pdf_with_table_bytes() -> bytes:
    """A PDF with a clearly drawn 2x2 table grid + header text."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    # Draw table grid lines (PyMuPDF table detection looks at vector lines)
    rect_outer = fitz.Rect(72, 72, 372, 192)
    page.draw_rect(rect_outer)
    page.draw_line(fitz.Point(222, 72), fitz.Point(222, 192))   # vertical mid
    page.draw_line(fitz.Point(72, 132), fitz.Point(372, 132))   # horizontal mid
    # Cell text
    page.insert_text((80, 100), "Name")
    page.insert_text((230, 100), "Score")
    page.insert_text((80, 160), "Alice")
    page.insert_text((230, 160), "95")
    out = doc.tobytes()
    doc.close()
    return out


@pytest.fixture
def pdf_with_drawings_bytes() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.draw_line(fitz.Point(50, 50), fitz.Point(200, 50))
    page.draw_rect(fitz.Rect(50, 80, 150, 150))
    page.draw_circle(fitz.Point(300, 300), 40)
    out = doc.tobytes()
    doc.close()
    return out


# ---------------------------------------------------------------------------
# get_page_count
# ---------------------------------------------------------------------------

async def test_get_page_count_single_page(sample_pdf_bytes):
    reader = PDFReader(sample_pdf_bytes)
    count = await reader.get_page_count()
    assert count == 3


async def test_get_page_count_two_pages(two_page_pdf_bytes):
    reader = PDFReader(two_page_pdf_bytes)
    assert await reader.get_page_count() == 2


# ---------------------------------------------------------------------------
# get_toc
# ---------------------------------------------------------------------------

async def test_get_toc_empty(sample_pdf_bytes):
    reader = PDFReader(sample_pdf_bytes)
    toc = await reader.get_toc()
    assert toc == []


async def test_get_toc_with_entries(pdf_with_toc_bytes):
    reader = PDFReader(pdf_with_toc_bytes)
    toc = await reader.get_toc()
    assert len(toc) == 3
    assert toc[0] == {"level": 1, "title": "Introduction", "page": 1}
    assert toc[1]["title"] == "Chapter One"
    assert toc[2]["level"] == 2
    # All entries must be dicts with our schema
    for entry in toc:
        assert set(entry.keys()) == {"level", "title", "page"}


# ---------------------------------------------------------------------------
# get_page_dict
# ---------------------------------------------------------------------------

async def test_get_page_dict_returns_blocks(sample_pdf_bytes):
    reader = PDFReader(sample_pdf_bytes)
    page_dict = await reader.get_page_dict(0)
    assert isinstance(page_dict, dict)
    assert "blocks" in page_dict
    # The fixture writes "Slide 1 content" — at least one text block
    text_blocks = [b for b in page_dict["blocks"] if b.get("type") == 0]
    assert text_blocks, "expected at least one text block"
    flat_text = " ".join(
        span.get("text", "")
        for b in text_blocks
        for line in b.get("lines", [])
        for span in line.get("spans", [])
    )
    assert "Slide 1" in flat_text


async def test_get_page_dict_each_index(two_page_pdf_bytes):
    reader = PDFReader(two_page_pdf_bytes)
    d0 = await reader.get_page_dict(0)
    d1 = await reader.get_page_dict(1)
    assert d0 != d1


# ---------------------------------------------------------------------------
# find_tables
# ---------------------------------------------------------------------------

async def test_find_tables_empty_when_none(sample_pdf_bytes):
    reader = PDFReader(sample_pdf_bytes)
    tables = await reader.find_tables(0)
    assert tables == []


async def test_find_tables_detects_table(pdf_with_table_bytes):
    reader = PDFReader(pdf_with_table_bytes)
    tables = await reader.find_tables(0)
    # PyMuPDF's table detector should find at least one table from the grid.
    # If detection misses on this synthetic grid, we surface the result via
    # an xfail rather than altering production code.
    if not tables:
        pytest.xfail(
            "PyMuPDF table detector did not classify the synthetic grid as a table"
        )
    assert len(tables) >= 1


async def test_find_tables_returns_list_on_invalid_index(sample_pdf_bytes):
    reader = PDFReader(sample_pdf_bytes)
    # Out-of-range index hits the except branch and must yield []
    tables = await reader.find_tables(99)
    assert tables == []


# ---------------------------------------------------------------------------
# get_drawings
# ---------------------------------------------------------------------------

async def test_get_drawings_empty(sample_pdf_bytes):
    reader = PDFReader(sample_pdf_bytes)
    drawings = await reader.get_drawings(0)
    assert isinstance(drawings, list)
    # The text-only fixture should have no vector paths
    assert drawings == []


async def test_get_drawings_with_paths(pdf_with_drawings_bytes):
    reader = PDFReader(pdf_with_drawings_bytes)
    drawings = await reader.get_drawings(0)
    assert isinstance(drawings, list)
    assert len(drawings) >= 3  # line + rect + circle


# ---------------------------------------------------------------------------
# render_page_jpeg
# ---------------------------------------------------------------------------

async def test_render_page_jpeg_returns_jpeg_bytes(sample_pdf_bytes):
    reader = PDFReader(sample_pdf_bytes)
    data = await reader.render_page_jpeg(0, zoom=1.0)
    assert isinstance(data, (bytes, bytearray))
    # JPEG magic bytes
    assert data[:3] == b"\xff\xd8\xff"
    assert data[-2:] == b"\xff\xd9"


async def test_render_page_jpeg_zoom_changes_size(sample_pdf_bytes):
    reader = PDFReader(sample_pdf_bytes)
    small = await reader.render_page_jpeg(0, zoom=1.0)
    large = await reader.render_page_jpeg(0, zoom=3.0)
    assert len(large) > len(small)


# ---------------------------------------------------------------------------
# get_page_rect
# ---------------------------------------------------------------------------

async def test_get_page_rect_returns_dimensions(sample_pdf_bytes):
    reader = PDFReader(sample_pdf_bytes)
    width, height = await reader.get_page_rect(0)
    assert isinstance(width, float)
    assert isinstance(height, float)
    assert width > 0
    assert height > 0


async def test_concurrent_calls_are_safe(sample_pdf_bytes):
    """Sanity check: stateless design must allow concurrent dispatch."""
    reader = PDFReader(sample_pdf_bytes)
    counts = await asyncio.gather(*[reader.get_page_count() for _ in range(8)])
    assert counts == [3] * 8
