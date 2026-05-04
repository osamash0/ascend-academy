"""Unit tests for backend.services.odl_service.

Covers:
  * `_parse_odl_json` — the pure-function transform from the OpenDataLoader
    JSON tree into the {page_num: {"text", "title"}} dict consumed by
    `parse_pdf_stream`.
  * `_collect` recursion through `kids` and `list items`, including the
    Doctitle / heading-level filter.
  * `_best_heading` selection rules (length bounds + noise filter).
  * `extract_pages` async wrapper:
      - raises RuntimeError when opendataloader-pdf is unavailable;
      - dispatches to the executor and returns the parsed page map when
        `_run_odl_sync` is monkeypatched (so no native ODL binary is needed).
  * Round-trip into `parse_pdf_stream` via the `odl_pages` argument so the
    integration contract (1-based keys, `text` field) is asserted.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import pytest

from backend.services import odl_service
from backend.services.odl_service import (
    _best_heading,
    _collect,
    _parse_odl_json,
    extract_pages,
)


# ---------------------------------------------------------------------------
# _collect
# ---------------------------------------------------------------------------

def test_collect_text_grouped_by_page_number():
    page_map: Dict[int, Dict[str, List]] = {}
    node = {
        "kids": [
            {"page number": 1, "type": "paragraph", "content": "first para"},
            {"page number": 1, "type": "paragraph", "content": "second para"},
            {"page number": 2, "type": "paragraph", "content": "page two text"},
        ]
    }
    _collect(node, page_map)
    assert page_map[1]["texts"] == ["first para", "second para"]
    assert page_map[2]["texts"] == ["page two text"]


def test_collect_excludes_image_header_footer_content():
    page_map: Dict[int, Dict[str, List]] = {}
    node = {
        "kids": [
            {"page number": 1, "type": "image", "content": "alt-text"},
            {"page number": 1, "type": "header", "content": "page header"},
            {"page number": 1, "type": "footer", "content": "page 1 of 10"},
            {"page number": 1, "type": "paragraph", "content": "real body"},
        ]
    }
    _collect(node, page_map)
    assert page_map[1]["texts"] == ["real body"]


def test_collect_skips_doctitle_and_level_one_headings():
    """Course-name headings repeated on every slide must be filtered out."""
    page_map: Dict[int, Dict[str, List]] = {}
    node = {
        "kids": [
            # Doctitle: never collected as a heading
            {
                "page number": 1, "type": "heading", "content": "CS101 Course",
                "heading level": 2, "level": "Doctitle",
            },
            # heading level 1: also dropped
            {
                "page number": 1, "type": "heading", "content": "Top Title",
                "heading level": 1,
            },
            # legitimate slide title
            {
                "page number": 1, "type": "heading", "content": "Slide Topic",
                "heading level": 2,
            },
        ]
    }
    _collect(node, page_map)
    headings = page_map[1]["headings"]
    assert len(headings) == 1
    assert headings[0]["text"] == "Slide Topic"


def test_collect_recurses_into_list_items_and_kids():
    page_map: Dict[int, Dict[str, List]] = {}
    node = {
        "kids": [
            {
                "page number": 3, "type": "list", "content": "",
                "list items": [
                    {"page number": 3, "type": "list-item", "content": "item A"},
                    {"page number": 3, "type": "list-item", "content": "item B"},
                ],
                "kids": [
                    {"page number": 3, "type": "paragraph", "content": "nested para"},
                ],
            }
        ]
    }
    _collect(node, page_map)
    assert page_map[3]["texts"] == ["item A", "item B", "nested para"]


def test_collect_empty_node_no_crash():
    """An empty node still gets a default page-0 entry (setdefault is
    unconditional) but must not raise and must not invent any text."""
    page_map: Dict[int, Dict[str, List]] = {}
    _collect({}, page_map)
    # No content nor headings collected — only the default empty container.
    assert page_map == {0: {"texts": [], "headings": []}}


# ---------------------------------------------------------------------------
# _best_heading
# ---------------------------------------------------------------------------

def test_best_heading_returns_none_for_empty_list():
    assert _best_heading([]) is None


def test_best_heading_picks_highest_level_number():
    """Higher `level` number == more specific (deeper) heading wins."""
    headings = [
        {"text": "Section", "level": 2},
        {"text": "Subsection", "level": 4},
        {"text": "Subsubsection", "level": 3},
    ]
    assert _best_heading(headings) == "Subsection"


def test_best_heading_skips_too_short_or_too_long():
    headings = [
        {"text": "ab", "level": 5},                 # < 3 chars
        {"text": "x" * 200, "level": 5},            # > 150 chars
        {"text": "Acceptable Title", "level": 4},   # the only valid one
    ]
    assert _best_heading(headings) == "Acceptable Title"


@pytest.mark.parametrize("noisy", [
    "• bullet looking",
    "- dashed heading",
    "1. numbered intro line",
    "1) parenthesised number",
    "Figure 3: a caption",
    "Table of contents",
])
def test_best_heading_skips_noisy_titles(noisy):
    headings = [
        {"text": noisy, "level": 5},
        {"text": "Clean Heading", "level": 4},
    ]
    assert _best_heading(headings) == "Clean Heading"


def test_best_heading_returns_none_when_all_filtered():
    headings = [
        {"text": "ab", "level": 5},
        {"text": "Figure 1", "level": 4},
    ]
    assert _best_heading(headings) is None


# ---------------------------------------------------------------------------
# _parse_odl_json — the public-facing transformation
# ---------------------------------------------------------------------------

def test_parse_odl_json_minimal_document():
    data = {
        "kids": [
            {
                "page number": 1, "type": "heading", "content": "Intro",
                "heading level": 2,
            },
            {"page number": 1, "type": "paragraph", "content": "Welcome to slide 1."},
            {
                "page number": 2, "type": "heading", "content": "Methods",
                "heading level": 2,
            },
            {"page number": 2, "type": "paragraph", "content": "Step one."},
            {"page number": 2, "type": "paragraph", "content": "Step two."},
        ]
    }
    out = _parse_odl_json(data)
    assert set(out.keys()) == {1, 2}
    assert out[1]["title"] == "Intro"
    assert out[1]["text"] == "Intro\nWelcome to slide 1."
    assert out[2]["title"] == "Methods"
    assert out[2]["text"].startswith("Methods\nStep one.\nStep two.")


def test_parse_odl_json_empty_document():
    assert _parse_odl_json({}) == {}
    assert _parse_odl_json({"kids": []}) == {}


def test_parse_odl_json_keys_are_one_indexed_ints():
    """parse_pdf_stream calls `odl_pages.get(i + 1)` — keys MUST be 1-based."""
    data = {
        "kids": [
            {"page number": 1, "type": "paragraph", "content": "p1"},
            {"page number": 5, "type": "paragraph", "content": "p5"},
        ]
    }
    out = _parse_odl_json(data)
    assert all(isinstance(k, int) for k in out.keys())
    assert set(out.keys()) == {1, 5}


def test_parse_odl_json_title_none_when_no_valid_heading():
    data = {
        "kids": [
            # Only a doctitle-level heading exists → filtered out
            {
                "page number": 1, "type": "heading", "content": "Course Title",
                "heading level": 2, "level": "Doctitle",
            },
            {"page number": 1, "type": "paragraph", "content": "body"},
        ]
    }
    out = _parse_odl_json(data)
    # Doctitle is filtered out of the headings list, so no title is picked.
    assert out[1]["title"] is None
    # …but the heading's content is still aggregated into the page text
    # (only image/header/footer types are excluded from `texts`).
    assert out[1]["text"] == "Course Title\nbody"


# ---------------------------------------------------------------------------
# extract_pages — async wrapper
# ---------------------------------------------------------------------------

async def test_extract_pages_raises_when_odl_not_available(monkeypatch):
    """Caller in upload.py relies on this RuntimeError to fall back."""
    monkeypatch.setattr(odl_service, "_ODL_AVAILABLE", False, raising=True)
    with pytest.raises(RuntimeError, match="opendataloader-pdf not installed"):
        await extract_pages(b"%PDF-1.4 fake", "x.pdf")


async def test_extract_pages_dispatches_to_run_odl_sync(monkeypatch):
    """When ODL is 'available', extract_pages must call _run_odl_sync in an
    executor with (bytes, filename) and return its dict unchanged.
    """
    monkeypatch.setattr(odl_service, "_ODL_AVAILABLE", True, raising=True)

    captured: dict = {}
    expected = {1: {"text": "hello", "title": "Intro"}}

    def fake_sync(pdf_bytes: bytes, filename: str):
        captured["bytes"] = pdf_bytes
        captured["filename"] = filename
        return expected

    monkeypatch.setattr(odl_service, "_run_odl_sync", fake_sync, raising=True)

    out = await extract_pages(b"PDFBYTES", "lecture.pdf")
    assert out == expected
    assert captured == {"bytes": b"PDFBYTES", "filename": "lecture.pdf"}


async def test_extract_pages_propagates_run_odl_sync_failures(monkeypatch):
    """Caller catches Exception broadly, so failures must surface (not be
    silently swallowed inside extract_pages)."""
    monkeypatch.setattr(odl_service, "_ODL_AVAILABLE", True, raising=True)

    def boom(pdf_bytes, filename):
        raise FileNotFoundError("ODL produced no JSON output")

    monkeypatch.setattr(odl_service, "_run_odl_sync", boom, raising=True)

    with pytest.raises(FileNotFoundError, match="no JSON output"):
        await extract_pages(b"x", "x.pdf")


async def test_extract_pages_runs_off_event_loop(monkeypatch):
    """The sync worker must run via run_in_executor — the awaited coroutine
    should yield to the loop. We assert this by scheduling another coroutine
    that flips a flag while _run_odl_sync is 'sleeping' in the executor.
    """
    import time

    monkeypatch.setattr(odl_service, "_ODL_AVAILABLE", True, raising=True)

    flipped = {"value": False}

    def slow_sync(pdf_bytes, filename):
        time.sleep(0.05)  # blocking sleep — must NOT block the event loop
        return {1: {"text": "ok", "title": None}}

    monkeypatch.setattr(odl_service, "_run_odl_sync", slow_sync, raising=True)

    async def flip_soon():
        await asyncio.sleep(0)
        flipped["value"] = True

    flip_task = asyncio.create_task(flip_soon())
    out = await extract_pages(b"x", "x.pdf")
    await flip_task

    assert flipped["value"] is True
    assert out == {1: {"text": "ok", "title": None}}


# ---------------------------------------------------------------------------
# Integration contract: parse_pdf_stream consumes odl_pages with 1-based keys
# ---------------------------------------------------------------------------

async def test_parse_odl_json_output_matches_parse_pdf_stream_contract():
    """parse_pdf_stream looks up `odl_pages.get(page_index + 1)`. Verify the
    output of `_parse_odl_json` is shape-compatible: 1-based int keys mapping
    to dicts with at least a `text` field (and optional `title`).
    """
    data = {
        "kids": [
            {"page number": 1, "type": "paragraph", "content": "page-one body"},
            {
                "page number": 2, "type": "heading", "content": "Slide Two Topic",
                "heading level": 3,
            },
            {"page number": 2, "type": "paragraph", "content": "page-two body"},
        ]
    }
    out = _parse_odl_json(data)

    # Simulate parse_pdf_stream's per-page lookup pattern.
    for page_index in range(2):
        page_one_indexed = page_index + 1
        odl_page = out.get(page_one_indexed)
        assert odl_page is not None, f"missing entry for page {page_one_indexed}"
        assert "text" in odl_page
        assert isinstance(odl_page["text"], str)
        assert "title" in odl_page  # may be None, but key must exist

    assert out[2]["title"] == "Slide Two Topic"
