"""page_blocks must reproduce the committed Studio sample exactly.

src/features/spaces/mocks/studio-normalization.json was generated from
public/v4-mock/normalization.pdf pages 1-12 by scripts/studio/build_fixture.py.
The production extractor is that logic, so it must rebuild the sample block
for block. If this test fails, either the extractor regressed or the fixture
must be regenerated on purpose (and the frontend tests re-run).
"""
from __future__ import annotations

import json
from pathlib import Path

import fitz
import pytest

from backend.services.parser.page_blocks import extract_blocks, is_image_only

ROOT = Path(__file__).resolve().parents[3]
PDF = ROOT / "public/v4-mock/normalization.pdf"
FIXTURE = ROOT / "src/features/spaces/mocks/studio-normalization.json"


@pytest.fixture(scope="module")
def fixture() -> dict:
    return json.loads(FIXTURE.read_text())


@pytest.fixture(scope="module")
def doc():
    d = fitz.open(PDF)
    yield d
    d.close()


@pytest.mark.parametrize("n", range(1, 13))
def test_blocks_match_the_sample(doc, fixture, n):
    pb = extract_blocks(doc[n - 1], n)
    expected = next(p for p in fixture["pages"] if p["page"] == n)
    assert pb["blocks"] == expected["blocks"]
    assert round(pb["width"], 2) == expected["width"]
    assert round(pb["height"], 2) == expected["height"]


@pytest.mark.parametrize("n", range(1, 13))
def test_clean_markdown_matches_the_sample(doc, fixture, n):
    pb = extract_blocks(doc[n - 1], n)
    clean = {b["source"]["blockIds"][0]: b["markdown"] for b in fixture["blocks"] if b["source"]["page"] == n}
    produced = {bid: md for bid, md in pb["markdown"].items() if bid not in pb["footers"]}
    assert produced == clean


def test_footers_are_low_on_the_page(doc):
    for n in range(1, 13):
        pb = extract_blocks(doc[n - 1], n)
        by_id = {b["id"]: b for b in pb["blocks"]}
        for fid in pb["footers"]:
            assert by_id[fid]["bbox"][1] >= 0.9


def test_a_picture_only_page_is_image_only():
    d = fitz.open()
    page = d.new_page(width=400, height=300)
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 50, 50), False)
    pix.clear_with(200)
    page.insert_image(fitz.Rect(50, 50, 350, 250), pixmap=pix)
    pb = extract_blocks(page, 1)
    assert is_image_only(pb)
    d.close()


def test_a_text_page_is_not_image_only(doc):
    assert not is_image_only(extract_blocks(doc[1], 2))
