"""Redrawn lines and page furniture: a page's own vector strokes become hairline paths, footers and page-number
boxes go, algorithm line numbers are recognised. Callers hold FITZ_LOCK (this module never takes it)."""
import re

from backend.services.parser.layout.geometry import area, inter, near, union, white

PAGE_NUMBER = re.compile(r"^(slide|folie|seite|page|s\.)?\s*\d+(\s*(/|of|von)\s*\d+)?$", re.IGNORECASE)
LINE_NUMBER = re.compile(r"^\s*(\d{1,3})[:.)]?\s")
OUTER_BAND = 0.86          # the bottom band starts here (y0 above it) ...
TOP_BAND = 0.1             # ... and the top band ends here (y1 below it)
KEEP_OUT_SHARE = 0.5       # an item this much inside a table or figure is shown there
CHIP_BAND_SIZE = 0.06      # an empty closed shape this small in the outer band is a page-number chip
CHIP_SIZE = 0.04           # an empty closed shape this small, alone, is a stray outline
CLUSTER = 3                # items that make a cluster


def _in_band(y0, y1):
    return y0 > OUTER_BAND or y1 < TOP_BAND


def drop_furniture(blocks, footers, page_no):
    """Remove running footers (ids from page_blocks.extract_blocks) and bare page numbers in the outer band.
    Returns the dropped boxes, for the word check. page_no is the page's number (1-based), for the caller's log."""
    foot = set(footers or [])
    kept, dropped = [], []
    for b in blocks:
        bb = b["bbox"]
        if b["id"] in foot or (PAGE_NUMBER.match((b.get("text") or "").strip()) and _in_band(bb[1], bb[3])):
            dropped.append(bb)
        else:
            kept.append(b)
    blocks[:] = kept
    return dropped


def numbered_lines(text):
    """True when at least three lines start with consecutive integers: an algorithm's line numbers, kept as text."""
    nums = []
    for ln in (text or "").split("\n"):
        m = LINE_NUMBER.match(ln)
        if m:
            nums.append(int(m.group(1)))
    return any(nums[i + 1] == nums[i] + 1 and nums[i + 2] == nums[i] + 2 for i in range(len(nums) - 2))


def _closed(d):
    its = d["items"]
    return bool(its) and all(it[0] in ("re", "qu") for it in its)


def _path(d, W, H):
    P = lambda q: f"{q.x / W * 1000:.1f},{q.y / H * 1000:.1f}"
    segs = []
    for it in d["items"]:
        if it[0] == "l":
            segs.append(f"M{P(it[1])}L{P(it[2])}")
        elif it[0] == "c":
            segs.append(f"M{P(it[1])}C{P(it[2])} {P(it[3])} {P(it[4])}")
        elif it[0] == "re":
            q = it[1]
            segs.append(f"M{P(q.tl)}L{P(q.tr)}L{P(q.br)}L{P(q.bl)}Z")
        elif it[0] == "qu":
            q = it[1]
            segs.append(f"M{P(q.ul)}L{P(q.ur)}L{P(q.lr)}L{P(q.ll)}Z")
    return "".join(segs)


def _in_keep_out(nb, keep_out):
    a = area(nb)
    for k in keep_out:
        if a > 0 and area(inter(nb, k)) >= KEEP_OUT_SHARE * a:
            return True
        if k[0] - 0.006 <= nb[0] and k[1] - 0.006 <= nb[1] and nb[2] <= k[2] + 0.006 and nb[3] <= k[3] + 0.006:
            return True
    return False


