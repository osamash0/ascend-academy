"""Lecture PDFs rewritten so the reader's first page arrives sooner.

The reader opens a PDF with pdf.js, which reads it in byte ranges: to open the
file and draw page 1 it fetches only the pieces it needs. In the files lecturers
upload, the small objects those first steps touch -- catalog, page tree, fonts --
are scattered through the whole file, so page 1 costs a dozen or more ranges
spread end to end. Rewriting the file with qpdf and packing those objects into
compressed object streams gathers them into a few. Measured on 2026-10-26 on
four real decks (OnlyOffice and PowerPoint exports, 427 pages), with 16 KB
ranges over a 10 Mbit link, page 1 needed 23-95% fewer bytes (1450 -> 67 KB on
the PowerPoint deck), with no change to any page's pixels, text, links or
outline.

Two things that look like they would do this and do not:

* Linearizing ("fast web view") barely helped -- pdf.js makes little use of
  it.
* PyMuPDF's ``save(garbage=..., use_objstms=True)`` packs objects as well as
  qpdf does, but on the PowerPoint deck it visibly changed 5 pages (charts
  lost their antialiasing). It is not lossless; do not swap it in.

Only the copy the reader is served (``lecture-pdfs``) is rewritten. The upload
itself stays as it was in ``pdf-uploads``, keyed by its hash, so a re-parse
always starts from the original. Any doubt about the rewrite -- an error, an
encrypted file, a page count that changed, a file that grew noticeably -- keeps
the original: a slower first page is better than a wrong one.
"""

from __future__ import annotations

import io
import logging
import os

logger = logging.getLogger(__name__)

# A rewrite this much larger than the original is kept out: the reader would
# fetch the whole file for nothing. On the decks measured, it was 1-3% smaller.
MAX_GROWTH = 1.10


def enabled() -> bool:
    """Kill switch: ``PDF_COMPACT_ON_UPLOAD=0`` stores uploads as they came."""
    return os.getenv("PDF_COMPACT_ON_UPLOAD", "1").strip().lower() not in ("0", "false", "no", "off")


def compact_for_reading(pdf_bytes: bytes) -> bytes:
    """The PDF rewritten for byte-range reading, or ``pdf_bytes`` unchanged.

    Never raises: this is an optimisation, and the parse must not fail on it.
    CPU-bound (0.3-2.3 s on the decks measured) -- call it off the event loop.
    """
    if not enabled() or not pdf_bytes:
        return pdf_bytes
    try:
        import pikepdf
    except ImportError as exc:  # pragma: no cover - dependency is pinned
        logger.warning("PDF compaction unavailable (missing dependency): %s", exc)
        return pdf_bytes

    try:
        with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
            # Rewriting an encrypted file would drop or alter its protection.
            if pdf.is_encrypted:
                return pdf_bytes
            pages = len(pdf.pages)
            out = io.BytesIO()
            pdf.save(
                out,
                object_stream_mode=pikepdf.ObjectStreamMode.generate,
                compress_streams=True,
            )
        compacted = out.getvalue()

        with pikepdf.open(io.BytesIO(compacted)) as check:
            if len(check.pages) != pages:
                logger.warning("PDF compaction changed the page count (%d -> %d); kept the original",
                               pages, len(check.pages))
                return pdf_bytes
    except Exception as exc:  # noqa: BLE001 — an optimisation must never fail the parse
        logger.warning("PDF compaction failed; kept the original: %s", exc)
        return pdf_bytes

    if len(compacted) > len(pdf_bytes) * MAX_GROWTH:
        logger.info("PDF compaction grew the file (%d -> %d bytes); kept the original",
                    len(pdf_bytes), len(compacted))
        return pdf_bytes
    return compacted
