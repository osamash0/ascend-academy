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
