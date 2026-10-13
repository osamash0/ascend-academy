"""The Studio pass: every page of a parsed file becomes a lecture_pages row
(real-pages spec §5, amended §12).

Runs once per parse, after the reader's per-slide loop, only when
FEATURE_STUDIO_PAGES is on. Text pages are summarised in batches of 8;
image-only pages (scans, photos) go to vision page by page. A missing summary
never sinks a page; a missing picture does, because Source view needs it.

To stay well inside the job timeout on 100+ page decks, the summary calls
run while the pictures are rendered and uploaded, uploads overlap (at most
UPLOAD_CONCURRENCY), and vision reads overlap (at most VISION_CONCURRENCY).
Rows and `page` events still go out in page order.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional, Tuple
from uuid import UUID

from backend.services.parser.page_blocks import PageBlocks, extract_blocks, is_image_only
from backend.services.parser.page_images import FITZ_LOCK, render_page_webp, store_page_image
from backend.services.parser.studio_summary import summarize_text_pages
from backend.services.parser.vision_blocks import read_image_page

logger = logging.getLogger(__name__)
Emit = Callable[[str, dict], Awaitable[None]]

UPLOAD_CONCURRENCY = 4
VISION_CONCURRENCY = 3


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


async def _all(coros: Iterable[Awaitable[Any]]) -> List[Any]:
    """gather, in order; on the first failure cancel the rest and re-raise it."""
    tasks = [asyncio.ensure_future(c) for c in coros]
    try:
        return await asyncio.gather(*tasks)
    except BaseException:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise


def _render(page: Any) -> bytes:
    with FITZ_LOCK:
        return render_page_webp(page)


async def build_studio_pages(
    lecture_id: UUID | str, pdf_bytes: bytes, *, lecture_title: str, ai_model: str,
    source_language: str, emit: Emit,
) -> int:
    import fitz

    doc = await asyncio.to_thread(lambda: fitz.open(stream=pdf_bytes, filetype="pdf"))
    summaries_task: Optional[asyncio.Task] = None
    try:
        total = doc.page_count
        extracted: List[Tuple[int, PageBlocks]] = [
            (i + 1, await asyncio.to_thread(extract_blocks, doc[i], i + 1)) for i in range(total)
        ]
        pages = [doc[n - 1] for n, _ in extracted]
        text_pages = [(n, pb) for n, pb in extracted if not is_image_only(pb)]
        if text_pages:
            # Started now, awaited after the pictures: the calls overlap the uploads.
            summaries_task = asyncio.create_task(summarize_text_pages(
                text_pages, lecture_title=lecture_title, ai_model=ai_model, source_language=source_language,
            ))

        render_turn = asyncio.Lock()  # FIFO: renders go one at a time, in page order
        upload_gate = asyncio.Semaphore(UPLOAD_CONCURRENCY)

        async def picture(n: int) -> str:
            async with upload_gate:
                async with render_turn:
                    webp = await asyncio.to_thread(_render, pages[n - 1])
                return await store_page_image(lecture_id, n, webp)

        image_paths = await _all(picture(n) for n, _ in extracted)
        summaries = await summaries_task if summaries_task else {}

        vision_gate = asyncio.Semaphore(VISION_CONCURRENCY)

        async def vision(n: int) -> Dict[str, Any]:
            async with vision_gate:
                return await read_image_page(pages[n - 1], n, ai_model=ai_model, lecture_title=lecture_title,
                                             source_language=source_language)

        image_only = [n for n, pb in extracted if is_image_only(pb)]
        reads = dict(zip(image_only, await _all(vision(n) for n in image_only)))

        for (n, pb), image_path in zip(extracted, image_paths):
            if n in reads:
                read = reads[n]
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
        if summaries_task is not None and not summaries_task.done():
            summaries_task.cancel()
            await asyncio.gather(summaries_task, return_exceptions=True)
        def _close() -> None:
            with FITZ_LOCK:  # waits out a render a cancelled task left running
                doc.close()

        await asyncio.to_thread(_close)
