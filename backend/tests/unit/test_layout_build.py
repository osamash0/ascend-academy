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


def test_at_least_seven_of_twelve_normalization_pages_are_layout(layouts):
    # page 8 is held for split sub/superscripts ("A 1 ,A 2") until the vision pass
    assert sum(lp["verdict"] == "layout" for lp in layouts) >= 7


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


def test_a_sub_and_superscript_the_block_splits_into_pieces_is_reported_as_words_missing():
    d = fitz.open()
    p = d.new_page(width=600, height=800)
    p.insert_text((60, 100), "A1,A2", fontsize=14)
    # the PDF's word "A1,A2" is "A 1 ,A 2" in the block: set flat, so the page stays the original until the vision pass
    assert server_checks(p, blocks_for("A 1 ,A 2", (0.05, 0.1, 0.3, 0.14)), [], [], [], []) == ["1 of 1 words missing"]


def test_a_lost_two_letter_word_is_reported():
    d = fitz.open()
    p = d.new_page(width=600, height=800)
    p.insert_text((60, 100), "Let x be a function on the set", fontsize=14)
    # "on" is missing from the block
    assert server_checks(p, blocks_for("Let x be a function the set"), [], [], [], []) == ["1 of 8 words missing"]


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


def test_a_vector_scatter_plot_whose_markers_are_not_redrawn_is_held():
    from backend.tests.unit.test_layout_strokes import scatter_page

    doc, page = scatter_page()
    lp = build_page_layout(page, 1, set())
    assert lp["verdict"] == "original"
    assert "60 marks lost" in lp["reasons"]


def test_lost_marks_are_a_reason():
    d, p = text_page(("Body",))
    blocks = blocks_for("Body", (0.05, 0.1, 0.3, 0.14))
    assert server_checks(p, blocks, [], [], [], [], marks=12) == ["12 marks lost"]
    assert server_checks(p, blocks, [], [], [], [], marks=0) == []


# --- glyphs that cannot be trusted ------------------------------------------------------------------------
def bullet_page(monkeypatch, lines, pua):
    """A page whose extracted blocks carry "•" where page_blocks turned a private-use glyph into a bullet
    (PyMuPDF's own fonts write no private-use codes, so the "·" they set stands in for it), with the page's
    pua_map stubbed."""
    from backend.services.parser.layout import build
    from backend.services.parser.page_blocks import extract_blocks

    def blocks(page, n):
        pb = extract_blocks(page, n)
        for b in pb["blocks"]:
            b["text"] = b["text"].replace("·", "•")
        return pb

    monkeypatch.setattr(build, "extract_blocks", blocks)
    monkeypatch.setattr(build, "pua_map", lambda page: pua)
    d, p = text_page(lines, step=20)
    return d, p


def test_a_mid_line_bullet_on_a_page_with_symbol_font_characters_is_a_lost_symbol(monkeypatch):
    d, p = bullet_page(monkeypatch, ("Let x · y hold for every pair",), {"\uf0a3": "≤"})
    lp = build_page_layout(p, 1, set())
    assert lp["verdict"] == "original"
    assert "broken characters in 1 blocks" in lp["reasons"]


def test_a_mixed_symbol_page_never_turns_its_bullets_into_arrows(monkeypatch):
    d, p = bullet_page(monkeypatch, ("Let x · y hold for every pair",), {"\uf0e0": "→", "\uf0a3": "≤"})
    lp = build_page_layout(p, 1, set())
    assert "→" not in lp["blocks"][0]["text"]
    assert lp["verdict"] == "original"


def test_an_arrows_only_page_still_gets_its_arrows_back(monkeypatch):
    d, p = bullet_page(monkeypatch, ("Let x · y hold for every pair",), {"\uf0e0": "→"})
    lp = build_page_layout(p, 1, set())
    assert lp["blocks"][0]["text"] == "Let x → y hold for every pair"
    assert lp["verdict"] == "layout"


