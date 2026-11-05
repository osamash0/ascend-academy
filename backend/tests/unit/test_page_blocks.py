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

from backend.services.parser.page_blocks import extract_blocks, figure_share, route_page

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


def _picture(page, rect):
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 50, 50), False)
    pix.clear_with(200)
    page.insert_image(rect, pixmap=pix)


def test_a_picture_only_page_has_no_text():
    d = fitz.open()
    page = d.new_page(width=400, height=300)
    _picture(page, fitz.Rect(50, 50, 350, 250))
    assert route_page(extract_blocks(page, 1)) == "no_text"
    d.close()


def test_a_text_page_routes_to_text(doc):
    assert route_page(extract_blocks(doc[1], 2)) == "text"


def test_a_footer_does_not_count_as_page_text():
    d = fitz.open()
    page = d.new_page(width=720, height=405)
    _picture(page, fitz.Rect(144, 40, 576, 283))  # about 40% of the page
    page.insert_text((40, 395), "Datenbanksysteme · Vorlesung 3 · Universität", fontsize=10)
    pb = extract_blocks(page, 1)
    assert len(pb["footers"]) == 1
    assert pb["footers"][0] in {b["id"] for b in pb["blocks"]}
    assert route_page(pb) == "no_text"
    d.close()


def test_a_figure_with_a_short_caption_routes_to_figure():
    d = fitz.open()
    page = d.new_page(width=720, height=405)
    _picture(page, fitz.Rect(144, 40, 576, 283))
    page.insert_text((144, 320), "Abbildung 2: Der B-Baum nach dem Einfügen von 17", fontsize=14)
    pb = extract_blocks(page, 1)
    assert 25 <= pb["text_chars"] < 150
    assert route_page(pb) == "figure"
    d.close()


def test_a_figure_beside_plenty_of_text_routes_to_text():
    d = fitz.open()
    page = d.new_page(width=720, height=405)
    _picture(page, fitz.Rect(400, 60, 680, 300))
    for k, y in enumerate((80, 110, 140, 170, 200)):
        page.insert_text((40, y), f"Punkt {k}: ein Satz mit genug eigenem Text", fontsize=14)
    pb = extract_blocks(page, 1)
    assert pb["text_chars"] >= 150
    assert route_page(pb) == "text"
    d.close()


def test_a_small_picture_does_not_make_a_short_page_a_figure():
    d = fitz.open()
    page = d.new_page(width=720, height=405)
    _picture(page, fitz.Rect(300, 150, 390, 230))  # about 2.5% of the page
    page.insert_text((40, 100), "Zusammenfassung SQL und Ausblick", fontsize=20)
    pb = extract_blocks(page, 1)
    assert 0 < figure_share(pb) < 0.05
    assert route_page(pb) == "text"
    d.close()


def _pb(text_chars, *figures):
    blocks = [{"id": f"p1-b{i}", "page": 1, "bbox": list(b), "kind": "figure", "text": "", "readingOrder": i}
              for i, b in enumerate(figures)]
    return {"width": 720.0, "height": 405.0, "blocks": blocks, "markdown": {}, "footers": [],
            "text_chars": text_chars}


@pytest.mark.parametrize("chars, route", [(0, "no_text"), (24, "no_text"), (25, "text"), (149, "text")])
def test_routing_without_a_figure_is_by_text_alone(chars, route):
    assert route_page(_pb(chars)) == route


@pytest.mark.parametrize("chars, route", [(24, "no_text"), (25, "figure"), (149, "figure"), (150, "text")])
def test_a_figure_carries_the_page_only_below_150_chars(chars, route):
    assert route_page(_pb(chars, (0.1, 0.1, 0.6, 0.6))) == route


def test_a_figure_counts_from_five_percent_of_the_page():
    assert route_page(_pb(60, (0.0, 0.0, 0.25, 0.2))) == "figure"   # 5%
    assert route_page(_pb(60, (0.0, 0.0, 0.2, 0.2))) == "text"      # 4%


def test_figure_share_adds_figures_and_ignores_text_blocks():
    pb = _pb(60, (0.0, 0.0, 0.1, 0.1), (0.5, 0.5, 0.7, 0.6))
    pb["blocks"].append({"id": "p1-b9", "page": 1, "bbox": [0.0, 0.0, 1.0, 1.0], "kind": "paragraph",
                         "text": "x", "readingOrder": 9})
    assert figure_share(pb) == pytest.approx(0.03)


def test_figure_share_never_exceeds_the_page():
    assert figure_share(_pb(0, (0.0, 0.0, 0.9, 0.9), (0.1, 0.1, 1.0, 1.0))) == 1.0


# LS-005: Source view outlined empty grey space, duplicates and covered text
# as "not in your version", and covered text leaked into the clean version.
# Slides exported from animation builds keep their reveal masks: a panel
# painted over part of the slide hides whatever was painted before it.

def _grey(page, rect):
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 20, 20), False)
    pix.clear_with(190)
    page.insert_image(rect, pixmap=pix)


def _texts(pb):
    return [b["text"] for b in pb["blocks"] if b["kind"] != "figure"]


