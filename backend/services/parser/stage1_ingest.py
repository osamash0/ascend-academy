"""Stage 1 — Deterministic ingestion.

Extracts text via Docling (reading-order aware), rasterizes pages via PyMuPDF,
applies generator-aware routing, strips repeating headers/footers, and writes
one ExtractedPage row per page into parse_pages.

Memory contract (P3):
  - Docling runs in a thread worker with a fixed memory footprint.
  - JPEG bytes are uploaded to Supabase Storage immediately and then freed.
  - No large buffers persist after this stage.
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from io import BytesIO
from typing import Optional
from uuid import UUID

from backend.core.database import get_client
from backend.domain.parse_models import ExtractedPage, SlideRoute
from backend.services.parser import repos
from backend.services.parser.classifier import (
    GeneratorFormat,
    detect_generator,
    find_repeating_lines,
    route_page,
    strip_repeating_lines,
)
from backend.services.pdf_reader import PDFReader

logger = logging.getLogger(__name__)

_EXTRACT_SEM = asyncio.Semaphore(8)


# ── Docling extraction ────────────────────────────────────────────────────────


def _docling_extract_sync(pdf_bytes: bytes) -> dict[int, str]:
    """Extract page text using Docling in-process (called inside to_thread).

    Returns dict[page_index (0-based), text].
    Falls back silently to empty dict so the caller can use PyMuPDF instead.
    """
    try:
        from docling.document_converter import DocumentConverter
        from docling.datamodel.base_models import DocumentStream

        converter = DocumentConverter()
        stream = DocumentStream(name="document.pdf", stream=BytesIO(pdf_bytes))
        result = converter.convert(stream)
        doc = result.document

        page_texts: dict[int, list[str]] = defaultdict(list)
        for item in doc.texts:
            if item.prov:
                page_no = item.prov[0].page_no  # 1-based
                page_texts[page_no - 1].append(item.text)

        return {idx: "\n".join(texts) for idx, texts in page_texts.items()}
    except Exception as e:
        logger.warning("Docling extraction failed — will fall back to PyMuPDF: %s", e)
        return {}


def _pymupdf_page_text_sync(pdf_bytes: bytes, page_index: int) -> str:
    """Extract text from a single page via PyMuPDF (fallback)."""
    import fitz

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page_dict = doc[page_index].get_text("dict")
        parts: list[str] = []
        for block in page_dict.get("blocks", []):
            if block.get("type") == 0:
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        t = span.get("text", "").strip()
                        if t:
                            parts.append(t)
        return " ".join(parts)
    finally:
        doc.close()


def _page_visual_features_sync(pdf_bytes: bytes, page_index: int) -> dict:
    """Extract image_count, drawing_count, image_coverage for one page."""
    import fitz

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        rect = page.rect
        page_area = rect.width * rect.height

        images = page.get_images(full=True)
        drawings = page.get_drawings()

        # image coverage: sum of image bboxes that individually exceed 5% of page
        image_coverage = 0.0
        for img in images:
            try:
                xrefs = page.get_image_rects(img[0])
                for bbox in xrefs:
                    area = abs(bbox.width * bbox.height)
                    if area / page_area >= 0.05:
                        image_coverage += area / page_area
            except Exception:
                pass
        image_coverage = min(image_coverage, 1.0)

        return {
            "image_count": len(images),
            "drawing_count": len(drawings),
            "image_coverage": image_coverage,
            "has_table": bool(page.find_tables().tables),
        }
    except Exception:
        return {"image_count": 0, "drawing_count": 0, "image_coverage": 0.0, "has_table": False}
    finally:
        doc.close()


# ── JPEG upload ───────────────────────────────────────────────────────────────


async def _upload_jpeg(run_id: UUID, page_index: int, jpeg_bytes: bytes) -> str:
    """Upload a rasterized page JPEG to Supabase Storage and return the path."""
    path = f"pdf_pages/{run_id}/{page_index}.jpg"
    try:
        sb = get_client(use_admin=True)
        sb.storage.from_("pdf-pages").upload(
            path,
            jpeg_bytes,
            file_options={"content-type": "image/jpeg", "upsert": "true"},
        )
        return path
    except Exception as e:
        logger.warning("JPEG upload failed for run %s page %d: %s", run_id, page_index, e)
        return ""


# ── Per-page extraction ───────────────────────────────────────────────────────


async def _extract_one(
    pdf_bytes: bytes,
    reader: PDFReader,
    page_index: int,
    docling_text: str,
    generator: GeneratorFormat,
    repeating_lines: frozenset[str],
    run_id: UUID,
) -> ExtractedPage:
    async with _EXTRACT_SEM:
        # Visual features (PyMuPDF, fast)
        features = await asyncio.to_thread(
            _page_visual_features_sync, pdf_bytes, page_index
        )

        # Text — prefer Docling; fall back to PyMuPDF per-page
        if docling_text:
            text = strip_repeating_lines(docling_text, repeating_lines)
        else:
            raw = await asyncio.to_thread(_pymupdf_page_text_sync, pdf_bytes, page_index)
            text = strip_repeating_lines(raw, repeating_lines)

        char_count = len(text.replace(" ", "").replace("\n", ""))
        word_count = len(text.split())

        # Math heuristic — simple but sufficient
        has_math = any(
            c in text
            for c in "∑∫∂∇∈∉⊆⊇∪∩≤≥≠αβγδεζηθλμνπρσφψω"
        )

        route = route_page(
            generator=generator,
            char_count=char_count,
            image_count=features["image_count"],
            drawing_count=features["drawing_count"],
            image_coverage=features["image_coverage"],
            has_math=has_math,
        )

        image_url: Optional[str] = None
        if route in (SlideRoute.VISION, SlideRoute.MIXED):
            jpeg = await reader.render_page_jpeg(page_index, zoom=1.5)
            image_url = await _upload_jpeg(run_id, page_index, jpeg)
            del jpeg  # free immediately after upload

        return ExtractedPage(
            page_index=page_index,
            text=text,
            word_count=word_count,
            has_vector_drawings=features["drawing_count"] > 0,
            image_count=features["image_count"],
            table_count=int(features["has_table"]),
            image_url=image_url or None,
            route=route,
        )


# ── Public API ────────────────────────────────────────────────────────────────


async def ingest(
    pdf_bytes: bytes,
    run_id: UUID,
    reader: PDFReader,
    *,
    emit,
) -> list[ExtractedPage]:
    """Stage 1 entry point.

    Extracts all pages, writes ExtractedPage rows to parse_pages, and emits
    SSE ``page_extracted`` events via the provided ``emit`` callable.

    Args:
        pdf_bytes: Raw PDF bytes (kept by orchestrator, not copied).
        run_id: The current parse run UUID.
        reader: PDFReader wrapping the same bytes.
        emit: Async callable (event_type: str, data: dict) → None.

    Returns:
        List of ExtractedPage in page_index order.
    """
    page_count = await reader.get_page_count()
    await repos.ensure_page_rows(run_id, page_count)
    await repos.set_page_count(run_id, page_count)

    # Detect source format (synchronous, cheap)
    generator = await asyncio.to_thread(detect_generator, pdf_bytes)
    logger.info("Run %s: detected generator=%s, %d pages", run_id, generator, page_count)

    # Docling full-document extraction (one call, in thread)
    docling_texts = await asyncio.to_thread(_docling_extract_sync, pdf_bytes)

    # Build repeating-line filter from Docling text (or fallback per-page text)
    pages_text_sample = list(docling_texts.values()) or []
    repeating = find_repeating_lines(pages_text_sample)

    # Per-page concurrent extraction
    tasks = [
        _extract_one(
            pdf_bytes=pdf_bytes,
            reader=reader,
            page_index=i,
            docling_text=docling_texts.get(i, ""),
            generator=generator,
            repeating_lines=repeating,
            run_id=run_id,
        )
        for i in range(page_count)
    ]
    extracted: list[ExtractedPage] = await asyncio.gather(*tasks)

    # Write to DB and emit SSE events
    for page in extracted:
        await repos.commit_extract(run_id, page)
        await emit("page_extracted", {"page": page.page_index + 1, "total": page_count, "route": page.route.value})

    return list(extracted)
