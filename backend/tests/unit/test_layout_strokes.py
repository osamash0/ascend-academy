"""Redrawn lines and the flaws round 4 found: footers and page chips, doubled diagrams, arrow bullets,
algorithm line numbers, stray outline chips."""
import fitz

from backend.services.parser.layout.strokes import drop_furniture, link_labels, numbered_lines, reink


def page_800x600():
    doc = fitz.open()
    return doc, doc.new_page(width=800, height=600)


def blk(i, kind, bbox, text, **kw):
    return {"id": f"p1-b{i}", "kind": kind, "bbox": bbox, "text": text, **kw}


# --- happy path --------------------------------------------------------------------------------------------
def test_an_arrow_between_two_labels_is_redrawn_and_the_labels_are_linked():
    doc, page = page_800x600()
    page.draw_line((200, 300), (400, 300), color=(0, 0, 0))
    page.draw_line((380, 290), (400, 300), color=(0, 0, 0))
    page.draw_line((380, 310), (400, 300), color=(0, 0, 0))
    paths, _ = reink(page, [], [])
    assert len(paths) == 3 and all(p["d"].startswith("M") for p in paths)
    a = blk(0, "paragraph", [0.2, 0.44, 0.25, 0.48], "Input")
    b = blk(1, "paragraph", [0.52, 0.44, 0.58, 0.48], "Output")
    far = blk(2, "paragraph", [0.1, 0.8, 0.3, 0.85], "Elsewhere")
    long_ = blk(3, "paragraph", [0.3, 0.46, 0.5, 0.5], "x" * 60)
    fig = blk(4, "figure", [0.3, 0.45, 0.5, 0.55], "")
    blocks = [a, b, far, long_, fig]
    link_labels(blocks, paths)
    assert a["linked"] and b["linked"]
    assert "linked" not in far and "linked" not in long_ and "linked" not in fig


def test_link_labels_without_paths_changes_nothing():
    a = blk(0, "paragraph", [0.2, 0.44, 0.25, 0.48], "Input")
    link_labels([a], [])
    assert "linked" not in a


# --- flaw 1: footers and page-number boxes ----------------------------------------------------------------
def test_a_footer_id_is_dropped_and_its_box_returned():
    body = blk(0, "paragraph", [0.1, 0.2, 0.9, 0.4], "Body text")
    foot = blk(1, "paragraph", [0.1, 0.92, 0.5, 0.96], "Institute of things")
    blocks = [body, foot]
    dropped = drop_furniture(blocks, ["p1-b1"], 1)
    assert blocks == [body] and dropped == [[0.1, 0.92, 0.5, 0.96]]


def test_a_bare_page_number_in_the_outer_band_is_dropped():
    cases = ["12", "Slide 3", "folie 4 / 20", "Seite 2 von 9", "S. 7", "Page 1 of 3"]
    blocks = [blk(i, "paragraph", [0.9, 0.93, 0.96, 0.97], t) for i, t in enumerate(cases)]
    top = blk(9, "paragraph", [0.9, 0.02, 0.96, 0.06], "5")
    blocks.append(top)
    drop_furniture(blocks, [], 1)
    assert blocks == []


def test_a_number_in_the_body_or_a_sentence_in_the_band_stays():
    mid = blk(0, "paragraph", [0.4, 0.5, 0.45, 0.54], "12")
    sentence = blk(1, "paragraph", [0.1, 0.93, 0.6, 0.97], "Step 3 of the proof")
    blocks = [mid, sentence]
    assert drop_furniture(blocks, [], 1) == [] and blocks == [mid, sentence]


def test_an_empty_page_number_chip_in_the_outer_band_is_not_redrawn():
    doc, page = page_800x600()
    page.draw_rect(fitz.Rect(740, 570, 770, 590), color=(0, 0, 0))     # 30 x 20 pt, no text
    paths, _ = reink(page, [], [])
    assert paths == []


def test_a_small_shape_in_the_band_that_holds_text_is_not_dropped_by_that_rule():
    doc, page = page_800x600()
    page.draw_rect(fitz.Rect(740, 570, 770, 590), color=(0, 0, 0))
    chip_text = ([0.925, 0.95, 0.955, 0.98], 2, "paragraph")
    paths, _ = reink(page, [], [chip_text])
    assert len(paths) == 1


