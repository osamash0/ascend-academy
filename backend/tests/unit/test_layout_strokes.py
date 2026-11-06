"""Redrawn lines and the flaws round 4 found: footers and page chips, doubled diagrams, arrow bullets,
algorithm line numbers, stray outline chips."""
import fitz

from backend.services.parser.layout.strokes import (drop_furniture, footlines, line_key, link_labels, lost_marks,
                                                    numbered_lines, reink, running_lines)


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
def test_a_running_footer_id_is_dropped_and_its_box_returned():
    body = blk(0, "paragraph", [0.1, 0.2, 0.9, 0.4], "Body text")
    foot = blk(1, "paragraph", [0.1, 0.92, 0.5, 0.96], "Institute of things 4")
    blocks = [body, foot]
    dropped = drop_furniture(blocks, ["p1-b1"], 1, {("bottom", line_key("Institute of things"))})
    assert blocks == [body] and dropped == [[0.1, 0.92, 0.5, 0.96]]


def test_a_footer_id_whose_text_runs_on_no_other_page_stays_a_block():
    # page_blocks calls any small line low on the page a footer: a list's last, smaller sub-bullet is one
    body = blk(0, "paragraph", [0.1, 0.2, 0.9, 0.4], "Body text")
    last = blk(1, "list", [0.09, 0.95, 0.33, 1.0], "\u2022 {Title, ActorName} \u219b Year")
    blocks = [body, last]
    assert drop_furniture(blocks, ["p1-b1"], 1, {("bottom", line_key("Institute of things"))}) == []
    assert blocks == [body, last]
    assert drop_furniture(blocks, ["p1-b1"], 1) == [] and blocks == [body, last]     # nothing known to run: kept


def test_a_footer_of_many_numbers_is_a_chart_axis_not_a_page_number():
    axis = blk(1, "paragraph", [0.16, 0.92, 0.72, 0.94], "1950\n1960\n1970\n1980")
    blocks = [axis]
    assert drop_furniture(blocks, ["p1-b1"], 1) == [] and blocks == [axis]
    one = blk(2, "paragraph", [0.9, 0.95, 0.96, 0.98], "Running title\n3 / 25")
    blocks = [one]
    assert drop_furniture(blocks, ["p1-b2"], 1, {("bottom", line_key("Running title"))}) == [one["bbox"]]


def test_a_band_row_ending_in_n_of_N_is_a_footline_and_a_fraction_out_of_range_is_not():
    doc, page = page_800x600()
    page.insert_text((20, 590), "Linear cryptanalysis", fontsize=8)          # beamer: title left, number right
    page.insert_text((740, 590), "3 / 58", fontsize=8)
    page.insert_text((20, 20), "Ratio 3 to 4", fontsize=8)                    # top band, no n / N at the end
    page.insert_text((60, 300), "Body 1 / 2", fontsize=12)                    # n / N, but not in the band
    rows = footlines(page, 3)
    assert len(rows) == 1 and rows[0][1] > 0.95 and rows[0][0] < 0.04 and rows[0][2] > 0.94   # one row, both ends
    for bad in ("Step 5 / 3", "Slide 0 / 4"):                                  # n > N, n < 1
        d, pg = page_800x600()
        pg.insert_text((20, 590), bad, fontsize=8)
        assert footlines(pg, 5) == []
    d, pg = page_800x600()
    pg.insert_text((20, 590), "Intro 1 / 1", fontsize=8)
    assert footlines(pg, 1) and not footlines(pg, 2)                           # N must reach 2 or the page's number


def test_a_block_on_a_footline_row_is_dropped_and_the_row_returned():
    body = blk(0, "paragraph", [0.1, 0.2, 0.9, 0.4], "Body text")
    title = blk(1, "paragraph", [0.02, 0.97, 0.3, 0.99], "Linear cryptanalysis")
    num = blk(2, "paragraph", [0.92, 0.97, 0.98, 0.99], "3 / 58")
    blocks = [body, title, num]
    row = [0.025, 0.972, 0.975, 0.988]
    dropped = drop_furniture(blocks, [], 3, footlines=[row])
    assert blocks == [body] and row in dropped and title["bbox"] in dropped and num["bbox"] in dropped


