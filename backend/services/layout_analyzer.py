"""
Layout-aware structural analysis for PDF pages.

Each page is analyzed in a single thread worker that opens its own fitz.Document,
extracts all features, and returns an immutable PageLayout dataclass.  No fitz
objects are stored — the dataclass is safe to pass across async contexts.

Key capabilities:
- Column detection via x-coordinate gap clustering (handles 2-column lecture slides)
- Column-order text sorting so LLMs receive coherent reading-order text
- Unicode-aware alpha_ratio (handles Greek, Cyrillic, math symbols)
- Image coverage computed only for images that individually exceed 5% of page area
- Monospace font detection for code-block identification
- Math content detection (Greek/math Unicode + STEM keywords)
- ODL table markdown injection when upstream OpenDataLoader data is available
"""
import asyncio
import logging
import unicodedata
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import fitz

from backend.services.pdf_reader import PDFReader

logger = logging.getLogger(__name__)

# Math/STEM detection
_MATH_KEYWORDS = frozenset({
    "theorem", "lemma", "proof", "corollary", "proposition", "definition",
    "algorithm", "complexity", "derivative", "integral", "matrix", "vector",
    "eigenvalue", "gradient", "probability", "entropy", "variance",
})
_MATH_UNICODE_RANGES = (
    (0x0391, 0x03C9),   # Greek letters (Α–ω)
    (0x2200, 0x22FF),   # Mathematical operators (∀–⋿)
    (0x2100, 0x214F),   # Letterlike symbols (ℕ, ℤ, ℝ…)
    (0x27C0, 0x27EF),   # Misc math symbols
)

# Monospace font names (lowercase substrings)
_MONO_FONT_NAMES = ("mono", "courier", "consolas", "code", "fixed", "terminal", "typewriter")


@dataclass(frozen=True)
class PageLayout:
    """
    Immutable structural snapshot of a single PDF page.
    Contains no fitz objects — safe to store and pass across async boundaries.
    """
    index: int              # 0-based page index
    page_number: int        # 1-based page number (for display)
    word_count: int
    alpha_ratio: float      # letters / (letters + digits), Unicode-aware; low → scanned/garbage
    image_coverage: float   # fraction of page area covered by qualifying images (each > 5% individually)
    drawing_count: int      # number of vector drawing paths
    has_table: bool         # True if PyMuPDF native table detection found a table
    column_count: int       # 1, 2, or 3+ (clustered from text block x-origins)
    has_code_block: bool    # True if any text span uses a monospace font
    has_math: bool          # True if Greek/math chars or STEM keywords found
    raw_text: str           # column-order-sorted full text for LLM consumption
    odl_table_md: str       # non-empty when ODL provided reliable table markdown


def layout_features_dict(layout: PageLayout) -> Dict[str, Any]:
    """JSON-safe subset of a PageLayout used for routing telemetry.

    Persisted on every slide as ``_meta.layout_features`` and surfaced in
    the diagnostics endpoint so professors can audit *why* a slide was
    routed the way it was without re-running the pipeline.  Keep this
    dict small: it ships in every cached slide row.
    """
    return {
        "word_count": layout.word_count,
        "image_coverage": round(float(layout.image_coverage), 4),
        "drawing_count": layout.drawing_count,
        "alpha_ratio": round(float(layout.alpha_ratio), 4),
        "has_math": bool(layout.has_math),
        "has_table": bool(layout.has_table),
        "column_count": layout.column_count,
    }


async def analyze_page_layout_async(
    reader: PDFReader,
    page_index: int,
    odl_page: Optional[Dict[str, Any]] = None,
) -> PageLayout:
    """
    Dispatches all analysis to the thread pool in one call.
    Safe to run concurrently for all pages — each worker opens its own document.
    """
    return await asyncio.to_thread(
        _sync_analyze_page, reader._bytes, page_index, odl_page
    )


# ---------------------------------------------------------------------------
# Sync worker — runs inside a thread, opens its own fitz.Document
# ---------------------------------------------------------------------------

