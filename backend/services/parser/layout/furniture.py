"""Page furniture: running headers and footers, page numbers and beamer footlines. A line near the page's edge is
content unless it is furniture: a page that would lose it is held, never set without it.
What needs the whole document (running_lines, footline_totals) is computed once per document by the caller and
passed on. Callers hold FITZ_LOCK (this module never takes it)."""
import logging
import re
import unicodedata

from backend.services.parser.layout.geometry import centre_in, union
from backend.services.parser.layout.strokes import OUTER_BAND, TOP_BAND, _in_band
from backend.services.parser.page_blocks import extract_blocks
from backend.services.pdf_reader import page_text_dict

logger = logging.getLogger(__name__)

PAGE_NUMBER = re.compile(r"^(slide|folie|seite|page|s\.)?\s*\d+(\s*(/|of|von)\s*\d+)?$", re.IGNORECASE)
FOOTLINE = re.compile(r"(\d+)\s*/\s*(\d+)\s*$")   # a band row ending in "n / N": a beamer footline
RUNNING_PAGES = 3          # a band line on this many pages (and on 30% of them) is a running header or footer ...
RUNNING_SHARE = 0.3        # (the same bar as figures.repeated_places) ...
RUNNING_TITLES = 3         # ... when those pages carry this many different titles (overlay builds of one frame do not)
FOOTLINE_NS = 3            # a total "/ N" ending band rows with this many different n is the document's frame count
FOOTLINE_SIZE = 1.1        # text up to this much larger than the "n / N" is part of its footline
ROW_OVERLAP = 0.5          # band spans sharing this much of the smaller one's height are one row
ROW_PAD = 0.01             # a block this close to a footline row (vertically) lies on it


def band(box):
    """"bottom" or "top" for a box in the outer band, else None."""
    return "bottom" if box[1] > OUTER_BAND else "top" if box[3] < TOP_BAND else None


def line_key(text, page_no=None):
    """A line compared across pages: case, spacing and punctuation aside, and the page's own number left out
    ("Slide 26" on page 26 is "Slide 3" on page 3); every other digit counts ("Exercise 1" is not "Exercise 2")."""
    s = unicodedata.normalize("NFKC", text or "").lower()
    if page_no:
        s = re.sub(rf"(?<!\d){page_no}(?!\d)", " ", s)
    return "".join(c for c in s if c.isalnum())


def page_lines(page):
    """The page's text lines from its words: {(block_no, line_no): (box, text)}, box in page fractions."""
    W, H = page.rect.width, page.rect.height
    lines = {}
    for x0, y0, x1, y1, t, bno, lno, _ in page.get_text("words"):
        box, words = lines.setdefault((bno, lno), ([x0 / W, y0 / H, x1 / W, y1 / H], []))
        box[:] = [min(box[0], x0 / W), min(box[1], y0 / H), max(box[2], x1 / W), max(box[3], y1 / H)]
        words.append(t)
    return {k: (box, " ".join(words)) for k, (box, words) in lines.items()}


def page_title(page, n):
    """The page's title, as a line_key: its top-most heading outside the band, else its first text block.
    "" when the page cannot be read: one page never costs the document its layouts."""
    try:
        blocks = extract_blocks(page, n)["blocks"]
    except Exception as exc:
        logger.warning("layout: no title for page %d (counted as untitled): %s", n, exc)
        return ""
    texts = [b for b in blocks if b["kind"] != "figure" and b.get("text")]
    body = [b for b in texts if not band(b["bbox"])] or texts
    heads = [b for b in body if b["kind"] == "heading"]
    first = (min(heads, key=lambda b: b["bbox"][1]) if heads
             else min(body, key=lambda b: b.get("readingOrder", 0)) if body else None)
    return line_key(first["text"]) if first else ""


def running_lines(doc):
    """Running headers and footers: {(band, line_key)} of lines in the same outer band on at least RUNNING_PAGES
    pages and RUNNING_SHARE of the document, under at least RUNNING_TITLES different page titles (a frame's overlay
    builds repeat its last line under one title). Computed on every call; the caller computes it once per document
    and passes it on."""
    pages, titles = {}, {}
    for i in range(doc.page_count):
        n, page = i + 1, doc[i]
        title = page_title(page, n)
        for k in {(band(box), line_key(text, n)) for box, text in page_lines(page).values()}:
            if k[0] and k[1]:
                pages[k] = pages.get(k, 0) + 1
                titles.setdefault(k, set()).add(title)
    need = max(RUNNING_PAGES, RUNNING_SHARE * doc.page_count)
    return {k for k, c in pages.items() if c >= need and len(titles[k]) >= RUNNING_TITLES}


