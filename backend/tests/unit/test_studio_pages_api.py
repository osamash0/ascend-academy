from __future__ import annotations

import asyncio

import pytest

from backend.services import studio_pages_service as svc


ROWS = [
    {"page": 1, "width": 720.0, "height": 405.0, "image_path": "lectures/L/p1.webp", "geometry": "block",
     "blocks": [{"id": "p1-b0", "page": 1, "bbox": [0.1, 0.1, 0.9, 0.2], "kind": "heading",
                 "text": "FDs", "readingOrder": 0}],
     "summary": [{"markdown": "**FDs** first.", "covers": ["p1-b0"]},
                 {"markdown": "Then keys.", "covers": []}],
     "status": "ready"},
    {"page": 2, "width": 720.0, "height": 405.0, "image_path": "lectures/L/p2.webp", "geometry": "page",
     "blocks": [], "summary": [], "status": "needs_review"},
]


def test_shape_matches_studio_types():
    signed = {"lectures/L/p1.webp": "https://s/1", "lectures/L/p2.webp": "https://s/2"}
    out = svc.shape_pages("L", ROWS, signed)
    assert out["materialId"] == "L"
    assert out["pages"][0] == {"materialId": "L", "page": 1, "width": 720.0, "height": 405.0,
                               "imageUrl": "https://s/1", "geometry": "block", "blocks": ROWS[0]["blocks"]}
    assert out["pages"][1]["blocks"] == [] and out["pages"][1]["geometry"] == "page"
    assert out["summaries"] == [
        {"id": "s-p1-1", "origin": "summary", "markdown": "**FDs** first.",
         "source": {"materialId": "L", "page": 1, "blockIds": ["p1-b0"]}, "gist": True, "edited": False},
        {"id": "s-p1-2", "origin": "summary", "markdown": "Then keys.",
         "source": {"materialId": "L", "page": 1, "blockIds": []}, "gist": False, "edited": False},
    ]


def test_stage_mapping():
    assert svc.stage_of("pending") == "developing"
    assert svc.stage_of("running") == "developing"
    assert svc.stage_of("completed") == "ready"
    assert svc.stage_of("failed") == "failed"
    assert svc.stage_of(None) == "developing"


def test_get_pages_404_when_not_visible(monkeypatch):
    async def no(lid, uid):
        return False

    monkeypatch.setattr(svc, "can_view_lecture", no)
    with pytest.raises(svc.NotVisible):
        asyncio.run(svc.get_pages("00000000-0000-0000-0000-000000000001", "u"))


def test_get_pages_409_while_developing(monkeypatch):
    async def yes(lid, uid):
        return True

    async def total(lid):
        return 0

    monkeypatch.setattr(svc, "can_view_lecture", yes)
    monkeypatch.setattr(svc, "_total_pages", total)
    with pytest.raises(svc.StillDeveloping):
        asyncio.run(svc.get_pages("00000000-0000-0000-0000-000000000001", "u"))


def test_get_pages_404_without_studio_pages(monkeypatch):
    async def yes(lid, uid):
        return True

    async def total(lid):
        return 12

    async def rows(lid):
        return []

    monkeypatch.setattr(svc, "can_view_lecture", yes)
    monkeypatch.setattr(svc, "_total_pages", total)
    monkeypatch.setattr(svc, "_rows", rows)
    with pytest.raises(svc.NotVisible):
        asyncio.run(svc.get_pages("00000000-0000-0000-0000-000000000001", "u"))


def test_get_pages_signs_every_picture(monkeypatch):
    async def yes(lid, uid):
        return True

    async def total(lid):
        return 2

    async def rows(lid):
        return ROWS

    async def sign(paths):
        return {p: f"https://signed/{p}" for p in paths}

    monkeypatch.setattr(svc, "can_view_lecture", yes)
    monkeypatch.setattr(svc, "_total_pages", total)
    monkeypatch.setattr(svc, "_rows", rows)
    monkeypatch.setattr(svc, "_sign", sign)
    out = asyncio.run(svc.get_pages("00000000-0000-0000-0000-000000000001", "u"))
    assert [p["imageUrl"] for p in out["pages"]] == [
        "https://signed/lectures/L/p1.webp", "https://signed/lectures/L/p2.webp"]