def _sync_analyze_page(
    pdf_bytes: bytes,
    page_index: int,
    odl_page: Optional[Dict[str, Any]],
) -> PageLayout:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        page_rect = page.rect
        page_area = page_rect.width * page_rect.height

        # All text/block data in one call
        text_dict = page.get_text("dict")
        blocks = text_dict.get("blocks", [])

        # Tables
        try:
            tbl = page.find_tables()
            has_table = bool(tbl and tbl.tables)
        except Exception:
            has_table = False

        # Drawings (vector paths)
        try:
            drawings = page.get_drawings()
            drawing_count = len(drawings)
        except Exception:
            drawing_count = 0

        # Derived features
        image_coverage = _compute_image_coverage(blocks, page_area)
        column_count, ordered_text = _extract_column_ordered_text(blocks, page_rect.width)
        alpha_ratio = _compute_alpha_ratio(ordered_text)
        word_count = len(ordered_text.split())
        has_code_block = _detect_code_block(blocks)
        has_math = _detect_math(ordered_text)

        # ODL integration
        odl_table_md = _extract_odl_table_md(odl_page)

        return PageLayout(
            index=page_index,
            page_number=page_index + 1,
            word_count=word_count,
            alpha_ratio=alpha_ratio,
            image_coverage=image_coverage,
            drawing_count=drawing_count,
            has_table=has_table,
            column_count=column_count,
            has_code_block=has_code_block,
            has_math=has_math,
            raw_text=ordered_text,
            odl_table_md=odl_table_md,
        )
    except Exception as e:
        logger.warning("Layout analysis failed for page %d: %s", page_index, e)
        return PageLayout(
            index=page_index,
            page_number=page_index + 1,
            word_count=0,
            alpha_ratio=1.0,
            image_coverage=0.0,
            drawing_count=0,
            has_table=False,
            column_count=1,
            has_code_block=False,
            has_math=False,
            raw_text="",
            odl_table_md="",
        )
    finally:
        doc.close()


# ---------------------------------------------------------------------------
# Feature extractors
# ---------------------------------------------------------------------------

def _compute_image_coverage(blocks: list, page_area: float) -> float:
    """
    Sum areas of image blocks (type==1) that individually cover > 5% of page area.
    Small images (logos, icons) are excluded; only meaningful visuals are counted.
    Returns fraction of page area, clamped to [0.0, 1.0].
    """
    if page_area <= 0:
        return 0.0
    threshold = page_area * 0.05
    qualifying = sum(
        (b["bbox"][2] - b["bbox"][0]) * (b["bbox"][3] - b["bbox"][1])
        for b in blocks
        if b.get("type") == 1
        and (b["bbox"][2] - b["bbox"][0]) * (b["bbox"][3] - b["bbox"][1]) >= threshold
    )
    return min(qualifying / page_area, 1.0)


def _detect_column_count(text_block_x0s: List[float], page_width: float) -> int:
    """
    Clusters left-edge x-coordinates of text blocks to detect column count.
    A gap > 15% of page width between sorted x-origins indicates a new column.
    Returns 1, 2, or 3 (capped).
    """
    if not text_block_x0s or page_width <= 0:
        return 1
    sorted_xs = sorted(text_block_x0s)
    gap_threshold = page_width * 0.15
    columns = 1
    for i in range(1, len(sorted_xs)):
        if sorted_xs[i] - sorted_xs[i - 1] > gap_threshold:
            columns += 1
    return min(columns, 3)


