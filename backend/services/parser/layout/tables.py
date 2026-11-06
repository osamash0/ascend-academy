"""Tables from cell grids: a regular grid of cell rectangles is a table, never a diagram. Cells are filled from the
PDF's own words, so the text is verbatim, and column widths come from the grid itself."""
from backend.services.parser.layout.chars import map_text
from backend.services.parser.layout.geometry import area, centre_in, inter, near, union


CELL_GAP = 0.01          # cells closer than this (page fractions) belong to one table
WORD_PAD = 0.002         # a word belongs to a cell when its centre lies inside it (this much slack)


def _bands(vals, tol=0.006):
    out = []
    for v in sorted(vals):
        if not out or v - out[-1][-1] > tol:
            out.append([v])
        else:
            out[-1].append(v)
    return [sum(b) / len(b) for b in out]


def _groups(cells):
    """Cells that touch, or nearly, are one table: two tables on one page are two groups."""
    parent = list(range(len(cells)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(cells)):
        for j in range(i + 1, len(cells)):
            if near(cells[i], cells[j], CELL_GAP):
                parent[find(i)] = find(j)
    out = {}
    for i, c in enumerate(cells):
        out.setdefault(find(i), []).append(c)
    return sorted(out.values(), key=lambda g: (min(c[1] for c in g), min(c[0] for c in g)))


def table_grids(page, m):
    W, H = page.rect.width, page.rect.height
    cells = []
    for d in page.get_drawings():
        for it in d["items"]:
            if it[0] != "re":
                continue
            r = it[1]
            nb = [r.x0 / W, r.y0 / H, r.x1 / W, r.y1 / H]
            w, h = nb[2] - nb[0], nb[3] - nb[1]
            if 0.01 < w < 0.5 and 0.01 < h < 0.15 and 0 <= nb[0] and nb[2] <= 1.001 and 0 <= nb[1] and nb[3] <= 1.001:
                cells.append(nb)
    words = [((x0 + x1) / 2 / W, (y0 + y1) / 2 / H, x0, word) for x0, y0, x1, y1, word, *_ in page.get_text("words")]
    grids = []
    for group in _groups(cells):
        g = _grid(group, words, m)
        if g:
            grids.append(g)
    return grids


def _grid(cells, words, m):
    """One table from one group of cell rectangles, or None."""
    if len(cells) < 6:
        return None
    ys, xs = _bands([c[1] for c in cells]), _bands([c[0] for c in cells])
    # A table row has a cell in most columns; a band with only a few boxes (labels above the table) is not a row.
    per_row = {y: [c for c in cells if abs(c[1] - y) <= 0.006] for y in ys}
    ys = [y for y in ys if len(per_row[y]) >= 0.6 * len(xs)]
    cells = [c for y in ys for c in per_row[y]]
    if not cells:
        return None
    xs = _bands([c[0] for c in cells])
    if len(ys) < 3 or len(xs) < 2 or len(cells) < 0.6 * len(ys) * len(xs):
        return None
    bbox = union(cells)
    x_edges = xs + [bbox[2]]
    rows = [[[] for _ in xs] for _ in ys]
    for cx, cy, x0, word in words:
        # only a word inside a cell is the table's: words between or around the cells keep their own blocks
        if not any(c[0] - WORD_PAD <= cx <= c[2] + WORD_PAD and c[1] - WORD_PAD <= cy <= c[3] + WORD_PAD for c in cells):
            continue
        ri = max(i for i, y in enumerate(ys) if y <= cy + 0.002) if any(y <= cy + 0.002 for y in ys) else 0
        ci = max(i for i, x in enumerate(xs) if x <= cx + 0.002) if any(x <= cx + 0.002 for x in xs) else 0
        rows[ri][ci].append((x0, map_text(word, m)))
    rows = [[" ".join(w for _, w in sorted(cell)) for cell in row] for row in rows]
    filled = sum(1 for r in rows for c in r if c)
    if filled < 0.5 * len(ys) * len(xs):
        return None                                    # a grid of shapes with little text is not a table
    rows = [r for r in rows if any(c for c in r)]
    if len(rows) < 3:
        return None
    col_w = [round(x_edges[i + 1] - x_edges[i], 4) for i in range(len(xs))]
    return {"bbox": [round(v, 4) for v in bbox], "rows": rows, "colW": col_w}


def apply_tables(n, blocks, grids):
    for i, g in enumerate(grids):
        gb = g["bbox"]
        inside = [b for b in blocks if b["kind"] not in ("decoration",) and centre_in(b["bbox"], gb, pad=0.005)
                  and area(inter(b["bbox"], gb)) >= 0.6 * max(area(b["bbox"]), 1e-9)]
        start = min([b.get("readingOrder", 999) for b in inside] or [999])
        drop = {id(b) for b in inside}
        blocks[:] = [b for b in blocks if id(b) not in drop] + [{
            "id": f"t{n}-{i}", "page": n, "kind": "table", "bbox": gb, "rows": g["rows"], "colW": g["colW"],
            "text": "\n".join(" | ".join(r) for r in g["rows"]), "readingOrder": start}]
