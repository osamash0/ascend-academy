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
FIGURE_MAX_AREA = 0.6  # larger = page background
FIGURE_MIN_AREA = 0.002  # smaller = a logo
IMAGE_ONLY_CHARS = 25


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


def extract_blocks(page: Any, page_no: int) -> PageBlocks:
    """All source blocks of one PyMuPDF page, normalised to 0..1, top-left origin."""
    w, h = page.rect.width, page.rect.height
    raw = page.get_text("dict")["blocks"]
    sizes = [
        s["size"] for b in raw if b["type"] == 0
        for l in b["lines"] for s in l["spans"] if s["text"].strip()
    ]
    heading_size = statistics.median(sizes) * HEADING_RATIO if sizes else 999.0

    blocks: List[Dict[str, Any]] = []
    markdown: Dict[str, str] = {}
    footers: List[str] = []
    text_chars = 0
    for i, b in enumerate(raw):
        bid = f"p{page_no}-b{i}"
        box = _norm_box(b["bbox"], w, h)
        if box[2] <= box[0] or box[3] <= box[1]:
            continue
        if b["type"] == 1:
            area = (box[2] - box[0]) * (box[3] - box[1])
            if area > FIGURE_MAX_AREA or area < FIGURE_MIN_AREA:
                continue
            blocks.append({"id": bid, "page": page_no, "bbox": box, "kind": "figure",
                           "text": "", "readingOrder": i})
            continue
        lines = _lines_of(b)
        if not lines:
            continue
        kind, md = _kind_and_markdown(lines, _max_size(b), heading_size)
        text = "\n".join(lines)
        text_chars += len(text)
        blocks.append({"id": bid, "page": page_no, "bbox": box, "kind": kind,
                       "text": text, "readingOrder": i})
        markdown[bid] = md
        if box[1] >= FOOTER_TOP:
            footers.append(bid)
    return {"width": w, "height": h, "blocks": blocks, "markdown": markdown,
            "footers": footers, "text_chars": text_chars}


def is_image_only(pb: PageBlocks) -> bool:
    """Too little text to summarise from: the page goes to vision (spec §5.3)."""
    return pb["text_chars"] < IMAGE_ONLY_CHARS
