"""The committed sample deck says what its source says, page for page.

public/v4-mock/normalization.pdf is rendered from
src/features/spaces/mocks/normalization-deck.json by
scripts/v4-mock/build_normalization_deck.py. The reader shows the JSON's words
as a page's text and the PDF as the page itself, so the two must not drift: if
this fails, edit the JSON and run the script, never the PDF.
"""
import json
from pathlib import Path

import fitz
import pytest

ROOT = Path(__file__).resolve().parents[3]
PDF = ROOT / "public/v4-mock/normalization.pdf"
DECK = json.loads((ROOT / "src/features/spaces/mocks/normalization-deck.json").read_text())


def flat(s: str) -> str:
    return " ".join(s.split())


@pytest.fixture(scope="module")
def doc():
    d = fitz.open(PDF)
    yield d
    d.close()


def test_one_slide_sized_page_per_entry_and_learnstation_as_author(doc):
    assert doc.page_count == len(DECK["pages"])
    assert all((round(p.rect.width), round(p.rect.height)) == (720, 405) for p in doc)
    assert doc.metadata["author"] == "Learnstation"


@pytest.mark.parametrize("n", range(1, len(DECK["pages"]) + 1))
def test_each_page_holds_its_entry(doc, n):
    spec = DECK["pages"][n - 1]
    text = flat(doc[n - 1].get_text())
    lines = [spec["title"], *spec["bullets"], DECK["footer"]]
    if "formula" in spec:
        lines.append(spec["formula"]["plain"])
    if "table" in spec:
        lines += [cell for row in (spec["table"]["columns"], *spec["table"]["rows"]) for cell in row]
    for line in lines:
        assert flat(line) in text, line
