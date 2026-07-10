"""Generator-aware PDF page classifier.

Reads PDF Creator/Producer metadata via PyMuPDF to detect the source
application (LaTeX/Beamer, PowerPoint, Keynote, Google Slides, etc.), then
applies format-specific routing heuristics.

Why this matters:
- LaTeX/Beamer: content lives in the text layer; images are mostly decorative.
  Only ~15% of pages need vision processing.
- PowerPoint / Keynote / Google Slides: content lives in rasterized images.
  Up to 95% of pages need vision processing. A generic text-first classifier
  silently marks two-thirds of a PowerPoint deck as "decorative".

The generator detection is a one-time O(1) read; all per-page decisions
follow from it deterministically.
"""
from __future__ import annotations

import asyncio
import logging
from collections import Counter
from typing import Literal

import fitz

from backend.domain.parse_models import SlideRoute

logger = logging.getLogger(__name__)

GeneratorFormat = Literal["latex", "powerpoint", "keynote", "google_slides", "word", "unknown"]

_LATEX_SIGNALS = ("latex", "beamer", "pdftex", "pdflatex", "luatex", "xetex", "tex")
_PPT_SIGNALS = ("microsoft powerpoint", "powerpoint")
_KEYNOTE_SIGNALS = ("keynote",)
_WORD_SIGNALS = ("microsoft word", "microsoft office word")


def detect_generator(pdf_bytes: bytes) -> GeneratorFormat:
    """Synchronous — reads PDF metadata to identify the authoring tool."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        meta = doc.metadata or {}
    finally:
        doc.close()

    creator = (meta.get("creator") or "").lower()
    producer = (meta.get("producer") or "").lower()
    combined = f"{creator} {producer}"

    if any(s in combined for s in _LATEX_SIGNALS):
        return "latex"
    if any(s in combined for s in _PPT_SIGNALS):
        return "powerpoint"
    if any(s in combined for s in _KEYNOTE_SIGNALS):
        return "keynote"
    if "google" in combined and "slides" in combined:
        return "google_slides"
    if any(s in combined for s in _WORD_SIGNALS):
        return "word"
    return "unknown"


async def detect_generator_async(pdf_bytes: bytes) -> GeneratorFormat:
    return await asyncio.to_thread(detect_generator, pdf_bytes)


def route_page(
    generator: GeneratorFormat,
    char_count: int,
    image_count: int,
    drawing_count: int,
    image_coverage: float,
    has_math: bool = False,
    is_metadata: bool = False,
) -> SlideRoute:
    """Assign a SlideRoute to one page, informed by the generator format.

    Priority:
    1. METADATA — content_filter already flagged this page
    2. METADATA — blank page (very few characters and no visuals)
    3. Generator-aware routing
    """
    if is_metadata:
        return SlideRoute.METADATA

    if char_count < 5 and image_count == 0 and drawing_count < 5:
        return SlideRoute.METADATA

    # Short title slide heuristic (applicable to all generators)
    if char_count < 30 and image_count == 0 and drawing_count < 5:
        return SlideRoute.TITLE

    if generator in ("latex", "word", "unknown"):
        # Text-first: equations stay in TEXT unless truly image-dominated
        if has_math and char_count >= 10:
            return SlideRoute.TEXT
        if image_coverage >= 0.4 and char_count < 50:
            return SlideRoute.VISION
        if drawing_count >= 20 and char_count < 30:
            return SlideRoute.MIXED
        return SlideRoute.TEXT

    # image-first formats: PowerPoint / Keynote / Google Slides
    if char_count > 100 and image_coverage < 0.10 and drawing_count < 8:
        # Clearly text-heavy even for image-first format
        return SlideRoute.TEXT
    if char_count > 20 and (image_coverage > 0 or drawing_count > 0):
        # Has both text and visuals → MIXED (text + image LLM call)
        return SlideRoute.MIXED
    # Minimal or no extractable text → full vision
    return SlideRoute.VISION


def find_repeating_lines(pages_text: list[str], threshold: float = 0.8) -> frozenset[str]:
    """Return lines that appear in >= threshold fraction of pages.

    These are almost certainly headers or footers — stripping them prevents
    the LLM from wasting tokens and prevents embedding pollution.
    """
    n = len(pages_text)
    if n < 3:
        return frozenset()

    counts: Counter[str] = Counter()
    for text in pages_text:
        seen_in_page: set[str] = set()
        for line in text.split("\n"):
            stripped = line.strip()
            # Only short lines qualify (real content lines are usually longer)
            if stripped and len(stripped) < 120:
                seen_in_page.add(stripped)
        counts.update(seen_in_page)

    min_pages = threshold * n
    return frozenset(line for line, cnt in counts.items() if cnt >= min_pages)


def strip_repeating_lines(text: str, repeating: frozenset[str]) -> str:
    """Remove header/footer lines from extracted text."""
    if not repeating:
        return text
    lines = [ln for ln in text.split("\n") if ln.strip() not in repeating]
    return "\n".join(lines).strip()
