"""Locale resolution for the reader endpoint.

Regression: the endpoint served *only* a published translation snapshot and
409'd otherwise. Two things made that a dead end rather than a wait:

  * a snapshot is invalidated by the `content_revision` bump that fires on
    every slide/quiz write, so any edit re-broke the lecture, and
  * lectures that never had a snapshot (135 of 162 in the real database)
    stayed unreadable forever, because nothing backfills them.

A reader whose locale already equals the lecture's source language needs no
translation at all, so serving canonical rows there cannot produce the
mixed-language deck the no-fallback rule exists to prevent — the translator
itself short-circuits on the identical condition.
"""
from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from backend.services import localization_service as svc

LECTURE_ID = uuid4()


def _document(source_language: str, slides: list | None = None) -> dict:
    return {
        "lecture": {
            "id": str(LECTURE_ID),
            "title": "Data Integration",
            "description": "",
            "source_language": source_language,
            "course_id": None,
        },
        "slides": slides if slides is not None else [
            {"id": "s1", "slide_number": 1, "title": "Intro", "content_text": "x",
             "summary": "", "questions": []},
        ],
    }


@pytest.fixture
def no_snapshot(monkeypatch):
    async def _none(*_a, **_k):
        return None
    monkeypatch.setattr(svc, "get_localized_lecture", _none)


def _patch_source(monkeypatch, document):
    async def _fetch(_lecture_id):
        return document, 1
    monkeypatch.setattr(svc, "_fetch_lecture_document", _fetch)


@pytest.mark.asyncio
async def test_published_snapshot_wins(monkeypatch):
    async def _snap(*_a, **_k):
        return {"lecture": {"id": "snap"}, "slides": []}
    monkeypatch.setattr(svc, "get_localized_lecture", _snap)
    # Source fetch must not even be consulted when a snapshot is ready.
    def _boom(_lecture_id):
        raise AssertionError("source should not be read when a snapshot exists")
    monkeypatch.setattr(svc, "_fetch_lecture_document", _boom)

    got, served = await svc.get_lecture_content_for_locale(LECTURE_ID, "en")
    assert got["lecture"]["id"] == "snap"
    assert served == "en"


@pytest.mark.asyncio
async def test_same_language_reader_gets_canonical_rows_without_a_snapshot(
    monkeypatch, no_snapshot,
):
    _patch_source(monkeypatch, _document("en"))

    got, served = await svc.get_lecture_content_for_locale(LECTURE_ID, "en")

    # Before the fix this was None -> 409, for 83% of the library.
    assert got is not None
    assert got["lecture"]["title"] == "Data Integration"
    assert len(got["slides"]) == 1
    assert served == "en"


@pytest.mark.asyncio
async def test_cross_language_reader_gets_the_original_clearly_labelled(
    monkeypatch, no_snapshot,
):
    """A German deck with no English translation is served *as German*.

    Withholding it stranded students on 48 lectures of their own course
    material. A wholly-German deck is not the *mixed*-language deck the old
    rule guarded against — but the caller must be told what it actually got,
    hence the served locale.
    """
    _patch_source(monkeypatch, _document("de"))

    got, served = await svc.get_lecture_content_for_locale(LECTURE_ID, "en")

    assert got is not None
    assert served == "de", "must report the real language, not the requested one"


@pytest.mark.asyncio
async def test_a_deck_still_mid_parse_reports_not_ready(monkeypatch, no_snapshot):
    """Rows exist but no slides yet -> 'being prepared', not an empty lecture."""
    _patch_source(monkeypatch, _document("en", slides=[]))

    content, _ = await svc.get_lecture_content_for_locale(LECTURE_ID, "en")
    assert content is None


@pytest.mark.asyncio
async def test_missing_lecture_reports_not_ready(monkeypatch, no_snapshot):
    def _missing(_lecture_id):
        raise ValueError("Lecture not found")
    monkeypatch.setattr(svc, "_fetch_lecture_document", _missing)

    content, _ = await svc.get_lecture_content_for_locale(LECTURE_ID, "en")
    assert content is None


@pytest.mark.asyncio
async def test_an_unrecognised_source_language_does_not_leak_into_the_response(
    monkeypatch, no_snapshot,
):
    """Legacy/garbage values must not be reported as a served locale."""
    _patch_source(monkeypatch, _document("fr"))

    got, served = await svc.get_lecture_content_for_locale(LECTURE_ID, "en")

    assert got is not None
    assert served == "en"
