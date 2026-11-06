"""Page furniture: running lines, page numbers and beamer footlines go; a line near the page's edge that is none of
these is content and stays (or the page is held)."""
import fitz

from backend.services.parser.layout.build import build_page_layout
from backend.services.parser.layout.furniture import (drop_furniture, footline_totals, footlines, line_key,
                                                      running_lines)


def page_800x600(doc=None):
    doc = doc if doc is not None else fitz.open()        # an empty Document is falsy
    return doc, doc.new_page(width=800, height=600)


def blk(i, kind, bbox, text, **kw):
    return {"id": f"p1-b{i}", "kind": kind, "bbox": bbox, "text": text, **kw}


def body(page, title, size=20):
    page.insert_text((60, 100), title, fontsize=size + 8)
    page.insert_text((60, 200), "Body text set at the size of the body", fontsize=size)
    page.insert_text((60, 260), "A second line of body text on the page", fontsize=size)


def footline_deck(pages=3, total=58, title="Linear cryptanalysis"):
    """A beamer deck: each page's band row is "<title> ... n / N"."""
    doc = fitz.open()
    for n in range(1, pages + 1):
        _, p = page_800x600(doc)
        body(p, f"Frame {n}")
        p.insert_text((20, 590), title, fontsize=8)
        p.insert_text((740, 590), f"{n} / {total}", fontsize=8)
    return doc


def texts(lp):
    return [b["text"] for b in lp["blocks"]]


# --- footers and page numbers ----------------------------------------------------------------------------
def test_a_running_footer_id_is_dropped_and_its_box_returned():
    keep = blk(0, "paragraph", [0.1, 0.2, 0.9, 0.4], "Body text")
    foot = blk(1, "paragraph", [0.1, 0.92, 0.5, 0.96], "Institute of things 1")
    blocks = [keep, foot]
    dropped = drop_furniture(blocks, ["p1-b1"], 1, {("bottom", line_key("Institute of things 7", 7))})
    assert blocks == [keep] and dropped == [[0.1, 0.92, 0.5, 0.96]]


def test_a_footer_id_whose_text_runs_on_no_other_page_stays_a_block():
    # page_blocks calls any small line low on the page a footer: a list's last, smaller sub-bullet is one
    keep = blk(0, "paragraph", [0.1, 0.2, 0.9, 0.4], "Body text")
    last = blk(1, "list", [0.09, 0.95, 0.33, 1.0], "• {Title, ActorName} ↛ Year")
    blocks = [keep, last]
    assert drop_furniture(blocks, ["p1-b1"], 1, {("bottom", line_key("Institute of things"))}) == []
    assert blocks == [keep, last]
    assert drop_furniture(blocks, ["p1-b1"], 1) == [] and blocks == [keep, last]     # nothing known to run: kept


def test_a_footer_of_many_numbers_is_a_chart_axis_not_a_page_number():
    axis = blk(1, "paragraph", [0.16, 0.92, 0.72, 0.94], "1950\n1960\n1970\n1980")
    blocks = [axis]
    assert drop_furniture(blocks, ["p1-b1"], 1) == [] and blocks == [axis]
    one = blk(2, "paragraph", [0.9, 0.95, 0.96, 0.98], "Running title\n3 / 25")
    blocks = [one]
    assert drop_furniture(blocks, ["p1-b2"], 1, {("bottom", line_key("Running title"))}) == [one["bbox"]]


def test_a_bare_page_number_in_the_outer_band_is_dropped():
    cases = ["12", "Slide 3", "folie 4 / 20", "Seite 2 von 9", "S. 7", "Page 1 of 3"]
    blocks = [blk(i, "paragraph", [0.9, 0.93, 0.96, 0.97], t) for i, t in enumerate(cases)]
    blocks.append(blk(9, "paragraph", [0.9, 0.02, 0.96, 0.06], "5"))
    drop_furniture(blocks, [], 1)
    assert blocks == []


def test_a_number_in_the_body_or_a_sentence_in_the_band_stays():
    mid = blk(0, "paragraph", [0.4, 0.5, 0.45, 0.54], "12")
    sentence = blk(1, "paragraph", [0.1, 0.93, 0.6, 0.97], "Step 3 of the proof")
    blocks = [mid, sentence]
    assert drop_furniture(blocks, [], 1) == [] and blocks == [mid, sentence]


# --- running lines ---------------------------------------------------------------------------------------
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
    assert ("bottom", line_key("Institute of things 7", 7)) in running
    assert ("bottom", line_key("Which keys are minimal")) not in running      # on one page only
    assert not any(k[1].startswith("bodyofpage") for k in running)            # not in the band
    assert ("top", line_key("Institute of things 7", 7)) not in running       # the same text, the other band


def test_line_key_leaves_out_only_the_pages_own_number():
    assert line_key("Slide 26 · Thorsten Papenbrock", 26) == line_key("slide 3 thorstenpapenbrock", 3)
    assert line_key("Exercise 1", 5) != line_key("Exercise 2", 5)
    assert line_key("Exercise 1/2/3", 9) != line_key("Exercise 1/2", 9)
    assert line_key("Page 126", 26) == "page126"                              # 26 inside 126 is not the number


