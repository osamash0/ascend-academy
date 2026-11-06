"""Tables from cell grids: a regular grid of cell rectangles is a table, its cells filled verbatim."""
import fitz

from backend.services.parser.layout.tables import table_grids, apply_tables


def grid_page():
    doc = fitz.open()
    page = doc.new_page(width=800, height=600)
    for r in range(4):
        for c in range(3):
            rect = fitz.Rect(100 + c * 150, 100 + r * 40, 250 + c * 150, 140 + r * 40)
            page.draw_rect(rect, color=(0, 0, 0), width=0.5)
            page.insert_text((rect.x0 + 6, rect.y0 + 25), f"r{r}c{c}", fontsize=11)
    return doc, page


def test_a_cell_grid_is_a_table_with_verbatim_cells():
    doc, page = grid_page()
    grids = table_grids(page, {})
    assert len(grids) == 1
    assert grids[0]["rows"][0] == ["r0c0", "r0c1", "r0c2"]
    assert len(grids[0]["colW"]) == 3


def test_apply_tables_replaces_the_blocks_inside():
    doc, page = grid_page()
    grids = table_grids(page, {})
    blocks = [{"id": "p1-b0", "kind": "paragraph", "bbox": [0.15, 0.18, 0.3, 0.22], "text": "r0c0", "readingOrder": 0}]
    apply_tables(1, blocks, grids)
    assert [b["kind"] for b in blocks] == ["table"]
    assert blocks[0]["id"] == "t1-0"


def test_two_boxes_are_not_a_table():
    doc = fitz.open()
    page = doc.new_page(width=800, height=600)
    page.draw_rect(fitz.Rect(100, 100, 200, 140)); page.draw_rect(fitz.Rect(300, 100, 400, 140))
    assert table_grids(page, {}) == []


def two_grids_page():
    """Two 3x3 grids with a sentence between them: two tables, the sentence in neither."""
    doc = fitz.open()
    page = doc.new_page(width=800, height=600)
    for t, top in enumerate((60, 360)):
        for r in range(3):
            for c in range(3):
                rect = fitz.Rect(100 + c * 150, top + r * 40, 250 + c * 150, top + 40 + r * 40)
                page.draw_rect(rect, color=(0, 0, 0), width=0.5)
                page.insert_text((rect.x0 + 6, rect.y0 + 25), f"t{t}r{r}c{c}", fontsize=11)
    page.insert_text((100, 260), "This sentence sits between the two tables", fontsize=12)
    return doc, page


def test_two_tables_on_one_page_are_two_grids_and_the_words_between_stay_out():
    doc, page = two_grids_page()
    grids = table_grids(page, {})
    assert len(grids) == 2
    assert grids[0]["rows"] == [[f"t0r{r}c{c}" for c in range(3)] for r in range(3)]
    assert grids[1]["rows"] == [[f"t1r{r}c{c}" for c in range(3)] for r in range(3)]
    cells = " ".join(c for g in grids for r in g["rows"] for c in r)
    assert "sentence" not in cells and "between" not in cells


def test_a_word_outside_every_cell_is_not_table_content():
    doc = fitz.open()
    page = doc.new_page(width=800, height=600)
    for r in range(4):
        for c in range(3):
            rect = fitz.Rect(100 + c * 150, 100 + r * 40, 250 + c * 150, 140 + r * 40)
            if (r, c) != (3, 2):                       # no cell drawn here: inside the grid's box, outside every cell
                page.draw_rect(rect, color=(0, 0, 0), width=0.5)
                page.insert_text((rect.x0 + 6, rect.y0 + 25), f"r{r}c{c}", fontsize=11)
    page.insert_text((406, 245), "stray", fontsize=11)
    grids = table_grids(page, {})
    assert len(grids) == 1
    assert "stray" not in " ".join(c for r in grids[0]["rows"] for c in r)


class StubPage:
    """A page whose drawings may lie off the page (PyMuPDF clips what it draws itself)."""
    def __init__(self, rects, words, W=800, H=600):
        self.rect = fitz.Rect(0, 0, W, H)
        self.rects, self.words = rects, words

    def get_drawings(self):
        return [{"items": [("re", r)]} for r in self.rects]

    def get_text(self, mode):
        return self.words


def test_cells_below_the_page_are_not_cells():
    rects, words = [], []
    for r in range(5):
        for c in range(3):
            # the last row runs off the bottom of the page
            rect = fitz.Rect(100 + c * 150, 440 + r * 40, 250 + c * 150, 480 + r * 40)
            rects.append(rect)
            words.append((rect.x0 + 6, rect.y0 + 10, rect.x0 + 40, rect.y0 + 25, f"r{r}c{c}", 0, 0, 0))
    grids = table_grids(StubPage(rects, words), {})
    assert len(grids) == 1
    assert 0 <= grids[0]["bbox"][1] <= grids[0]["bbox"][3] <= 1
    assert all("r4" not in c for r in grids[0]["rows"] for c in r)


def test_the_sentence_between_two_tables_stays_its_own_block():
    from backend.services.parser.layout.build import build_page_layout

    doc, page = two_grids_page()
    lp = build_page_layout(page, 1, set())
    assert [b["kind"] for b in lp["blocks"]].count("table") == 2
    assert any(b["kind"] != "table" and "sentence sits between" in b["text"] for b in lp["blocks"])