def _extract_column_ordered_text(blocks: list, page_width: float) -> Tuple[int, str]:
    """
    Extracts text from blocks in column-reading order:
    1. Identify columns via x-origin clustering.
    2. Assign each block a column index.
    3. Sort blocks by (column_index, y_top).
    4. Concatenate text preserving reading order.

    Returns (column_count, ordered_text_string).
    """
    text_blocks = [b for b in blocks if b.get("type") == 0]
    if not text_blocks:
        return 1, ""

    x0s = [b["bbox"][0] for b in text_blocks]
    col_count = _detect_column_count(x0s, page_width)

    if col_count == 1 or page_width <= 0:
        # Single column — simple top-to-bottom order
        sorted_blocks = sorted(text_blocks, key=lambda b: b["bbox"][1])
        return 1, _join_blocks(sorted_blocks)

    # Multi-column: determine column boundaries
    sorted_xs = sorted(set(x0s))
    gap_threshold = page_width * 0.15
    boundaries = [sorted_xs[0]]
    for i in range(1, len(sorted_xs)):
        if sorted_xs[i] - sorted_xs[i - 1] > gap_threshold:
            boundaries.append(sorted_xs[i])

    def _col_index(block_x0: float) -> int:
        for ci, bx in enumerate(boundaries):
            if ci + 1 < len(boundaries):
                # Belongs to this column if x0 is closer to this boundary than next
                mid = (boundaries[ci] + boundaries[ci + 1]) / 2
                if block_x0 < mid:
                    return ci
            else:
                return ci
        return len(boundaries) - 1

    sorted_blocks = sorted(
        text_blocks,
        key=lambda b: (_col_index(b["bbox"][0]), b["bbox"][1]),
    )
    return col_count, _join_blocks(sorted_blocks)


def _join_blocks(blocks: list) -> str:
    """Concatenates text spans from ordered blocks into a single string."""
    parts = []
    for block in blocks:
        for line in block.get("lines", []):
            line_text = " ".join(
                span.get("text", "") for span in line.get("spans", [])
            ).strip()
            if line_text:
                parts.append(line_text)
    return "\n".join(parts)


def _compute_alpha_ratio(text: str) -> float:
    """
    Unicode-aware letter-to-digit ratio.
    Letters: any Unicode category starting with 'L' (Latin, Greek, Cyrillic…).
    Digits: category 'Nd' (decimal digits).
    Returns 1.0 for empty text (assume readable, not garbage).
    """
    letters = sum(1 for c in text if unicodedata.category(c).startswith("L"))
    digits = sum(1 for c in text if unicodedata.category(c) == "Nd")
    total = letters + digits
    return letters / total if total > 0 else 1.0


def _detect_code_block(blocks: list) -> bool:
    """True if any text span uses a font name associated with monospace/code."""
    for block in blocks:
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                font = span.get("font", "").lower()
                if any(mono in font for mono in _MONO_FONT_NAMES):
                    return True
    return False


def _detect_math(text: str) -> bool:
    """
    Returns True if the text contains math/STEM indicators:
    - Any character in known math Unicode ranges (Greek letters, operators)
    - Any STEM keyword present in the lowercase text
    """
    for char in text:
        cp = ord(char)
        for start, end in _MATH_UNICODE_RANGES:
            if start <= cp <= end:
                return True
    text_lower = text.lower()
    return any(kw in text_lower for kw in _MATH_KEYWORDS)


def _extract_odl_table_md(odl_page: Optional[Dict[str, Any]]) -> str:
    """
    Extracts table markdown from an ODL page dict if reliable table data exists.
    ODL pages may have type='table' or contain markdown table content.
    Returns empty string if no usable table data found.
    """
    if not odl_page:
        return ""

    # Direct table markdown in ODL output
    if odl_page.get("type") == "table":
        content = odl_page.get("content", "") or odl_page.get("text", "")
        if content and "|" in content:
            return content.strip()

    # ODL may store tables in a 'tables' list
    tables = odl_page.get("tables", [])
    if tables:
        md_parts = [t.get("markdown", "") or t.get("content", "") for t in tables if t]
        combined = "\n\n".join(p for p in md_parts if p and "|" in p)
        if combined:
            return combined.strip()

    # Fall back to checking if the main text field looks like a markdown table
    text = odl_page.get("text", "")
    if text and text.count("|") >= 4 and text.count("\n") >= 2:
        return text.strip()

    return ""