def overlay_deck():
    """Six pages; pages 2 to 4 are builds of one frame, each ending in the same small last sub-bullet."""
    doc = fitz.open()
    for n in range(1, 7):
        _, p = page_800x600(doc)
        if 2 <= n <= 4:
            body(p, "Keys and superkeys")
            p.insert_text((80, 590), "Which keys are minimal", fontsize=12)    # y0 > 0.9, smaller: a page_blocks footer
        else:
            body(p, f"Topic {n}")
    return doc


def test_overlay_builds_of_one_frame_do_not_make_a_line_running():
    doc = overlay_deck()
    assert ("bottom", line_key("Which keys are minimal")) not in running_lines(doc)
    for n in (2, 3, 4):
        lp = build_page_layout(doc[n - 1], n, set(), running_lines(doc), footline_totals(doc))
        assert lp["verdict"] == "layout", lp["reasons"]
        assert "Which keys are minimal" in texts(lp)


# --- footlines -------------------------------------------------------------------------------------------
def test_footline_totals_are_totals_counted_on_three_pages_with_different_n():
    assert footline_totals(footline_deck()) == {58}
    doc = fitz.open()
    for _ in range(4):                                                         # the same "7/10" on every page
        _, p = page_800x600(doc)
        body(p, "Results")
        p.insert_text((20, 590), "Score 7/10", fontsize=8)
    assert footline_totals(doc) == set()
    assert footline_totals(footline_deck(pages=2)) == set()                   # two different n are not enough


def test_a_beamer_footline_row_is_one_footline_and_its_spans_are_furniture():
    doc = footline_deck()
    rows = footlines(doc[2], footline_totals(doc))
    assert len(rows) == 1 and len(rows[0]["furniture"]) == 2 and rows[0]["content"] == []
    assert rows[0]["row"][0] < 0.04 and rows[0]["row"][2] > 0.94
    assert footlines(doc[2]) == []                                            # no totals: no footline rule


def test_a_larger_content_line_sharing_the_footline_row_stays_and_its_words_are_not_excused():
    doc = footline_deck()
    _, p = page_800x600(doc)                                                  # page 4: content left, number right
    body(p, "Frame 4")
    p.insert_text((20, 590), "Which keys are minimal", fontsize=18)
    p.insert_text((740, 590), "4 / 58", fontsize=8)
    totals = footline_totals(doc)
    rows = footlines(p, totals)
    assert len(rows) == 1 and len(rows[0]["furniture"]) == 1 and len(rows[0]["content"]) == 1
    which = blk(1, "paragraph", [0.025, 0.95, 0.4, 0.99], "Which keys are minimal")
    num = blk(2, "paragraph", [0.92, 0.97, 0.98, 0.99], "4 / 58")
    blocks = [which, num]
    dropped = drop_furniture(blocks, [], 4, footline_rows=rows)
    assert blocks == [which] and num["bbox"] in dropped
    assert not any(b[0] < 0.3 for b in dropped)                               # nothing over the content line
    lp = build_page_layout(p, 4, set(), set(), totals)
    assert lp["verdict"] == "layout", lp["reasons"]
    assert "Which keys are minimal" in texts(lp) and not any("58" in t for t in texts(lp))


def test_n_of_N_out_of_range_is_no_footline():
    for bad in ("Step 5 / 3", "Slide 0 / 4"):                                 # n > N, n < 1
        doc = fitz.open()
        for _ in range(3):
            _, p = page_800x600(doc)
            body(p, "Steps")
            p.insert_text((20, 590), bad, fontsize=8)
        assert footline_totals(doc) == set()
        assert footlines(doc[0], {3, 4}) == []


def test_three_quiz_scores_on_one_page_are_content_not_a_footline():
    # three rows, three different n, one total: but on one page, so no running count
    doc, p = page_800x600()
    body(p, "Quiz results")
    for i, line in enumerate(("Quiz one 7/10", "Quiz two 8/10", "Quiz three 9/10")):
        p.insert_text((20, 540 + 22 * i), line, fontsize=10)
    totals = footline_totals(doc)
    assert totals == set()
    lp = build_page_layout(p, 1, set(), running_lines(doc), totals)
    assert lp["verdict"] == "layout", lp["reasons"]
    joined = " ".join(texts(lp))
    assert all(q in joined for q in ("Quiz one 7/10", "Quiz two 8/10", "Quiz three 9/10"))


def test_a_page_with_two_rows_of_one_total_does_not_count_for_it():
    doc = footline_deck()                                                     # pages 1-3: n = 1, 2, 3 of 58
    assert footline_totals(doc) == {58}
    doc = footline_deck(pages=2)
    _, p = page_800x600(doc)                                                  # page 3 has two "/ 58" rows
    body(p, "Frame 3")
    p.insert_text((20, 560), "Linear cryptanalysis 3 / 58", fontsize=8)
    p.insert_text((20, 590), "Linear cryptanalysis 4 / 58", fontsize=8)
    assert footline_totals(doc) == set()


def test_a_fraction_near_the_edge_is_content():
    for line in ("The probability of heads is 1/2", "Score 7/10"):
        doc, p = page_800x600()
        body(p, "Coins")
        p.insert_text((20, 590), line, fontsize=12)
        totals = footline_totals(doc)
        assert totals == set() and footlines(p, totals) == []
        lp = build_page_layout(p, 1, set(), running_lines(doc), totals)
        assert lp["verdict"] == "layout", lp["reasons"]
        assert line in texts(lp)
