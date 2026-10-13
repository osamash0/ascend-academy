"""One picture per page, for Studio's Source view, Peek and Morph (real-pages spec §4.2, §5.2).

Same rendering and caching rules as the poster (see poster.py for why the
storage3 cache-control key is hyphenated). Unlike the poster, a page picture
is not decorative: Source view needs every page, so a failed upload is retried
and then raised, and the caller fails the page.
"""
from __future__ import annotations

import asyncio
import io
import logging
from typing import Any
from uuid import UUID

logger = logging.getLogger(__name__)

PAGES_BUCKET = "lecture-pages"
PAGE_WIDTH = 1440
PAGE_QUALITY = 80
PAGE_CACHE_CONTROL = "31536000"


MAX_PIXEL_HEIGHT = 16383  # WebP's hard limit


def render_page_webp(page: Any, *, width: int = PAGE_WIDTH) -> bytes:
    import fitz  # PyMuPDF
    from PIL import Image

    zoom = min(width / (page.rect.width or float(width)), MAX_PIXEL_HEIGHT / (page.rect.height or float(MAX_PIXEL_HEIGHT)))
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    buf = io.BytesIO()
    image.save(buf, format="WEBP", quality=PAGE_QUALITY, method=6)
    return buf.getvalue()


def page_image_path(lecture_id: UUID | str, page_no: int) -> str:
    """Segment 2 is the lecture id, as for lecture-pdfs and lecture-posters."""
    return f"lectures/{lecture_id}/p{page_no}.webp"


def _admin_client():
    from backend.core.database import get_client

    return get_client(use_admin=True)


async def store_page_image(lecture_id: UUID | str, page_no: int, webp: bytes, *, attempts: int = 3) -> str:
    path = page_image_path(lecture_id, page_no)

    def _upload() -> None:
        _admin_client().storage.from_(PAGES_BUCKET).upload(
            path,
            webp,
            file_options={"content-type": "image/webp", "upsert": "true", "cache-control": PAGE_CACHE_CONTROL},
        )

    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            await asyncio.to_thread(_upload)
            return path
        except Exception as exc:  # storage3 raises a mix of types
            last = exc
            logger.warning("page image upload %s failed (attempt %d/%d): %s", path, attempt, attempts, exc)
            await asyncio.sleep(0.2 * attempt)
    raise RuntimeError(f"page image upload failed for {path}: {last}")
