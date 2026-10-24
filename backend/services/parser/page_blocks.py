"""Text blocks with their positions: the geometry behind Studio's Peek and Morph.

Real-pages spec §5.1. This is the logic that built the Studio sample
(scripts/studio/build_fixture.py), moved here so the sample and production can
never drift apart; tests/unit/test_page_blocks.py holds the sample as a golden
file.

Ids are p{page}-b{n}, n = the block's index in PyMuPDF's get_text("dict")
output, so they are stable for as long as the file is unchanged.
"""
from __future__ import annotations

import re
import statistics
from typing import Any, Dict, List, Tuple, TypedDict

PUA = re.compile("[\ue000-\uf8ff]")  # icon-font bullets in some exports
HEADING_RATIO = 1.35
HEADING_MAX_CHARS = 120
FOOTER_TOP = 0.9
FOOTER_MAX_SIZE = 0.85  # and set smaller than the page's body text: a slide's last bullet is not a footer
FIGURE_MAX_AREA = 0.6  # larger = page background
FIGURE_MIN_AREA = 0.002  # smaller = a logo
IMAGE_ONLY_CHARS = 25
# Images that are not figures a reader would miss (LS-005: Source view
# outlined empty grey space, duplicates and covered text as "not in your
# version", and covered text leaked into the clean version).
PAGE_EDGE = 0.999        # a box reaching this far touches the page's edge
COVERED = 0.8            # this much of a block under a later panel = hidden
SAME_FIGURE = 0.9        # this much of one figure inside another = the same figure
LOGO_BAND = 0.2          # small images ending above this line are logos ...
LOGO_MAX_AREA = 0.03     # ... when no bigger than this
FLAT_DPI = 36            # a cheap render, only for pages that have a panel
FLAT_STDDEV = 6.0        # grey levels: below this, nothing shows in a region


class PageBlocks(TypedDict):
    width: float
    height: float
    blocks: List[Dict[str, Any]]
    markdown: Dict[str, str]
    footers: List[str]
    text_chars: int


