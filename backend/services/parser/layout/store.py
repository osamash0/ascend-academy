"""Layout face store: build every page's Layout page, write them to lecture_layouts.

Deterministic, no AI calls, no uploads. FITZ_LOCK is taken once around repeated_places,
running_lines and footline_totals, and once per page around build_page_layout (never nested; no layout helper takes it).
One page that fails is stored as "original" (reasons ["layout failed"]); the others go on.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List
from uuid import UUID

from backend.services.parser.layout.build import LAYOUT_VERSION, build_page_layout
from backend.services.parser.layout.figures import repeated_places
from backend.services.parser.layout.furniture import footline_totals, running_lines
from backend.services.parser.page_images import FITZ_LOCK

logger = logging.getLogger(__name__)


def _per_document(doc: Any) -> tuple:
    """What is computed once per document: logos' places, running headers and footers, footline totals."""
    with FITZ_LOCK:
        return repeated_places(doc), running_lines(doc), footline_totals(doc)


def _page(doc: Any, n: int, repeated: set, running: set, totals: set) -> Dict[str, Any]:
    with FITZ_LOCK:
        return build_page_layout(doc[n - 1], n, repeated, running, totals)


def _failed(n: int) -> Dict[str, Any]:
    return {"page": n, "verdict": "original", "reasons": ["layout failed"], "blocks": [], "paths": [],
            "version": LAYOUT_VERSION}


async def compute_layouts(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """The Layout page of every page of one PDF, in page order. Writes nothing: a PDF shared by several lectures
    is built once (backfill) and written to each."""
    import fitz

    doc = await asyncio.to_thread(lambda: fitz.open(stream=pdf_bytes, filetype="pdf"))
    try:
        total = doc.page_count
        repeated, running, totals = await asyncio.to_thread(_per_document, doc)
        pages: List[Dict[str, Any]] = []
        for n in range(1, total + 1):
            try:
                pages.append(await asyncio.to_thread(_page, doc, n, repeated, running, totals))
            except Exception as exc:
                logger.warning("layout failed for page %d (stored as original): %s", n, exc)
                pages.append(_failed(n))
    finally:
        doc.close()
    return pages


async def build_layouts(lecture_id: UUID | str, pdf_bytes: bytes) -> int:
    """Build and store the Layout page of every page. Returns the number of pages written."""
    pages = await compute_layouts(pdf_bytes)
    await upsert_layouts(lecture_id, pages)
    return len(pages)


async def upsert_layouts(lecture_id: UUID | str, pages: List[Dict[str, Any]]) -> None:
    """All rows in one transaction, then the rows beyond the last page go (a re-parse of a shorter file)."""
    from backend.core.database import get_db_connection

    lid = UUID(str(lecture_id))
    async with await get_db_connection() as conn:
        async with conn.transaction():
            await conn.executemany(
                """
                INSERT INTO public.lecture_layouts (lecture_id, page, layout, version, updated_at)
                VALUES ($1, $2, $3::jsonb, $4, now())
                ON CONFLICT (lecture_id, page) DO UPDATE SET
                  layout = EXCLUDED.layout, version = EXCLUDED.version, updated_at = now()
                """,
                [(lid, p["page"], json.dumps(p), p.get("version", LAYOUT_VERSION)) for p in pages],
            )
            await conn.execute(
                "DELETE FROM public.lecture_layouts WHERE lecture_id = $1 AND page > $2",
                lid, len(pages),
            )


SERVED_ORIGINAL = ("page", "verdict", "reasons", "version")


def served(p: Dict[str, Any]) -> Dict[str, Any]:
    """What the reader gets of a page: a Layout page whole; an original page only its verdict (its blocks and
    paths are never shown)."""
    if p.get("verdict") == "layout":
        return p
    return {k: p[k] for k in SERVED_ORIGINAL if k in p}


async def load_layouts(lecture_id: UUID | str) -> List[Dict[str, Any]]:
    """The stored pages in page order; an original page's blocks and paths stay in the database (served())."""
    from backend.core.database import get_db_connection

    async with await get_db_connection() as conn:
        rows = await conn.fetch(
            """
            SELECT CASE WHEN layout->>'verdict' = 'layout' THEN layout
                        ELSE jsonb_build_object('page', layout->'page', 'verdict', layout->'verdict', 'reasons', layout->'reasons', 'version', layout->'version')
                   END AS layout
            FROM public.lecture_layouts WHERE lecture_id = $1 ORDER BY page
            """,
            UUID(str(lecture_id)),
        )
    return [json.loads(r["layout"]) if isinstance(r["layout"], str) else r["layout"] for r in rows]
