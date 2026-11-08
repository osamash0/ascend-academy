"""Diagrams, pictures and figure boxes: vector drawings with labels become one figure, embedded images become
fixed figures, and empty figure boxes go. Callers hold FITZ_LOCK (this module never takes it)."""
import fitz  # PyMuPDF
from PIL import Image, ImageStat

from backend.services.parser.layout.geometry import GAP, area, centre_in, inter, near, union

MIN_ITEMS = 3        # a drawing has at least this many vector items,
MIN_LABELS = 2       # holds at least two text blocks,
MIN_BOXES = 2        # and at least two separate shapes that each enclose their own label -
                     # a panel or frame behind everything is one shape around all of it, so it does not count.

TEXTY = {"heading", "paragraph", "list", "formula", "callout", "caption", "handwriting"}


def diagram_regions(page):
    """Clusters of vector items, each with the closed shapes (rectangles, curves) in it."""
    W, H = page.rect.width, page.rect.height
    rects, shapes = [], []
    for d in page.get_drawings():
        r = d["rect"]
        nb = [max(0, r.x0 / W), max(0, r.y0 / H), min(1, r.x1 / W), min(1, r.y1 / H)]
        w, h = nb[2] - nb[0], nb[3] - nb[1]
        if w * h > 0.85:                       # page background
            continue
        if w > 0.8 and h < 0.04:               # title bars, rules, footer lines
            continue
        if h > 0.8 and w < 0.04:               # side bars
            continue
        if w * h > 0.3:                        # big panels and frames sit behind content; they are not the drawing
            continue
        rects.append(nb)
        kinds = {it[0] for it in d["items"]}
        shapes.append(bool(kinds & {"re", "qu", "c"}) and w > 0.01 and h > 0.01)
    # union-find clustering by proximity
    parent = list(range(len(rects)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i

    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            if near(rects[i], rects[j], GAP):
                parent[find(i)] = find(j)
    groups = {}
    for i, r in enumerate(rects):
        groups.setdefault(find(i), []).append(i)
    out = []
    for g in groups.values():
        if len(g) >= MIN_ITEMS:
            out.append({"bbox": [round(v, 4) for v in union([rects[i] for i in g])], "shapes": [rects[i] for i in g if shapes[i]]})
    return out


def apply_regions(n, blocks, regions):
    stats = {"diagrams": 0, "absorbed": 0}
    for i, rg in enumerate(regions):
        reg = rg["bbox"]
        inside = [b for b in blocks if b["kind"] in TEXTY and b["kind"] != "heading" and centre_in(b["bbox"], reg)]
        if len(inside) < MIN_LABELS:
            continue
        # Shapes that each hold their own label(s), but not most of them (that would be a panel).
        boxes = [s for s in rg["shapes"] if 1 <= sum(centre_in(b["bbox"], s, pad=0) for b in inside) <= max(1, 0.6 * len(inside))]
        if len(boxes) < MIN_BOXES:
            continue
        figs_in = [b for b in blocks if b["kind"] == "figure" and centre_in(b["bbox"], reg)]
        gone = {id(b) for b in inside + figs_in}
        fig = {"id": f"d{n}-{i}", "page": n, "kind": "figure", "bbox": [round(v, 4) for v in union([reg] + [b["bbox"] for b in inside + figs_in])],
               "text": "", "readingOrder": min(b.get("readingOrder", 999) for b in inside), "labels": [b["text"] for b in inside], "diagram": True}
        blocks[:] = [b for b in blocks if id(b) not in gone] + [fig]
        stats["diagrams"] += 1; stats["absorbed"] += len(inside)
    return stats


def ink(page, r, skip=()):
    """Share of a region that is ink: pixels clearly away from the region's own paper colour.
    skip: page-fraction boxes left out (pictures shown on their own)."""
    z = 0.5
    pix = page.get_pixmap(clip=r, matrix=fitz.Matrix(z, z), alpha=False, colorspace=fitz.csGRAY)
    if pix.width * pix.height < 4:
        return 0.0
    W, H = page.rect.width, page.rect.height
    px, vals = pix.samples, []
    for j in range(pix.height):
        for i in range(pix.width):
            x, y = (r.x0 + (i + 0.5) / z) / W, (r.y0 + (j + 0.5) / z) / H
            if any(b[0] <= x <= b[2] and b[1] <= y <= b[3] for b in skip):
                continue
            vals.append(px[j * pix.width + i])
    if not vals:
        return 0.0
    paper = sorted(vals)[len(vals) // 2]
    return sum(1 for v in vals if abs(v - paper) > 48) / len(vals)


def drop_blank_figures(page, blocks, skip=()):
    """A figure that is (nearly) empty on the original - under 2% ink - shows nothing but a blank box: it goes.
    Its labels stay as text, and any line art in it is redrawn in ink like the rest of the page."""
    W, H = page.rect.width, page.rect.height
    words = [[x0 / W, y0 / H, x1 / W, y1 / H] for x0, y0, x1, y1, t, *_ in page.get_text("words") if t.strip()]
    gone = 0
    for b in [b for b in blocks if b["kind"] == "figure" and not b.get("picture")]:
        x0, y0, x1, y1 = b["bbox"]
        if any(centre_in(w, b["bbox"], pad=0) for w in words):
            continue                                   # it holds words: not blank, whatever the ink says
        if (x1 - x0) * (y1 - y0) <= 0 or ink(page, fitz.Rect(x0 * W, y0 * H, x1 * W, y1 * H), skip) < 0.02:
            blocks.remove(b); gone += 1
            if b.get("text", "").strip():
                blocks.append({**b, "kind": "paragraph", "id": b["id"] + "-t"})
    return gone


def trim_figures(blocks):
    trimmed = 0
    for f in [b for b in blocks if b["kind"] == "figure"]:
        for b in blocks:
            if b is f or b["kind"] == "figure" or not b.get("text"):
                continue
            if b["kind"] == "decoration" and centre_in(b["bbox"], f["bbox"], pad=0):
                continue                        # furniture inside a figure is part of the picture
            fb, tb = f["bbox"], b["bbox"]
            if area(inter(fb, tb)) <= 0 or (centre_in(tb, fb, pad=0) and b["kind"] != "heading"):
                continue                        # no overlap, or a label inside the figure (a heading is never a label)
            cands = [[fb[0], tb[3], fb[2], fb[3]], [fb[0], fb[1], fb[2], tb[1]], [tb[2], fb[1], fb[2], fb[3]], [fb[0], fb[1], tb[0], fb[3]]]
            best = max(cands, key=area)
            if area(best) >= 0.5 * area(fb):
                f["bbox"] = [round(v, 4) for v in best]; trimmed += 1
    return trimmed


# ---------------------------------------------------------------------------------------------------------
# Pictures: every photo or image the PDF holds is a fixed figure, taken from the PDF itself, so no extractor
# can drop or cut it. Furniture is not content: a logo repeats on many pages of the file, a thin bar is
# decoration, and a flat panel (one colour) is the background of a box whose text Layout sets itself.
def place(im, page):
    """An image as drawn: which image, and where on the page (in 1% steps)."""
    W, H = page.rect.width, page.rect.height
    x0, y0, x1, y1 = im["bbox"]
    return (im.get("xref"), round(x0 / W, 2), round(y0 / H, 2), round(x1 / W, 2), round(y1 / H, 2))


def repeated_places(doc):
    """Logos: the same image DRAWN at the same place on many pages. (A page's resource list is no evidence:
    converters such as LibreOffice list every image of the file on every page.) Computed on every call;
    the caller computes it once per document and passes it on."""
    seen = {}
    for i in range(doc.page_count):
        page = doc[i]
        for k in {place(im, page) for im in page.get_image_info(xrefs=True)}:
            seen[k] = seen.get(k, 0) + 1
    return {k for k, c in seen.items() if c >= max(3, 0.3 * doc.page_count)}


def flat(page, r, limit=10):
    pix = page.get_pixmap(clip=r, matrix=fitz.Matrix(0.5, 0.5), alpha=False, colorspace=fitz.csGRAY)
    if pix.width * pix.height < 4:
        return True
    return ImageStat.Stat(Image.frombytes("L", (pix.width, pix.height), pix.samples)).stddev[0] < limit


def content_pictures(page, repeated):
    W, H = page.rect.width, page.rect.height
    boxes = []
    for im in page.get_image_info(xrefs=True):
        x0, y0, x1, y1 = im["bbox"]
        b = [max(0, x0 / W), max(0, y0 / H), min(1, x1 / W), min(1, y1 / H)]
        if area(b) < 0.01 or area(b) > 0.9 or min(b[2] - b[0], b[3] - b[1]) < 0.04 or place(im, page) in repeated:
            continue
        if flat(page, fitz.Rect(b[0] * W, b[1] * H, b[2] * W, b[3] * H)):
            continue
        boxes.append(b)
    merged = True                                   # pictures stacked on one another are one picture
    while merged:
        merged = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                if area(inter(boxes[i], boxes[j])) > 0.3 * min(area(boxes[i]), area(boxes[j])):
                    boxes[i] = union([boxes[i], boxes[j]]); del boxes[j]; merged = True; break
            if merged:
                break
    return [[round(v, 4) for v in b] for b in boxes]


def apply_pictures(n, blocks, pics):
    added = 0
    for k, pic in enumerate(pics):
        figs = [b for b in blocks if b["kind"] == "figure"]
        if sum(area(inter(pic, f["bbox"])) for f in figs) >= 0.85 * area(pic):
            continue                                # already shown whole
        # Figures mostly inside the picture and words printed on it belong to the picture.
        owned = [b for b in blocks if (b["kind"] == "figure" and area(inter(b["bbox"], pic)) >= 0.6 * area(b["bbox"]))
                 or (b["kind"] in TEXTY and b["kind"] != "heading" and area(inter(b["bbox"], pic)) >= 0.8 * max(area(b["bbox"]), 1e-9))]
        gone = {id(b) for b in owned}
        fig = {"id": f"pic{n}-{k}", "page": n, "kind": "figure", "bbox": [round(v, 4) for v in union([pic] + [b["bbox"] for b in owned if b["kind"] == "figure"])],
               "text": "", "readingOrder": min([b.get("readingOrder", 500) for b in owned] or [500]), "labels": [b.get("text", "") for b in owned if b.get("text")], "picture": True}
        blocks[:] = [b for b in blocks if id(b) not in gone] + [fig]
        added += 1
    return added
