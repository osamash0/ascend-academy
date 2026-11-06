"""One page in, one Layout page out: the build, and the server checks that decide layout or original."""
import io
from pathlib import Path

import fitz
import pytest
from PIL import Image

from backend.services.parser.layout.build import LAYOUT_VERSION, build_page_layout
from backend.services.parser.layout.checks import norm_word, server_checks
from backend.services.parser.layout.figures import repeated_places

ROOT = Path(__file__).resolve().parents[3]
PDF = ROOT / "public/v4-mock/normalization.pdf"
KEYS = {"page", "verdict", "reasons", "blocks", "paths", "version"}
BLOCK_KEYS = {"id", "kind", "bbox", "text", "rows", "colW", "linked", "picture", "diagram"}
KINDS = {"heading", "paragraph", "list", "table", "figure"}


@pytest.fixture(scope="module")
def doc():
    d = fitz.open(PDF)
    yield d
    d.close()


@pytest.fixture(scope="module")
def layouts(doc):
    rep = repeated_places(doc)
    return [build_page_layout(doc[n - 1], n, rep) for n in range(1, 13)]


def text_page(lines=("Hello world", "A second line of plain text"), step=60):
    d = fitz.open()
    p = d.new_page(width=600, height=800)
    y = 100
    for ln in lines:
        p.insert_text((60, y), ln, fontsize=14)
        y += step
    return d, p


# --- the committed normalization.pdf ----------------------------------------------------------------------
def test_every_page_returns_the_contract(layouts):
    for n, lp in enumerate(layouts, 1):
        assert set(lp) == KEYS and lp["page"] == n and lp["version"] == LAYOUT_VERSION == 1
        assert lp["verdict"] in ("layout", "original")
        assert (lp["verdict"] == "layout") == (lp["reasons"] == [])
        for b in lp["blocks"]:
            assert set(b) <= BLOCK_KEYS and {"id", "kind", "bbox", "text"} <= set(b) and b["kind"] in KINDS
        for p in lp["paths"]:
            assert set(p) == {"d", "bbox", "fill"}


def test_every_bbox_lies_within_the_page(layouts):
    for lp in layouts:
        for b in lp["blocks"] + lp["paths"]:
            x0, y0, x1, y1 = b["bbox"]
            assert 0 <= x0 <= x1 <= 1 and 0 <= y0 <= y1 <= 1


def test_no_text_holds_a_tex_ligature_code_or_a_private_use_character(layouts):
    for lp in layouts:
        for b in lp["blocks"]:
            for s in [b["text"]] + [c for r in b.get("rows", []) for c in r]:
                assert not any("\x1b" <= c <= "\x1f" or "\ue000" <= c <= "\uf8ff" for c in s)


def test_only_figures_have_no_text(layouts):
    for lp in layouts:
        for b in lp["blocks"]:
            assert b["text"] or b["kind"] == "figure"


def test_at_least_eight_of_twelve_normalization_pages_are_layout(layouts):
    assert sum(lp["verdict"] == "layout" for lp in layouts) >= 8


# --- built in code ---------------------------------------------------------------------------------------
def test_a_plain_text_page_is_layout():
    d, p = text_page()
    lp = build_page_layout(p, 1, set())
    assert lp["verdict"] == "layout" and lp["reasons"] == []
    assert [b["text"] for b in lp["blocks"]] == ["Hello world", "A second line of plain text"]
    assert lp["blocks"][0]["id"].startswith("p1-b")


def test_a_page_with_only_an_image_is_original_with_no_text_layer():
    d = fitz.open()
    p = d.new_page(width=600, height=800)
    im = Image.effect_noise((200, 200), 80).convert("RGB")
    buf = io.BytesIO(); im.save(buf, "PNG")
    p.insert_image(fitz.Rect(100, 100, 500, 500), stream=buf.getvalue())
    lp = build_page_layout(p, 1, set())
    assert lp["verdict"] == "original" and lp["reasons"] == ["no text layer"]