def test_text_under_a_later_panel_is_dropped_and_text_over_it_kept():
    d = fitz.open()
    page = d.new_page(width=720, height=405)
    page.insert_text((40, 60), "Functional Dependencies", fontsize=20)
    page.insert_text((560, 300), "Database Systems", fontsize=11)  # painted first ...
    _grey(page, fitz.Rect(500, 120, 720, 405))                     # ... then covered
    page.insert_text((520, 150), "German: Funktionale Abhängigkeit", fontsize=11)  # painted on top
    pb = extract_blocks(page, 1)
    assert "Database Systems" not in _texts(pb)
    assert "German: Funktionale Abhängigkeit" in _texts(pb)
    assert not [b for b in pb["blocks"] if b["kind"] == "figure"], "a panel is not a figure"
    d.close()


def test_a_panel_off_the_left_edge_is_not_a_figure():
    d = fitz.open()
    page = d.new_page(width=720, height=405)
    page.insert_text((300, 60), "Design Process", fontsize=20)
    _grey(page, fitz.Rect(0, 50, 440, 405))
    pb = extract_blocks(page, 1)
    assert not [b for b in pb["blocks"] if b["kind"] == "figure"]
    d.close()


def test_the_same_figure_twice_is_one_figure():
    d = fitz.open()
    page = d.new_page(width=720, height=405)
    page.insert_text((40, 60), "Axioms", fontsize=20)
    _grey(page, fitz.Rect(300, 150, 420, 260))
    _grey(page, fitz.Rect(300, 150, 420, 260))
    pb = extract_blocks(page, 1)
    assert len([b for b in pb["blocks"] if b["kind"] == "figure"]) == 1
    d.close()


def test_a_small_image_in_the_top_band_is_a_logo():
    d = fitz.open()
    page = d.new_page(width=720, height=405)
    page.insert_text((40, 60), "Normalization", fontsize=20)
    _grey(page, fitz.Rect(600, 20, 700, 60))  # top right, like a university crest
    pb = extract_blocks(page, 1)
    assert not [b for b in pb["blocks"] if b["kind"] == "figure"]
    d.close()


def test_a_last_bullet_near_the_bottom_is_content_not_a_footer():
    d = fitz.open()
    page = d.new_page(width=720, height=405)
    page.insert_text((40, 60), "Normalization steps", fontsize=20)
    page.insert_text((40, 200), "Requirement analysis", fontsize=14)
    page.insert_text((40, 240), "Distribution design", fontsize=14)
    page.insert_text((40, 380), "Installations, backups, etc.", fontsize=14)  # body size, bottom band
    page.insert_text((560, 398), "Slide 2", fontsize=8)                       # small: a real footer
    pb = extract_blocks(page, 1)
    by_text = {b["text"]: b["id"] for b in pb["blocks"]}
    assert by_text["Installations, backups, etc."] not in pb["footers"]
    assert by_text["Slide 2"] in pb["footers"]
    d.close()


def test_text_showing_through_a_translucent_panel_is_kept():
    # Page 4 of the sample: a see-through blue arrow painted over "Conceptional
    # Design". The PDF does not say a panel is translucent, so the extractor
    # looks at the rendered page instead of assuming every panel hides.
    d = fitz.open()
    page = d.new_page(width=720, height=405)
    page.insert_text((300, 40), "Design Process", fontsize=20)
    page.insert_text((40, 120), "Conceptional Design", fontsize=14)
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 20, 20), True)
    pix.clear_with(200)
    pix.set_alpha(bytes([60]) * (20 * 20))  # about a quarter opaque
    page.insert_image(fitz.Rect(0, 80, 440, 405), pixmap=pix)
    pb = extract_blocks(page, 1)
    assert "Conceptional Design" in _texts(pb)
    d.close()


def test_a_box_around_text_is_its_frame_not_a_figure():
    d = fitz.open()
    page = d.new_page(width=720, height=405)
    page.insert_text((40, 60), "Axioms", fontsize=20)
    _grey(page, fitz.Rect(380, 120, 640, 200))
    page.insert_text((400, 160), "Axioms are derivation rules", fontsize=12)
    pb = extract_blocks(page, 1)
    assert not [b for b in pb["blocks"] if b["kind"] == "figure"]
    assert "Axioms are derivation rules" in _texts(pb)
    d.close()


def test_the_boxes_do_not_move_when_small_glyph_heights_are_left_on(doc, fixture):
    """The switch is process-wide, and another thread's table search can leave
    it on (layout_analyzer); Studio's boxes are measured at full height anyway,
    and the switch is left as it was found."""
    was = fitz.TOOLS.set_small_glyph_heights()
    fitz.TOOLS.set_small_glyph_heights(True)
    try:
        for n in range(1, 13):
            expected = next(p for p in fixture["pages"] if p["page"] == n)
            assert extract_blocks(doc[n - 1], n)["blocks"] == expected["blocks"]
        assert fitz.TOOLS.set_small_glyph_heights() is True
    finally:
        fitz.TOOLS.set_small_glyph_heights(was)