def _band_rows(page):
    """The outer band's text spans grouped into rows, each row's spans left to right:
    [{"band", "box", "spans": [{"box", "text", "size"}]}]."""
    W, H = page.rect.width, page.rect.height
    spans = []
    for b in page_text_dict(page)["blocks"]:
        if b["type"] != 0:
            continue
        for ln in b["lines"]:
            for sp in ln["spans"]:
                x0, y0, x1, y1 = sp["bbox"]
                box = [x0 / W, y0 / H, x1 / W, y1 / H]
                if sp["text"].strip() and band(box):
                    spans.append({"box": box, "text": sp["text"].strip(), "size": sp["size"]})
    rows = []
    for sp in sorted(spans, key=lambda s: s["box"][1]):
        box, side = sp["box"], band(sp["box"])
        for r in rows:
            ov = min(r["box"][3], box[3]) - max(r["box"][1], box[1])
            if r["band"] == side and ov >= ROW_OVERLAP * min(r["box"][3] - r["box"][1], box[3] - box[1]):
                r["spans"].append(sp)
                r["box"] = union([r["box"], box])
                break
        else:
            rows.append({"band": side, "box": list(box), "spans": [sp]})
    for r in rows:
        r["spans"].sort(key=lambda s: s["box"][0])
    return rows


def _ending(row):
    """(n, N) when the row, read left to right, ends in "n / N" with 1 <= n <= N; else None."""
    m = FOOTLINE.search(" ".join(s["text"] for s in row["spans"]))
    if not m:
        return None
    n, total = int(m.group(1)), int(m.group(2))
    return (n, total) if 1 <= n <= total else None


def footline_totals(doc):
    """The totals N of the document's footlines: an "n / N" ending a band row on at least FOOTLINE_NS pages, with
    a different n on each. One n per page per N: a page with several rows ending in "/ N" (three quiz scores out
    of 10) does not count for that N. A fraction near the edge ("Score 7/10") is not a running count. Computed on
    every call; the caller computes it once per document and passes it on."""
    ns = {}                                            # N -> {page index: n, or None when the page has several}
    for i in range(doc.page_count):
        seen = {}
        for r in _band_rows(doc[i]):
            e = _ending(r)
            if e:
                seen[e[1]] = None if e[1] in seen else e[0]
        for total, n in seen.items():
            ns.setdefault(total, {})[i] = n
    return {total for total, pages in ns.items()
            if len({n for n in pages.values() if n is not None}) >= FOOTLINE_NS}


def footlines(page, totals=frozenset()):
    """The page's footlines ("<section title> ... 3 / 58"): band rows ending in "n / N" with N in totals
    (footline_totals). A learner never sees a page number on a Layout page. Only the row's spans set no larger than
    FOOTLINE_SIZE x the "n / N" are the footline; larger text sharing the row is content.
    Returns [{"row": box, "furniture": [span boxes], "content": [span boxes], "number": box}]."""
    out = []
    for r in _band_rows(page):
        e = _ending(r)
        if not e or e[1] not in totals:
            continue
        size = r["spans"][-1]["size"]
        joined = [s for s in r["spans"] if s["size"] <= FOOTLINE_SIZE * size]
        out.append({"row": r["box"], "furniture": [s["box"] for s in joined],
                    "content": [s["box"] for s in r["spans"] if s not in joined], "number": r["spans"][-1]["box"]})
    return out


def furniture(box, text, running=frozenset(), page_no=None):
    """Text that is page furniture: in the outer band, and each of its lines a page number or a running line
    (at most one page number: a row of numbers is a chart's axis). Anything else near the page's edge is content
    (a list's last line, a closing question)."""
    side = band(box)
    lines = [ln.strip() for ln in (text or "").split("\n") if ln.strip()]
    numbers = sum(1 for ln in lines if PAGE_NUMBER.match(ln))
    return (bool(side and lines) and numbers <= 1
            and all(PAGE_NUMBER.match(ln) or (side, line_key(ln, page_no)) in running for ln in lines))


def _on_row(bb, row):
    return bb[1] >= row[1] - ROW_PAD and bb[3] <= row[3] + ROW_PAD and bb[0] < row[2] and bb[2] > row[0]


def drop_furniture(blocks, footers, page_no, running=frozenset(), footline_rows=()):
    """Remove footers (ids from page_blocks.extract_blocks) that are furniture, bare page numbers in the outer band,
    and footlines (footline_rows, from footlines(page)). page_blocks calls any small line low on the page a footer;
    only one whose lines run across the document (running_lines) or are page numbers goes. A block on a footline
    row goes when nothing larger shares it; otherwise only its trailing "n / N" goes. Returns the dropped boxes and
    the footlines' span boxes, for the word check. page_no is the page's number (1-based)."""
    foot = set(footers or [])
    kept, dropped = [], []
    for b in blocks:
        bb, text = b["bbox"], (b.get("text") or "").strip()
        if (b["id"] in foot and furniture(bb, text, running, page_no)) or (PAGE_NUMBER.match(text) and _in_band(bb[1], bb[3])):
            dropped.append(bb)
            continue
        rows = [f for f in footline_rows if _on_row(bb, f["row"])]
        if rows and not any(centre_in(c, bb, 0) for f in rows for c in f["content"]):
            dropped.append(bb)                         # all of it is footline
            continue
        if any(centre_in(f["number"], bb, 0) for f in rows):
            b["text"] = FOOTLINE.sub("", b.get("text") or "").rstrip()
            if not b["text"]:
                dropped.append(bb)
                continue
        kept.append(b)
    blocks[:] = kept
    return dropped + [box for f in footline_rows for box in f["furniture"]]