# --- flaw 2: a diagram shown twice -------------------------------------------------------------------------
def test_an_outline_mostly_over_a_figure_box_is_not_redrawn():
    doc, page = page_800x600()
    page.draw_rect(fitz.Rect(110, 160, 410, 360), color=(0, 0, 0))     # outline, 10 pt off the crop
    keep = [[100 / 800, 150 / 600, 400 / 800, 350 / 600]]
    paths, _ = reink(page, keep, [])
    assert paths == []


def test_an_outline_elsewhere_is_still_redrawn():
    doc, page = page_800x600()
    page.draw_rect(fitz.Rect(500, 160, 700, 360), color=(0, 0, 0))
    keep = [[100 / 800, 150 / 600, 400 / 800, 350 / 600]]
    paths, _ = reink(page, keep, [])
    assert len(paths) == 1


# --- flaw 4: algorithm line numbers -----------------------------------------------------------------------
def test_consecutive_line_numbers_are_recognised():
    assert numbered_lines("1 a\n2 b\n3 c")
    assert numbered_lines("1: x = 0\n2: y = 1\n3: z = 2\n4: return")
    assert numbered_lines("  1. a\n  2. b\n  3) c")


def test_bullets_and_short_or_broken_numbering_are_not_line_numbers():
    assert not numbered_lines("• a\n• b")
    assert not numbered_lines("1 a\n2 b")
    assert not numbered_lines("1 a\n3 b\n7 c")
    assert not numbered_lines("")


# --- flaw 5: stray outline chips --------------------------------------------------------------------------
def test_a_small_empty_outline_alone_on_the_page_is_not_redrawn():
    doc, page = page_800x600()
    page.draw_rect(fitz.Rect(300, 100, 320, 115), color=(0, 0, 0))     # 2.5% x 2.5%
    paths, _ = reink(page, [], [])
    assert paths == []


def test_a_small_outline_that_encloses_a_label_is_kept():
    doc, page = page_800x600()
    page.draw_rect(fitz.Rect(300, 100, 320, 115), color=(0, 0, 0))
    label = ([300 / 800, 100 / 600, 320 / 800, 115 / 600], 1, "paragraph")
    paths, _ = reink(page, [], [label])
    assert len(paths) == 1


def test_small_outlines_in_a_cluster_of_three_are_kept():
    doc, page = page_800x600()
    for x in (300, 330, 360):
        page.draw_rect(fitz.Rect(x, 100, x + 20, 115), color=(0, 0, 0))
    paths, _ = reink(page, [], [])
    assert len(paths) == 3


def test_a_diagram_is_reported_as_a_cluster_of_items():
    doc, page = page_800x600()
    for x in (100, 300, 500):
        page.draw_rect(fitz.Rect(x, 200, x + 120, 260), color=(0, 0, 0))
    page.draw_line((220, 230), (300, 230), color=(0, 0, 0))
    page.draw_line((420, 230), (500, 230), color=(0, 0, 0))
    _, diagrams = reink(page, [], [])
    assert len(diagrams) == 1 and len(diagrams[0]["items"]) == 5


# --- the 6% chip rule, isolated; and the reference's header/footer bands for reink -----------------------
def test_a_five_percent_empty_shape_in_the_footer_band_is_a_chip_and_not_redrawn():
    doc, page = page_800x600()
    page.draw_rect(fitz.Rect(700, 560, 740, 590), color=(0, 0, 0))     # 5% x 5%: above the 4% stray rule
    paths, _ = reink(page, [], [])
    assert paths == []


def test_the_same_five_percent_shape_mid_page_is_redrawn():
    doc, page = page_800x600()
    page.draw_rect(fitz.Rect(700, 280, 740, 310), color=(0, 0, 0))
    paths, _ = reink(page, [], [])
    assert len(paths) == 1


def test_reink_bands_are_the_references_not_the_furniture_bands():
    doc, page = page_800x600()
    # a wide thin box between 0.86 and 0.88 of the height is outside reink's band (it starts at 0.88)
    page.draw_rect(fitz.Rect(200, 521, 440, 545), color=(0, 0, 0))     # y 0.868..0.908, w 0.3, h 0.04
    paths, _ = reink(page, [], [])
    assert len(paths) == 1
    doc2, page2 = page_800x600()
    page2.draw_rect(fitz.Rect(200, 535, 440, 559), color=(0, 0, 0))    # y 0.892..0.932: inside the band
    assert reink(page2, [], [])[0] == []