def reink(page, keep_out, texts=()):
    """The page's own drawings, redrawn as warm hairlines: strokes as they are, filled shapes as their outline.
    Not redrawn: page furniture (rules, bars, frames, empty page-number chips), stray empty outlines, anything
    inside a table or figure, panels behind running text and callouts (Layout sets those as its own cards).
    Labelled boxes of a diagram ARE redrawn. Also returns the page's diagrams, clusters of meaningful drawn
    items, so the gate can check each survived.
    texts: [(bbox, chars, kind)] of the page's text blocks."""
    W, H = page.rect.width, page.rect.height
    items = []
    for d in page.get_drawings():
        stroke, fill = d.get("color"), d.get("fill")
        if white(stroke) and white(fill):
            continue                                   # nothing visible
        r = d["rect"]
        nb = [r.x0 / W, r.y0 / H, r.x1 / W, r.y1 / H]
        if nb[0] < -0.001 or nb[1] < -0.001 or nb[2] > 1.001 or nb[3] > 1.001:
            continue                                   # crop marks outside the page
        w, h = nb[2] - nb[0], nb[3] - nb[1]
        if (w > 0.6 and h < 0.012) or (w > 0.8 and h < 0.04) or (h > 0.8 and w < 0.04) or w * h > 0.25:
            continue                                   # title underlines, bars, rules, side bars, backgrounds
        if w > 0.2 and h < 0.06 and _in_band(nb[1], nb[3]):
            continue                                   # header and footer bands (and their pieces)
        if max(w, h) < 0.01:
            continue                                   # specks: drawn bullets, dots
        pad = [nb[0] - 0.01, nb[1] - 0.01, nb[2] + 0.01, nb[3] + 0.01]
        inside = [t for t in texts if area(inter(t[0], pad)) >= 0.8 * max(area(t[0]), 1e-9)]
        closed = _closed(d)
        if closed and not inside and w < CHIP_BAND_SIZE and h < CHIP_BAND_SIZE and _in_band(nb[1], nb[3]):
            continue                                   # an empty page-number chip
        if w > 0.03 and h > 0.03 and any(t[1] > 60 or t[2] == "callout" for t in inside):
            continue                                   # a panel behind running text, or a callout's bubble: a card in Layout
        if len(inside) >= 2 or (inside and not white(fill) and w * h > 0.03):
            continue                                   # a panel holding several lines (a beamer block): a diagram's box holds one label
        if not white(fill) and w > 0.4 and h < 0.09 and any(area(inter(t[0], nb)) > 0 for t in texts):
            continue                                   # a box's title bar, whatever the text block around it spans
        if not white(fill) and w * h > 0.03 and sum(area(inter(t[0], nb)) for t in texts) >= 0.3 * w * h:
            continue                                   # a filled panel mostly covered by text that also runs beyond it
        if inside and w > 0.5:
            continue                                   # a wide title bar of a box (beamer blocks)
        items.append({"bbox": [round(v, 4) for v in nb], "drawn": False, "d": d, "w": w, "h": h,
                      "stray": closed and not inside and w < CHIP_SIZE and h < CHIP_SIZE, "fill": fill})
    groups = []
    for it in items:
        hit = [g for g in groups if any(near(it["bbox"], o["bbox"]) for o in g)]
        for g in hit:
            groups.remove(g)
        groups.append(sum(hit, []) + [it])
    items = [it for g in groups for it in g if not (it["stray"] and len(g) < CLUSTER)]
    groups = [[it for it in g if it in items] for g in groups]
    paths = []
    for it in items:
        if _in_keep_out(it["bbox"], keep_out):
            it["drawn"] = True                         # shown inside a table or figure
            continue
        d = _path(it["d"], W, H)
        if d:
            it["drawn"] = True
            paths.append({"d": d, "bbox": it["bbox"], "fill": not white(it["fill"]) and it["w"] * it["h"] < 0.002})
    # Diagrams: clusters of at least three meaningful items covering at least 1% of the page.
    diagrams = [{"bbox": [round(v, 4) for v in union([o["bbox"] for o in g])], "items": [o["bbox"] for o in g]}
                for g in groups if len(g) >= CLUSTER and area(union([o["bbox"] for o in g])) >= 0.01]
    return paths, diagrams


def link_labels(blocks, paths):
    """Short text right next to re-inked strokes is what those strokes point at or label: it shares their ink."""
    if not paths:
        return
    for b in blocks:
        if b["kind"] in ("figure", "table", "decoration") or len(b.get("text", "")) > 48:
            continue
        if any(near(b["bbox"], p["bbox"], 0.02) for p in paths):
            b["linked"] = True