def test_a_figure_box_covering_a_paragraph_is_a_line_under_a_crop():
    d, p = text_page()
    para = {"id": "p1-b0", "kind": "paragraph", "bbox": [0.1, 0.1, 0.6, 0.15], "text": "Hello world"}
    fig = {"id": "d1-0", "kind": "figure", "bbox": [0.05, 0.08, 0.7, 0.17], "text": ""}
    reasons = server_checks(p, [para, fig], [], [], [], [])
    assert any("under a crop" in r for r in reasons)


def test_numbered_lines_are_a_paragraph_that_keeps_its_line_breaks():
    d, p = text_page(("1 x = 0", "2 y = 1", "3 z = 2"), step=16)
    lp = build_page_layout(p, 1, set())
    assert [(b["kind"], b["text"]) for b in lp["blocks"]] == [("paragraph", "1 x = 0\n2 y = 1\n3 z = 2")]


def test_a_block_of_text_is_not_linked_without_strokes_near_it():
    d, p = text_page()
    assert all("linked" not in b for b in build_page_layout(p, 1, set())["blocks"])


# --- server checks, one reason at a time -----------------------------------------------------------------
def test_norm_word_ignores_case_accents_ligatures_and_punctuation():
    assert norm_word("Gröbner,") == norm_word("grobner")
    assert norm_word("e\x1cect") == norm_word("eect")
    assert norm_word("--") == ""


def blocks_for(text, bbox=(0.1, 0.1, 0.9, 0.14)):
    return [{"id": "p1-b0", "kind": "paragraph", "bbox": list(bbox), "text": text}]


def test_words_missing_from_the_blocks_are_reported():
    d, p = text_page()
    reasons = server_checks(p, blocks_for("Hello world"), [], [], [], [])
    assert reasons == ["6 of 8 words missing"]


def test_a_word_the_block_sets_with_spaces_between_sub_and_superscripts_is_not_missing():
    d = fitz.open()
    p = d.new_page(width=600, height=800)
    p.insert_text((60, 100), "A1,A2", fontsize=14)
    assert server_checks(p, blocks_for("A 1 ,A 2", (0.05, 0.1, 0.3, 0.14)), [], [], [], []) == []
    assert server_checks(p, blocks_for("B 1 ,B 2", (0.05, 0.1, 0.3, 0.14)), [], [], [], []) == ["1 of 1 words missing"]


def test_a_lost_two_letter_word_is_not_rescued_by_a_one_character_token_elsewhere():
    d = fitz.open()
    p = d.new_page(width=600, height=800)
    p.insert_text((60, 100), "Let x be a function on the set", fontsize=14)
    # "x" and "a" are single-character tokens, but "on" is no run of neighbouring tokens: it is lost
    assert server_checks(p, blocks_for("Let x be a function the set"), [], [], [], []) == ["1 of 8 words missing"]


def test_a_word_that_only_matches_across_a_word_boundary_is_not_rescued():
    d = fitz.open()
    p = d.new_page(width=600, height=800)
    p.insert_text((60, 100), "Slim 1 x", fontsize=14)
    p.insert_text((60, 130), "mx", fontsize=14)
    # tokens "slim" "1" "x": "mx" = tail of "slim" + "x" crosses a word boundary; "1x" would be a run, "mx" is not
    reasons = server_checks(p, blocks_for("Slim 1 x", (0.05, 0.1, 0.5, 0.14)), [], [], [], [])
    assert reasons == ["1 of 4 words missing"]


def test_a_run_never_crosses_into_another_block():
    d = fitz.open()
    p = d.new_page(width=600, height=800)
    p.insert_text((60, 100), "A1", fontsize=14)
    blocks = [{"id": "a", "kind": "paragraph", "bbox": [0.05, 0.1, 0.2, 0.14], "text": "A"},
              {"id": "b", "kind": "paragraph", "bbox": [0.05, 0.3, 0.2, 0.34], "text": "1"}]
    assert server_checks(p, blocks, [], [], [], []) == ["1 of 1 words missing"]