def test_line_start_bullets_on_a_symbol_page_are_bullets(monkeypatch):
    d, p = bullet_page(monkeypatch, ("· first point here", "· second point here"), {"\uf0a3": "≤"})
    lp = build_page_layout(p, 1, set())
    assert lp["verdict"] == "layout", lp["reasons"]


def test_a_nul_or_a_replacement_character_is_a_broken_character():
    d, p = text_page(("Hello world",))
    for bad in ("Hello\x00 world", "Hello � world"):
        assert server_checks(p, blocks_for(bad), [], [], [], []) == ["broken characters in 1 blocks"]


def test_control_characters_never_reach_the_stored_page_and_the_page_is_held(monkeypatch):
    from backend.services.parser.layout import build
    from backend.services.parser.page_blocks import extract_blocks

    def blocks(page, n):
        pb = extract_blocks(page, n)
        pb["blocks"][0]["text"] = "Hello\x00 world\x07"
        return pb

    monkeypatch.setattr(build, "extract_blocks", blocks)
    d, p = text_page(("Hello world",))
    lp = build_page_layout(p, 1, set())
    assert lp["verdict"] == "original" and "broken characters in 1 blocks" in lp["reasons"]
    ctl = set(map(chr, [*range(0, 9), 11, 12, *range(14, 32)]))
    strings = lp["reasons"] + [s for b in lp["blocks"] for s in [b["text"]] + [c for r in b.get("rows", []) for c in r]]
    assert not any(c in ctl for s in strings for c in s)
    assert lp["blocks"][0]["text"] == "Hello world"


def test_a_table_cell_is_scrubbed_of_control_characters(monkeypatch):
    from backend.services.parser.layout import build

    real = build.table_grids

    def grids(page, m):
        out = real(page, m)
        out[0]["rows"][0][0] = "r0\x00c0"
        return out

    monkeypatch.setattr(build, "table_grids", grids)
    from backend.tests.unit.test_layout_tables import grid_page
    doc, page = grid_page()
    lp = build_page_layout(page, 1, set())
    table = next(b for b in lp["blocks"] if b["kind"] == "table")
    assert table["rows"][0][0] == "r0c0" and "\x00" not in table["text"]
    assert lp["verdict"] == "original"


# --- payload: a page with too many lines ------------------------------------------------------------------
def test_more_than_four_hundred_paths_is_too_many_lines():
    d, p = text_page(("Body",))
    blocks = blocks_for("Body", (0.05, 0.1, 0.3, 0.14))
    paths = [{"d": "M0,0L1,1", "bbox": [0.5, 0.5, 0.5, 0.5], "fill": False}]
    assert server_checks(p, blocks, [], [], paths * 400, []) == []
    assert server_checks(p, blocks, [], [], paths * 401, []) == ["too many lines"]


def test_a_page_with_too_many_lines_is_held_and_stores_none_of_them():
    d, p = text_page(("A hatched drawing",))
    for i in range(420):
        x = 100 + (i % 30) * 14
        y = 300 + (i // 30) * 30
        p.draw_line((x, y), (x + 10, y + 20), color=(0, 0, 0))
    lp = build_page_layout(p, 1, set())
    assert lp["verdict"] == "original" and "too many lines" in lp["reasons"]
    assert lp["paths"] == []


def test_lines_under_a_crop_are_counted_in_words():
    d, p = text_page()
    fig = {"id": "d1-0", "kind": "figure", "bbox": [0.05, 0.08, 0.95, 0.2], "text": ""}
    one = [{"id": "p1-b0", "kind": "paragraph", "bbox": [0.1, 0.1, 0.6, 0.15], "text": "Hello world"}]
    two = one + [{"id": "p1-b1", "kind": "paragraph", "bbox": [0.1, 0.15, 0.6, 0.19], "text": "A second line of plain text"}]
    assert "1 line under a crop" in server_checks(p, one + [fig], [], [], [], [])
    assert "2 lines under a crop" in server_checks(p, two + [fig], [], [], [], [])
