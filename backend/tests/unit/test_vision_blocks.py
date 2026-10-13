from __future__ import annotations

import asyncio

import fitz

from backend.services.parser import vision_blocks as vb
from backend.services.parser.page_blocks import validate_vision_boxes, vision_blocks_to_source


def _items():
    return [
        {"kind": "heading", "text": "Normal forms", "box_2d": [50, 100, 150, 900], "confidence": 0.95},
        {"kind": "handwriting", "text": "BCNF ⇒ 3NF", "box_2d": [300, 100, 500, 600], "confidence": 0.6},
        {"kind": "paragraph", "text": "Every determinant is a key", "box_2d": [550, 100, 800, 900], "confidence": 0.9},
    ]


def test_box_2d_becomes_a_normalised_bbox():
    blocks = vision_blocks_to_source(_items(), 4)
    assert blocks[0] == {"id": "p4-b0", "page": 4, "bbox": [0.1, 0.05, 0.9, 0.15], "kind": "heading",
                         "text": "Normal forms", "confidence": 0.95, "readingOrder": 0}
    assert blocks[1]["kind"] == "handwriting"


def test_unknown_kinds_become_paragraphs_and_bad_items_are_skipped():
    blocks = vision_blocks_to_source([{"kind": "poem", "text": "x", "box_2d": [0, 0, 100, 100]},
                                      {"kind": "paragraph", "text": "y"},
                                      {"kind": "paragraph", "text": "", "box_2d": [0, 0, 10, 10]}], 1)
    assert [b["kind"] for b in blocks] == ["paragraph"]
    assert blocks[0]["id"] == "p1-b0"


def test_good_boxes_pass():
    assert validate_vision_boxes(vision_blocks_to_source(_items(), 1))


def test_boxes_must_cover_enough_of_the_page():
    tiny = [{"kind": "paragraph", "text": "a", "box_2d": [0, 0, 50, 50]}]
    assert not validate_vision_boxes(vision_blocks_to_source(tiny, 1))


def test_heavily_overlapping_boxes_fail():
    same = [{"kind": "paragraph", "text": t, "box_2d": [100, 100, 600, 900]} for t in ("a", "b")]
    assert not validate_vision_boxes(vision_blocks_to_source(same, 1))


def test_no_blocks_fail():
    assert not validate_vision_boxes([])


def _image_page():
    d = fitz.open()
    p = d.new_page(width=400, height=300)
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 40, 40), False)
    pix.clear_with(180)
    p.insert_image(fitz.Rect(20, 20, 380, 280), pixmap=pix)
    return d, p


def test_read_image_page_keeps_good_boxes(monkeypatch):
    async def fake(b64, prompt, ai_model):
        assert "box_2d" in prompt
        return {"blocks": _items(), "paragraphs": [{"markdown": "**BCNF** is strict.", "covers": [1, "p1-b1"]}]}

    monkeypatch.setattr(vb, "analyze_image_json", fake)
    d, p = _image_page()
    out = asyncio.run(vb.read_image_page(p, 1, ai_model="openai", lecture_title="T", source_language="en"))
    assert out["geometry"] == "block"
    assert len(out["blocks"]) == 3
    assert out["paragraphs"] == [{"markdown": "**BCNF** is strict.", "covers": ["p1-b1"]}]


def test_read_image_page_drops_bad_boxes_but_keeps_the_summary(monkeypatch):
    async def fake(b64, prompt, ai_model):
        return {"blocks": [{"kind": "paragraph", "text": "a", "box_2d": [0, 0, 20, 20]}],
                "paragraphs": [{"markdown": "Kept.", "covers": ["p1-b0"]}]}

    monkeypatch.setattr(vb, "analyze_image_json", fake)
    d, p = _image_page()
    out = asyncio.run(vb.read_image_page(p, 1, ai_model="openai", lecture_title="T", source_language="en"))
    assert out == {"geometry": "page", "blocks": [], "paragraphs": [{"markdown": "Kept.", "covers": []}]}


def test_read_image_page_survives_a_dead_provider(monkeypatch):
    async def fake(b64, prompt, ai_model):
        return {}

    monkeypatch.setattr(vb, "analyze_image_json", fake)
    d, p = _image_page()
    out = asyncio.run(vb.read_image_page(p, 1, ai_model="openai", lecture_title="T", source_language="en"))
    assert out == {"geometry": "page", "blocks": [], "paragraphs": []}


def test_ids_keep_the_models_own_index_and_dropped_ids_are_not_coverable():
    from backend.services.parser.studio_summary import clean_paragraphs

    items = [
        {"kind": "paragraph", "text": "A", "box_2d": [0, 0, 100, 100]},
        {"kind": "paragraph", "text": "B but no box"},
        {"kind": "paragraph", "text": "C", "box_2d": [200, 0, 300, 100]},
    ]
    blocks = vision_blocks_to_source(items, 1)
    assert [b["id"] for b in blocks] == ["p1-b0", "p1-b2"]
    assert [b["readingOrder"] for b in blocks] == [0, 1]
    allowed = {b["id"] for b in blocks}
    paras = clean_paragraphs([{"markdown": "x", "covers": ["p1-b1", "p1-b2"]}], allowed)
    assert paras[0]["covers"] == ["p1-b2"]


def test_out_of_range_box_is_rejected_not_clamped():
    items = [{"kind": "paragraph", "text": "A", "box_2d": [0, 0, 1200, 100]},
             {"kind": "paragraph", "text": "B", "box_2d": [-5, 0, 100, 100]},
             {"kind": "paragraph", "text": "C", "box_2d": [0, 0, 100, 100]}]
    assert [b["id"] for b in vision_blocks_to_source(items, 1)] == ["p1-b2"]


def test_sync_vision_fallback_shapes(monkeypatch):
    from backend.services.ai import vision

    monkeypatch.setattr(vision, "gemini_client", None)
    monkeypatch.setattr(vision, "groq_client", None)
    monkeypatch.setattr(vision, "openai_client", None)
    assert vision._sync_analyze_vision("x") == vision._FALLBACK_RESULT
    assert vision._sync_analyze_vision("x", prompt_override="p") == {}