def test_two_small_figure_boxes_that_sum_past_a_fifth_are_not_under_a_crop():
    d, p = text_page(("Hello world",))
    para = {"id": "p1-b0", "kind": "paragraph", "bbox": [0.1, 0.1, 0.5, 0.2], "text": "Hello world"}
    small = [{"id": f"f{i}", "kind": "figure", "bbox": [0.1 + 0.2 * i, 0.1, 0.1 + 0.2 * i + 0.1, 0.12], "text": ""} for i in range(2)]
    # each box covers 5% of the block, together 10%: no one box covers more than 20%
    assert server_checks(p, [para] + small, [], [], [], []) == []


def test_furniture_words_in_the_outer_band_outside_every_block_are_not_missing():
    d = fitz.open()
    p = d.new_page(width=600, height=800)
    p.insert_text((60, 100), "Body", fontsize=14)
    p.insert_text((60, 790), "Footer words here", fontsize=8)
    reasons = server_checks(p, blocks_for("Body", (0.05, 0.1, 0.3, 0.14)), [], [], [], [])
    assert reasons == []


def test_a_word_inside_a_dropped_box_is_not_missing():
    d, p = text_page(("Body", "Dropped"))
    reasons = server_checks(p, blocks_for("Body", (0.05, 0.1, 0.3, 0.14)), [], [], [], [[0.05, 0.17, 0.3, 0.23]])
    assert reasons == []


def test_a_word_inside_a_figure_is_not_missing():
    d, p = text_page(("Body", "Labelled"))
    blocks = blocks_for("Body", (0.05, 0.1, 0.3, 0.14)) + [{"id": "d1-0", "kind": "figure", "bbox": [0.05, 0.17, 0.3, 0.23], "text": ""}]
    assert server_checks(p, blocks, [], [], [], []) == []


def test_broken_characters_are_counted_per_block():
    d, p = text_page(("Gr¨obner", "§ bullet"))
    blocks = [{"id": "a", "kind": "paragraph", "bbox": [0.05, 0.1, 0.5, 0.14], "text": "Gr¨obner"},
              {"id": "b", "kind": "paragraph", "bbox": [0.05, 0.17, 0.5, 0.23], "text": "x § bullet"}]
    assert "broken characters in 2 blocks" in server_checks(p, blocks, [], [], [], [])


def test_a_picture_not_covered_by_figure_boxes_is_lost():
    d, p = text_page(("Body",))
    blocks = blocks_for("Body", (0.05, 0.1, 0.3, 0.14))
    pic = [0.5, 0.5, 0.9, 0.9]
    assert "1 picture lost or cut" in server_checks(p, blocks, [pic], [], [], [])
    blocks.append({"id": "pic1-0", "kind": "figure", "bbox": pic, "text": "", "picture": True})
    assert server_checks(p, blocks, [pic], [], [], []) == []


def test_a_diagram_with_too_few_redrawn_items_is_lost():
    d, p = text_page(("Body",))
    blocks = blocks_for("Body", (0.05, 0.1, 0.3, 0.14))
    items = [[0.5, 0.5, 0.6, 0.6], [0.6, 0.5, 0.7, 0.6], [0.7, 0.5, 0.8, 0.6]]
    diagram = {"bbox": [0.5, 0.5, 0.8, 0.6], "items": items}
    paths = [{"d": "M0,0", "bbox": items[0], "fill": False}]
    assert "1 diagram lost" in server_checks(p, blocks, [], [diagram], paths, [])
    paths = [{"d": "M0,0", "bbox": it, "fill": False} for it in items[:2]]
    assert server_checks(p, blocks, [], [diagram], paths, []) == []


def test_a_page_with_only_figures_has_no_text_layer():
    d, p = text_page()
    fig = {"id": "d1-0", "kind": "figure", "bbox": [0, 0, 1, 1], "text": ""}
    assert server_checks(p, [fig], [], [], [], []) == ["no text layer"]
