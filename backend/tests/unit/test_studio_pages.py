from __future__ import annotations

import asyncio

import fitz
import pytest

from backend.services.parser import studio_pages as sp


def _pdf() -> bytes:
    d = fitz.open()
    p1 = d.new_page(width=720, height=405)
    p1.insert_text((72, 80), "Functional dependencies", fontsize=28)
    p1.insert_text((72, 140), "A determines B when equal A values imply equal B values.", fontsize=14)
    p1.insert_text((72, 390), "Papenbrock 2024", fontsize=9)
    p2 = d.new_page(width=720, height=405)
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 40, 40), False)
    pix.clear_with(200)
    p2.insert_image(fitz.Rect(20, 20, 700, 380), pixmap=pix)
    out = d.tobytes()
    d.close()
    return out


@pytest.fixture
def wired(monkeypatch):
    rows, events, stored = [], [], []

    async def upsert(lecture_id, row):
        rows.append(row)

    async def delete_after(lecture_id, last):
        events.append(("delete_after", last))

    async def store(lecture_id, page_no, webp, attempts=3):
        stored.append(page_no)
        return f"lectures/{lecture_id}/p{page_no}.webp"

    async def summarize(pages, **kw):
        return {n: [{"markdown": f"Page {n} **idea**.", "covers": [pb["blocks"][0]["id"]]}] for n, pb in pages}

    async def read_image(page, page_no, **kw):
        return {"geometry": "page", "blocks": [], "paragraphs": [{"markdown": "A picture.", "covers": []}]}

    monkeypatch.setattr(sp, "upsert_lecture_page", upsert)
    monkeypatch.setattr(sp, "delete_pages_after", delete_after)
    monkeypatch.setattr(sp, "store_page_image", store)
    monkeypatch.setattr(sp, "summarize_text_pages", summarize)
    monkeypatch.setattr(sp, "read_image_page", read_image)

    async def emit(t, data):
        events.append((t, data))

    return rows, events, stored, emit


def test_every_page_gets_a_row_a_picture_and_an_event(wired):
    rows, events, stored, emit = wired
    n = asyncio.run(sp.build_studio_pages("lid", _pdf(), lecture_title="FDs", ai_model="openai",
                                          source_language="en", emit=emit))
    assert n == 2
    assert stored == [1, 2]
    assert [r["page"] for r in rows] == [1, 2]
    text, image = rows
    assert text["geometry"] == "block" and text["status"] == "ready"
    assert text["image_path"] == "lectures/lid/p1.webp"
    assert text["summary"][0]["markdown"] == "Page 1 **idea**."
    assert image["geometry"] == "page" and image["blocks"] == []
    assert image["summary"] == [{"markdown": "A picture.", "covers": []}]
    page_events = [d for t, d in events if t == "page"]
    assert page_events == [
        {"page": 1, "total": 2, "geometry": "block", "status": "ready"},
        {"page": 2, "total": 2, "geometry": "page", "status": "ready"},
    ]
    assert ("delete_after", 2) in events


def test_a_page_without_a_summary_needs_review(wired, monkeypatch):
    rows, events, stored, emit = wired

    async def none(pages, **kw):
        return {}

    monkeypatch.setattr(sp, "summarize_text_pages", none)
    asyncio.run(sp.build_studio_pages("lid", _pdf(), lecture_title="FDs", ai_model="openai",
                                      source_language="en", emit=emit))
    assert rows[0]["summary"] == [] and rows[0]["status"] == "needs_review"
    assert rows[0]["blocks"], "blocks survive a failed summary"


def test_a_failed_picture_fails_the_pass(wired, monkeypatch):
    rows, events, stored, emit = wired

    async def broken(lecture_id, page_no, webp, attempts=3):
        raise RuntimeError("storage down")

    monkeypatch.setattr(sp, "store_page_image", broken)
    with pytest.raises(RuntimeError):
        asyncio.run(sp.build_studio_pages("lid", _pdf(), lecture_title="FDs", ai_model="openai",
                                          source_language="en", emit=emit))


def test_footers_are_never_covered(wired, monkeypatch):
    rows, events, stored, emit = wired

    async def greedy(pages, **kw):
        return {n: [{"markdown": "x", "covers": [b["id"] for b in pb["blocks"]]}] for n, pb in pages}

    monkeypatch.setattr(sp, "summarize_text_pages", greedy)
    asyncio.run(sp.build_studio_pages("lid", _pdf(), lecture_title="FDs", ai_model="openai",
                                      source_language="en", emit=emit))
    footer_ids = [b["id"] for b in rows[0]["blocks"] if b["bbox"][1] >= 0.9]
    assert footer_ids, "the test PDF has a footer"
    assert not set(footer_ids) & set(rows[0]["summary"][0]["covers"])


def test_flag_defaults_off():
    from backend.core.config import Settings
    assert Settings.model_fields["feature_studio_pages"].default is False
