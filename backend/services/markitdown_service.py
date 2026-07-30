"""MarkItDown parser service.

Converts office/document files (primarily PowerPoint .pptx) to per-page text
using Microsoft's MarkItDown, exposing the same interface as the other parser
services (llamaparse/mineru/odl):

    async extract_pages(file_bytes, filename) -> {1-based page_num: {"text", "title"}}

MarkItDown's PPTX converter emits one block per slide, delimited by an HTML
comment marker ("<!-- Slide number: N -->") with the slide title rendered as a
Markdown "# heading". That maps cleanly onto the per-page contract the unified
and v4 orchestrators consume (they use the per-page "text" to override the
PyMuPDF text layer; see unified_orchestrator._extract_pages).

Unlike the PDF parsers, MarkItDown reads native office structure, so the text is
typically cleaner than text recovered from a PDF render.
"""
import io
import os
import re
import asyncio
import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)

try:
    from markitdown import MarkItDown
    _MARKITDOWN_AVAILABLE = True
except ImportError:
    _MARKITDOWN_AVAILABLE = False
    logger.warning("markitdown not installed — MarkItDown extraction unavailable")


# MarkItDown delimits each slide with: "<!-- Slide number: 1 -->"
_SLIDE_MARKER = re.compile(r"<!--\s*Slide number:\s*(\d+)\s*-->", re.IGNORECASE)

# Heading lines look like "# Title" / "## Title". Reuse the same title-noise
# guard idea as odl_service: skip bullets, numbered list openers, and captions.
_TITLE_NOISE = re.compile(
    r'^[\•\·\-\–\—\*\>\|]'    # starts with bullet / dash / arrow
    r'|^\d+[\s\.\)]+\w'        # starts with "1. " or "1) "
    r'|\bfigure\b|\btable\b'   # captions
    , re.IGNORECASE
)


def _title_from_chunk(chunk: str) -> Optional[str]:
    """Pick the slide title — the first clean Markdown heading in the block."""
    for line in chunk.splitlines():
        stripped = line.strip()
        if not stripped.startswith("#"):
            continue
        text = stripped.lstrip("#").strip()
        if len(text) < 3 or len(text) > 150:
            continue
        if _TITLE_NOISE.search(text):
            continue
        return text
    return None


def _parse_markdown_to_pages(markdown: str) -> Dict[int, dict]:
    """Split MarkItDown output into {slide_no: {"text", "title"}}.

    Falls back to a single page (keyed 1) when there are no slide markers — e.g.
    a format MarkItDown renders as one continuous block.
    """
    matches = list(_SLIDE_MARKER.finditer(markdown))

    if not matches:
        text = markdown.strip()
        return {1: {"text": text, "title": _title_from_chunk(text)}} if text else {}

    result: Dict[int, dict] = {}
    for idx, m in enumerate(matches):
        slide_no = int(m.group(1))
        start = m.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(markdown)
        chunk = markdown[start:end].strip()
        result[slide_no] = {"text": chunk, "title": _title_from_chunk(chunk)}
    return result


def _run_markitdown_sync(file_bytes: bytes, filename: str) -> str:
    """Blocking MarkItDown conversion — must be called via run_in_executor."""
    ext = os.path.splitext(filename or "")[1].lower() or ".pptx"
    md = MarkItDown(enable_plugins=False)
    result = md.convert_stream(io.BytesIO(file_bytes), file_extension=ext)
    return result.text_content or ""


async def extract_pages(file_bytes: bytes, filename: str) -> Dict[int, dict]:
    """Returns {1-based page_num: {"text": str, "title": str | None}}.

    Raises:
        RuntimeError if MarkItDown is not installed.
        ValueError if conversion yields no extractable content.
    Caller should catch and fall back to another parser.
    """
    if not _MARKITDOWN_AVAILABLE:
        raise RuntimeError(
            "markitdown is not installed. "
            "Run `pip install markitdown[pptx]` or choose a different parser."
        )
    loop = asyncio.get_running_loop()
    markdown = await loop.run_in_executor(None, _run_markitdown_sync, file_bytes, filename)
    pages = _parse_markdown_to_pages(markdown)
    if not pages:
        raise ValueError("MarkItDown produced no extractable content")
    return pages
