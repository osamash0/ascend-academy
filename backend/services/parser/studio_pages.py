"""The Studio pass: every page of a parsed file becomes a lecture_pages row
(real-pages spec §5, amended §12).

Runs once per parse, after the reader's per-slide loop, only when
FEATURE_STUDIO_PAGES is on. Text pages are summarised in batches of 8;
image-only pages (scans, photos) go to vision one by one. A missing summary
never sinks a page; a missing picture does, because Source view needs it.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable, Dict, List, Tuple
from uuid import UUID

from backend.services.parser.page_blocks import PageBlocks, extract_blocks, is_image_only
from backend.services.parser.page_images import render_page_webp, store_page_image
from backend.services.parser.studio_summary import summarize_text_pages
from backend.services.parser.vision_blocks import read_image_page

logger = logging.getLogger(__name__)
Emit = Callable[[str, dict], Awaitable[None]]


async def upsert_lecture_page(lecture_id: UUID | str, row: Dict[str, Any]) -> None:
    from backend.core.database import get_db_connection

    async with await get_db_connection() as conn:
        await conn.execute(
            """
            INSERT INTO public.lecture_pages
              (lecture_id, page, width, height, image_path, geometry, blocks, summary, status, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, now())
            ON CONFLICT (lecture_id, page) DO UPDATE SET
              width = EXCLUDED.width, height = EXCLUDED.height, image_path = EXCLUDED.image_path,
              geometry = EXCLUDED.geometry, blocks = EXCLUDED.blocks, summary = EXCLUDED.summary,
              status = EXCLUDED.status, updated_at = now()
            """,
            UUID(str(lecture_id)), row["page"], row["width"], row["height"], row["image_path"],
            row["geometry"], json.dumps(row["blocks"]), json.dumps(row["summary"]), row["status"],
        )


async def delete_pages_after(lecture_id: UUID | str, last_page: int) -> None:
    """A re-parse of a shorter file must not leave stale pages behind."""
    from backend.core.database import get_db_connection

    async with await get_db_connection() as conn:
        await conn.execute(
            "DELETE FROM public.lecture_pages WHERE lecture_id = $1 AND page > $2",
            UUID(str(lecture_id)), last_page,
        )


async def build_studio_pages(
    lecture_id: UUID | str, pdf_bytes: bytes, *, lecture_title: str, ai_model: str,
    source_language: str, emit: Emit,
) -> int:
    import fitz

    doc = await asyncio.to_thread(lambda: fitz.open(stream=pdf_bytes, filetype="pdf"))
    try:
        total = doc.page_count
        extracted: List[Tuple[int, PageBlocks]] = [
            (i + 1, await asyncio.to_thread(extract_blocks, doc[i], i + 1)) for i in range(total)
        ]
        text_pages = [(n, pb) for n, pb in extracted if not is_image_only(pb)]
        summaries = await summarize_text_pages(
            text_pages, lecture_title=lecture_title, ai_model=ai_model, source_language=source_language,
        ) if text_pages else {}

        for n, pb in extracted:
            page = doc[n - 1]
            webp = await asyncio.to_thread(render_page_webp, page)
            image_path = await store_page_image(lecture_id, n, webp)
            if is_image_only(pb):
                read = await read_image_page(page, n, ai_model=ai_model, lecture_title=lecture_title,
                                             source_language=source_language)
                geometry, blocks, paragraphs = read["geometry"], read["blocks"], read["paragraphs"]
            else:
                geometry, blocks = "block", pb["blocks"]
                footers = set(pb["footers"])
                paragraphs = [
                    {"markdown": p["markdown"], "covers": [c for c in p["covers"] if c not in footers]}
                    for p in summaries.get(n, [])
                ]
            status = "ready" if paragraphs else "needs_review"
            await upsert_lecture_page(lecture_id, {
                "page": n, "width": round(pb["width"], 2), "height": round(pb["height"], 2),
                "image_path": image_path, "geometry": geometry, "blocks": blocks,
                "summary": paragraphs, "status": status,
            })
            await emit("page", {"page": n, "total": total, "geometry": geometry, "status": status})
        await delete_pages_after(lecture_id, total)
        return total
    finally:
        doc.close()