def three_pages(footer="Institute of things", extra=None):
    doc = fitz.open()
    for n in range(1, 4):
        p = doc.new_page(width=800, height=600)
        p.insert_text((60, 100), f"Body of page {n}", fontsize=20)
        p.insert_text((60, 580), f"{footer} {n}", fontsize=9)
        if extra and n == 2:
            p.insert_text((60, 545), extra, fontsize=12)
    return doc


def test_running_lines_are_band_lines_on_many_pages_page_numbers_aside():
    doc = three_pages(extra="Which keys are minimal")
    running = running_lines(doc)
    assert ("bottom", line_key("Institute of things 7")) in running
    assert ("bottom", line_key("Which keys are minimal")) not in running      # on one page only
    assert not any(k[1] == line_key("Body of page 1") for k in running)        # not in the band
    assert ("top", line_key("Institute of things")) not in running            # the same text, the other band


def test_line_key_ignores_digits_case_spacing_and_punctuation():
    assert line_key("Slide 26 \u00b7 Thorsten Papenbrock") == line_key("slide 3 thorstenpapenbrock")
    assert line_key("2 / 82") == ""


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


# --- marks: specks reink does not redraw (a scatter plot's markers) ----------------------------------------
def scatter_page(n=60):
    """A 960x540 slide: a vector scatter plot of n 5-pt markers, axes and tick labels."""
    doc = fitz.open()
    page = doc.new_page(width=960, height=540)
    page.insert_text((80, 50), "Measured latency per request", fontsize=20)
    page.draw_line((150, 460), (850, 460), color=(0, 0, 0))            # x axis
    page.draw_line((150, 100), (150, 460), color=(0, 0, 0))            # y axis
    for i, t in enumerate(("0", "10", "20", "30", "40")):
        page.insert_text((145 + i * 170, 480), t, fontsize=10)
        page.insert_text((120, 460 - i * 85), t, fontsize=10)
    for i in range(n):
        x, y = 170 + i * 11, 440 - i * 5 + ((i * 37) % 23 - 11)
        page.draw_circle((x, y), 2.5, color=(0.1, 0.2, 0.8), fill=(0.1, 0.2, 0.8))
    return doc, page


def test_a_scatter_plots_markers_are_lost_marks():
    doc, page = scatter_page()
    assert lost_marks(page, [], []) == 60


def test_marks_inside_a_figure_or_table_are_shown_there():
    doc, page = scatter_page()
    assert lost_marks(page, [[0.1, 0.1, 0.95, 0.9]], []) == 0


def test_a_few_marks_are_not_a_plot():
    doc, page = scatter_page(n=5)
    assert lost_marks(page, [], []) == 0


def test_drawn_bullets_beside_their_text_are_not_lost_marks():
    doc = fitz.open()
    page = doc.new_page(width=960, height=540)
    for i in range(10):
        page.draw_circle((62, 100 + i * 20), 2.5, color=(0, 0, 0), fill=(0, 0, 0))
    lst = ([72 / 960, 90 / 540, 600 / 960, 300 / 540], 400, "list")
    assert lost_marks(page, [], [lst]) == 0


def test_the_details_of_a_small_redrawn_drawing_are_not_lost_marks():
    doc = fitz.open()
    page = doc.new_page(width=960, height=540)
    page.draw_rect(fitz.Rect(400, 200, 440, 230), color=(0, 0, 0))                # a keyboard, redrawn
    for i in range(12):
        page.draw_rect(fitz.Rect(403 + (i % 6) * 6, 205 + (i // 6) * 10, 406 + (i % 6) * 6, 208 + (i // 6) * 10),
                       color=(0, 0, 0), fill=(0.5, 0.5, 0.5))                     # its keys: specks
    paths, _ = reink(page, [], [])
    assert lost_marks(page, [], [], paths) == 0
    assert lost_marks(page, [], [], []) == 12


def test_navigation_dots_in_the_header_band_are_furniture_not_lost_marks():
    doc = fitz.open()
    page = doc.new_page(width=960, height=540)
    for i in range(12):
        page.draw_circle((600 + i * 8, 20), 2, color=(0, 0, 0), fill=(0, 0, 0))   # beamer mini-frames
    assert lost_marks(page, [], []) == 0