def _clean(s: str) -> str:
    s = PUA.sub("•", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def _lines_of(block: dict) -> List[str]:
    out = []
    for line in block["lines"]:
        t = _clean(" ".join(span["text"] for span in line["spans"]))
        if t:
            out.append(t)
    # Bullets and numbers are often their own line; join them to the text after.
    merged: List[str] = []
    i = 0
    while i < len(out):
        if re.fullmatch(r"•|\d+\.", out[i]) and i + 1 < len(out):
            merged.append(out[i] + " " + out[i + 1])
            i += 2
        else:
            merged.append(out[i])
            i += 1
    return merged


def _max_size(block: dict) -> float:
    return max((s["size"] for l in block["lines"] for s in l["spans"]), default=0.0)


def _kind_and_markdown(lines: List[str], size: float, heading_size: float) -> Tuple[str, str]:
    if all(l.startswith("•") for l in lines):
        return "list", "\n".join("- " + l.lstrip("•").strip() for l in lines)
    text = " ".join(l.lstrip("•").strip() for l in lines)
    if size >= heading_size and len(text) < HEADING_MAX_CHARS:
        return "heading", "### " + text
    return "paragraph", text


def _norm_box(b, w: float, h: float) -> List[float]:
    def c(v: float) -> float:
        return round(min(1.0, max(0.0, v)), 4)

    x0, y0, x1, y1 = b
    return [c(x0 / w), c(y0 / h), c(x1 / w), c(y1 / h)]


def _inside(a: List[float], b: List[float]) -> float:
    """How much of box a lies inside box b, 0..1."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    area = _area(a)
    return (ix * iy) / area if area else 0.0


def _flat(gray: Any, box: List[float]) -> bool:
    """Nothing visible in this region of the rendered page: one flat tone.

    Panels are not always opaque (a translucent arrow lets the text under it
    show), and the PDF does not say which, so look instead of assuming."""
    W, H = gray.width, gray.height
    x0, y0 = int(box[0] * W), int(box[1] * H)
    x1, y1 = max(x0 + 1, int(box[2] * W)), max(y0 + 1, int(box[3] * H))
    data = gray.samples
    vals = [data[y * W + x] for y in range(y0, min(y1, H)) for x in range(x0, min(x1, W))]
    return len(vals) < 2 or statistics.pstdev(vals) < FLAT_STDDEV


def _is_panel(box: List[float]) -> bool:
    """An image running off the page's bottom edge and one side: a backdrop, a
    decorative shape or a pasted-over panel (slides exported from animation
    builds keep their reveal masks), not a figure."""
    return box[3] >= PAGE_EDGE and (box[2] >= PAGE_EDGE or box[0] <= 1 - PAGE_EDGE)


def extract_blocks(page: Any, page_no: int) -> PageBlocks:
    """All source blocks of one PyMuPDF page, normalised to 0..1, top-left origin.

    Dropped: page backgrounds and logos, panels, duplicate images, and anything
    a panel painted later covers so that nothing of it shows (it is not on the
    page a reader sees, so it is neither "missing from your version" nor part
    of it).
    """
    w, h = page.rect.width, page.rect.height
    raw = page.get_text("dict")["blocks"]
    # Paint order is block order: a panel covers what came before it.
    panels = [(i, _norm_box(b["bbox"], w, h)) for i, b in enumerate(raw)
              if b["type"] == 1 and _is_panel(_norm_box(b["bbox"], w, h))]
    figures: List[List[float]] = []
    gray = None
    if panels:
        import fitz  # PyMuPDF; only needed when a panel may hide something
        gray = page.get_pixmap(dpi=FLAT_DPI, colorspace=fitz.csGRAY, alpha=False)
    sizes = [
        s["size"] for b in raw if b["type"] == 0
        for l in b["lines"] for s in l["spans"] if s["text"].strip()
    ]
    heading_size = statistics.median(sizes) * HEADING_RATIO if sizes else 999.0
    # Body text is measured above the footer band; with none there, anything
    # at the bottom is a footer.
    body = [
        s["size"] for b in raw if b["type"] == 0 and b["bbox"][1] / h < FOOTER_TOP
        for l in b["lines"] for s in l["spans"] if s["text"].strip()
    ]
    body_size = statistics.median(body) if body else float("inf")

    blocks: List[Dict[str, Any]] = []
    markdown: Dict[str, str] = {}
    footers: List[str] = []
    text_chars = 0
    for i, b in enumerate(raw):
        bid = f"p{page_no}-b{i}"
        box = _norm_box(b["bbox"], w, h)
        if box[2] <= box[0] or box[3] <= box[1]:
            continue
        if (gray is not None and any(j > i and _inside(box, pbox) >= COVERED for j, pbox in panels)
                and _flat(gray, box)):
            continue  # painted over: not on the page a reader sees
        if b["type"] == 1:
            area = (box[2] - box[0]) * (box[3] - box[1])
            if area > FIGURE_MAX_AREA or area < FIGURE_MIN_AREA or _is_panel(box):
                continue
            if box[3] <= LOGO_BAND and area <= LOGO_MAX_AREA:
                continue
            if any(_inside(box, f) >= SAME_FIGURE or _inside(f, box) >= SAME_FIGURE for f in figures):
                continue
            figures.append(box)
            blocks.append({"id": bid, "page": page_no, "bbox": box, "kind": "figure",
                           "text": "", "readingOrder": i})
            continue
        lines = _lines_of(b)
        if not lines:
            continue
        kind, md = _kind_and_markdown(lines, _max_size(b), heading_size)
        text = "\n".join(lines)
        blocks.append({"id": bid, "page": page_no, "bbox": box, "kind": kind,
                       "text": text, "readingOrder": i})
        markdown[bid] = md
        if box[1] >= FOOTER_TOP and _max_size(b) < body_size * FOOTER_MAX_SIZE:
            footers.append(bid)  # running footers are never summarised, so they don't count as page text
        else:
            text_chars += len(text)
    # A box with the page's own text inside it is that text's frame (a
    # callout, a coloured band), not a figure missing from anyone's version.
    texts = [b["bbox"] for b in blocks if b["kind"] != "figure"]
    blocks = [b for b in blocks
              if b["kind"] != "figure" or not any(_inside(t, b["bbox"]) >= COVERED for t in texts)]
    return {"width": w, "height": h, "blocks": blocks, "markdown": markdown,
            "footers": footers, "text_chars": text_chars}


def is_image_only(pb: PageBlocks) -> bool:
    """Too little text to summarise from: the page goes to vision (spec §5.3)."""
    return pb["text_chars"] < IMAGE_ONLY_CHARS


VISION_KINDS = {"heading", "paragraph", "list", "table", "code", "math", "figure", "handwriting"}
MAX_OVERLAP = 0.5
MIN_COVERAGE = 0.15


def vision_blocks_to_source(items: Any, page_no: int) -> List[Dict[str, Any]]:
    """Vision boxes ([ymin, xmin, ymax, xmax] on 0..1000) → SourceBlocks."""
    out: List[Dict[str, Any]] = []
    for i, it in enumerate(items if isinstance(items, list) else []):
        if not isinstance(it, dict):
            continue
        box = it.get("box_2d")
        text = it.get("text") if isinstance(it.get("text"), str) else ""
        kind = it.get("kind") if it.get("kind") in VISION_KINDS else "paragraph"
        if not (isinstance(box, list) and len(box) == 4 and all(isinstance(v, (int, float)) for v in box)):
            continue
        if any(v < 0 or v > 1000 for v in box):
            continue  # reject a wild box rather than clamp it into a plausible one
        if kind != "figure" and not text.strip():
            continue
        ymin, xmin, ymax, xmax = (round(min(1.0, max(0.0, v / 1000)), 4) for v in box)
        block: Dict[str, Any] = {"id": f"p{page_no}-b{i}", "page": page_no,
                                 "bbox": [xmin, ymin, xmax, ymax], "kind": kind,
                                 "text": text.strip() if kind != "figure" else ""}
        conf = it.get("confidence")
        if isinstance(conf, (int, float)):
            block["confidence"] = round(min(1.0, max(0.0, float(conf))), 2)
        block["readingOrder"] = len(out)
        out.append(block)
    return out


def _area(b: List[float]) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def validate_vision_boxes(blocks: List[Dict[str, Any]]) -> bool:
    """Spec §5.3: inside the page with area, no pair overlapping more than half
    of the smaller box, and together at least 15% of the page."""
    if not blocks:
        return False
    boxes = [b["bbox"] for b in blocks]
    if any(_area(b) <= 0 for b in boxes):
        return False
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a, c = boxes[i], boxes[j]
            inter = _area([max(a[0], c[0]), max(a[1], c[1]), min(a[2], c[2]), min(a[3], c[3])])
            if inter > MAX_OVERLAP * min(_area(a), _area(c)):
                return False
    return sum(_area(b) for b in boxes) >= MIN_COVERAGE
