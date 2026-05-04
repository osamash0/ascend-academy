"""
Stateless, thread-safe PDF accessor built on PyMuPDF (fitz).

Each method opens a fresh fitz.Document inside a thread worker and closes it
before returning — no shared document state, no thread-safety issues.
Pixmaps are created and nullified inside the thread so C-backed memory is
released before the bytes object crosses back to the async caller.
"""
import asyncio
import logging
from typing import Any, Dict, List, Optional

import fitz

logger = logging.getLogger(__name__)


class PDFReader:
    """
    Stateless PDF accessor.  Stores only the raw pdf_bytes (immutable).
    Every public method dispatches a sync worker to the thread pool; each
    worker opens its own fitz.Document and closes it before returning.
    """

    def __init__(self, pdf_bytes: bytes) -> None:
        self._bytes = pdf_bytes

    # ------------------------------------------------------------------
    # Metadata
    # ------------------------------------------------------------------

    async def get_page_count(self) -> int:
        def _sync(b: bytes) -> int:
            doc = fitz.open(stream=b, filetype="pdf")
            try:
                return len(doc)
            finally:
                doc.close()

        return await asyncio.to_thread(_sync, self._bytes)

    async def get_toc(self) -> List[Dict[str, Any]]:
        def _sync(b: bytes) -> List[Dict[str, Any]]:
            doc = fitz.open(stream=b, filetype="pdf")
            try:
                return [
                    {"level": entry[0], "title": entry[1], "page": entry[2]}
                    for entry in doc.get_toc()
                ]
            finally:
                doc.close()

        return await asyncio.to_thread(_sync, self._bytes)

    # ------------------------------------------------------------------
    # Per-page accessors (open-process-close in one thread call)
    # ------------------------------------------------------------------

    async def get_page_dict(self, page_index: int) -> dict:
        """Returns page.get_text('dict') — text blocks with font/bbox metadata."""
        def _sync(b: bytes, idx: int) -> dict:
            doc = fitz.open(stream=b, filetype="pdf")
            try:
                return doc[idx].get_text("dict")
            finally:
                doc.close()

        return await asyncio.to_thread(_sync, self._bytes, page_index)

    async def find_tables(self, page_index: int) -> list:
        """Returns list of table objects detected by PyMuPDF (empty list if none)."""
        def _sync(b: bytes, idx: int) -> list:
            doc = fitz.open(stream=b, filetype="pdf")
            try:
                result = doc[idx].find_tables()
                return result.tables if result else []
            except Exception:
                return []
            finally:
                doc.close()

        return await asyncio.to_thread(_sync, self._bytes, page_index)

    async def get_drawings(self, page_index: int) -> list:
        """Returns list of vector drawing paths on the page."""
        def _sync(b: bytes, idx: int) -> list:
            doc = fitz.open(stream=b, filetype="pdf")
            try:
                return doc[idx].get_drawings()
            finally:
                doc.close()

        return await asyncio.to_thread(_sync, self._bytes, page_index)

    async def render_page_jpeg(self, page_index: int, zoom: float = 2.0) -> bytes:
        """
        Renders a page to JPEG bytes at the given zoom level.

        The fitz.Pixmap is created and nullified *inside the thread worker*
        before the bytes object is returned — the C-backed pixmap memory is
        freed before control returns to the async caller.
        """
        def _sync(b: bytes, idx: int, z: float) -> bytes:
            doc = fitz.open(stream=b, filetype="pdf")
            try:
                page = doc[idx]
                pix = page.get_pixmap(matrix=fitz.Matrix(z, z))
                data = pix.tobytes("jpg")
                pix = None      # drop Pixmap reference
                del pix         # ensure C memory is reclaimed
                return data
            finally:
                doc.close()

        return await asyncio.to_thread(_sync, self._bytes, page_index, zoom)

    async def get_page_rect(self, page_index: int) -> tuple:
        """Returns (width, height) of the page in points."""
        def _sync(b: bytes, idx: int) -> tuple:
            doc = fitz.open(stream=b, filetype="pdf")
            try:
                r = doc[idx].rect
                return (r.width, r.height)
            finally:
                doc.close()

        return await asyncio.to_thread(_sync, self._bytes, page_index)
