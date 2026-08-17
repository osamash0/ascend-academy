"""Lecture poster (hero key art) rendering.

The console hero used to paint its backdrop by handing the lecture's source PDF
to react-pdf and rendering page 1. pdf.js auto-fetches the rest of a document,
so every focused lecture pulled its whole PDF -- 1.6 MB on average, up to 7 MB --
purely as decoration. That was the dominant contributor to the Supabase egress
overage.

A poster is a small WebP render of page 1, produced from the PDF bytes the parser
already holds in memory, so generating one costs no egress.

On caching, measured against this project's storage on 2026-08-17: these buckets
are private and read through signed URLs, and for that path Supabase derives the
response's ``Expires`` from the *signed-URL token's* lifetime, not from the
object's stored ``cache-control``. What actually produces a CDN hit is requesting
a byte-identical URL -- the frontend caches each signed URL per object for that
reason (see resolveSignedUrl in src/services/lectureService.ts). The one-year
``cache-control`` set below is correct hygiene and matters for any direct or
public-bucket read, but it is not the lever that fixed egress here.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional
from uuid import UUID

logger = logging.getLogger(__name__)

POSTER_BUCKET = "lecture-posters"

# Wide enough to stay crisp full-bleed behind the hero on a 2x display without
# the file growing past ~100 KB. LectureBackdrop renders at width=1440.
POSTER_WIDTH = 1440

# WebP quality. 72 is visually indistinguishable at this size once the hero's
# darkening gradients are layered over it, and lands well under 100 KB.
POSTER_QUALITY = 72

# Immutable content -- a poster only changes if the lecture's PDF is replaced,
# which writes a new object at the same path via upsert.
#
# NOTE the key spelling at the call site: the Python storage3 client reads
# ``file_options["cache-control"]`` (hyphenated) and formats it as
# ``max-age=<value>``. ``cacheControl`` is the *JavaScript* client's spelling;
# passing it here is silently ignored and the object lands as ``no-cache``, which
# forbids CDN caching outright and is worse than the 3600s default.
POSTER_CACHE_CONTROL = "31536000"


def render_poster(pdf_bytes: bytes, *, width: int = POSTER_WIDTH) -> Optional[bytes]:
    """Render page 1 of ``pdf_bytes`` to a WebP image.

    Returns ``None`` if the PDF has no pages or cannot be rasterised -- key art
    is decorative, so a failure must never fail the parse.
    """
    try:
        import fitz  # PyMuPDF
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - dependency is pinned
        logger.warning("poster render unavailable (missing dependency): %s", exc)
        return None

    import io

    doc = None
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        if doc.page_count == 0:
            return None
        page = doc.load_page(0)

        # Scale so the rendered pixmap is `width` px wide regardless of the
        # page's native size, which varies between slide decks and A4 handouts.
        page_width = page.rect.width or float(width)
        zoom = width / page_width
        pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)

        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        buffer = io.BytesIO()
        image.save(buffer, format="WEBP", quality=POSTER_QUALITY, method=6)
        return buffer.getvalue()
    except Exception as exc:
        logger.warning("poster render failed (non-fatal): %s", exc)
        return None
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:
                pass


def poster_path(lecture_id: UUID | str) -> str:
    """Storage path for a lecture's poster.

    Segment 2 must be the lecture id -- the bucket's RLS policies derive
    ownership from it (see 20260817010000_lecture_posters.sql).
    """
    return f"lectures/{lecture_id}/poster.webp"


async def store_lecture_poster(
    lecture_id: UUID | str, pdf_bytes: bytes
) -> Optional[str]:
    """Render and upload a lecture poster. Returns its storage path, or ``None``
    if rendering or upload failed. Non-fatal by design."""
    webp = await asyncio.to_thread(render_poster, pdf_bytes)
    if not webp:
        return None

    path = poster_path(lecture_id)

    def _upload() -> None:
        from backend.core.database import get_client

        sb = get_client(use_admin=True)
        sb.storage.from_(POSTER_BUCKET).upload(
            path,
            webp,
            file_options={
                "content-type": "image/webp",
                "upsert": "true",
                "cache-control": POSTER_CACHE_CONTROL,
            },
        )

    try:
        await asyncio.to_thread(_upload)
        logger.info(
            "poster stored for lecture %s (%.1f KB)", lecture_id, len(webp) / 1024
        )
        return path
    except Exception as exc:
        logger.warning("poster upload failed (non-fatal): %s", exc)
        return None
