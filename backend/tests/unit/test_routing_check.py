"""The offline routing check counts routes over a folder of decks (no AI)."""
from __future__ import annotations

import fitz
import pytest

from backend.eval.routing_check import RoutingCount, count_routes, labelled_vision_pages


def _deck(path, *kinds):
    d = fitz.open()
    for kind in kinds:
        page = d.new_page(width=720, height=405)
        if kind in ("picture", "figure"):
            pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 50, 50), False)
            pix.clear_with(200)
            page.insert_image(fitz.Rect(144, 40, 576, 283), pixmap=pix)
        if kind == "figure":
            page.insert_text((144, 320), "Abbildung 2: Der B-Baum nach dem Einfügen von 17", fontsize=14)
        if kind == "text":
            for k, y in enumerate((80, 110, 140, 170, 200)):
                page.insert_text((40, y), f"Punkt {k}: ein Satz mit genug eigenem Text", fontsize=14)
    d.save(path)
    d.close()


def test_count_routes_adds_up_every_deck(tmp_path):
    _deck(tmp_path / "00 DBS Eins.pdf", "text", "figure", "picture")
    _deck(tmp_path / "01 DBS Zwei.pdf", "text", "text")
    _deck(tmp_path / "notes.pdf", "picture")  # not a lecture deck
    c = count_routes(tmp_path)
    assert (c.decks, c.pages) == (2, 5)
    assert c.by_reason == {"text": 3, "figure": 1, "no_text": 1}
    assert c.vision == 2
    assert c.vision_pages == {("00 DBS Eins.pdf", 2), ("00 DBS Eins.pdf", 3)}


def test_labelled_pages_are_matched_by_deck_and_page():
    labels = {"labels": [
        {"id": "00 DBS Eins.pdf#p2", "label": "image"},
        {"id": "00 DBS Eins.pdf#p9", "label": "image"},
        {"id": "00 DBS Eins.pdf#p4", "label": None},
    ]}
    c = RoutingCount(decks=1, pages=9, by_reason={}, vision_pages={("00 DBS Eins.pdf", 2)})
    assert labelled_vision_pages(c, labels) == (1, 2)


def test_an_empty_folder_counts_nothing(tmp_path):
    c = count_routes(tmp_path)
    assert (c.decks, c.pages, c.vision) == (0, 0, 0)


@pytest.mark.parametrize("vision, ok", [(79, False), (80, True), (100, True), (101, False)])
def test_the_vision_count_must_stay_in_range(vision, ok):
    c = RoutingCount(decks=1, pages=200, by_reason={"no_text": vision}, vision_pages=set())
    assert c.within(80, 100) is ok
