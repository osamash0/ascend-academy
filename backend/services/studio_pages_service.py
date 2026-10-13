"""Studio pages for one material, in the exact shape of
src/features/spaces/studio/types.ts (real-pages spec §6)."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from backend.core.config import settings
from backend.services.parser.page_images import PAGES_BUCKET
from backend.services.v4_reader_service import can_view_lecture

logger = logging.getLogger(__name__)

SIGNED_TTL = 3600


class NotVisible(Exception):
    pass


class StillDeveloping(Exception):
    pass


def stage_of(status: Optional[str]) -> str:
    if status == "completed":
        return "ready"
    if status in ("failed", "cancelled"):
        return "failed"
    return "developing"


def _j(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


def shape_pages(material_id: str, rows: List[Dict[str, Any]], signed: Dict[str, str]) -> Dict[str, Any]:
    pages, summaries = [], []
    for r in rows:
        blocks = _j(r["blocks"]) or []
        pages.append({
            "materialId": material_id, "page": r["page"], "width": r["width"], "height": r["height"],
            "imageUrl": signed.get(r["image_path"], ""), "geometry": r["geometry"],
            "blocks": blocks if r["geometry"] == "block" else [],
        })
        for k, p in enumerate(_j(r["summary"]) or [], start=1):
            summaries.append({
                "id": f"s-p{r['page']}-{k}", "origin": "summary", "markdown": p["markdown"],
                "source": {"materialId": material_id, "page": r["page"], "blockIds": list(p.get("covers") or [])},
                "gist": k == 1, "edited": False,
            })
    return {"materialId": material_id, "pages": pages, "summaries": summaries}


async def _total_pages(lecture_id: UUID) -> int:
    from backend.core.database import get_db_connection

    async with await get_db_connection() as conn:
        return int(await conn.fetchval("SELECT coalesce(total_slides, 0) FROM lectures WHERE id = $1", lecture_id) or 0)


async def _latest_run_status(lecture_id: UUID) -> Optional[str]:
    """Status of the newest parse run that produced this lecture, or None
    for a lecture no run row points at (legacy or seeded)."""
    from backend.core.database import get_db_connection

    async with await get_db_connection() as conn:
        return await conn.fetchval(
            "SELECT status FROM parse_runs WHERE lecture_id = $1 ORDER BY started_at DESC LIMIT 1",
            lecture_id,
        )


async def _rows(lecture_id: UUID) -> List[Dict[str, Any]]:
    from backend.core.database import get_db_connection

    async with await get_db_connection() as conn:
        rows = await conn.fetch(
            "SELECT page, width, height, image_path, geometry, blocks, summary, status "
            "FROM lecture_pages WHERE lecture_id = $1 ORDER BY page",
            lecture_id,
        )
    return [dict(r) for r in rows]


async def _sign(paths: List[str]) -> Dict[str, str]:
    from backend.core.database import supabase_admin

    def _do() -> Dict[str, str]:
        res = supabase_admin.storage.from_(PAGES_BUCKET).create_signed_urls(paths, SIGNED_TTL)
        out: Dict[str, str] = {}
        for item in res or []:
            url = item.get("signedURL") or item.get("signedUrl")
            if item.get("path") and url and not item.get("error"):
                out[item["path"]] = url
        if len(out) < len(paths):
            logger.warning("studio pages: %d of %d page pictures came back unsigned",
                           len(paths) - len(out), len(paths))
        return out

    return await asyncio.to_thread(_do)


async def get_pages(lecture_id: str, user_id: str) -> Dict[str, Any]:
    lid = UUID(lecture_id)
    if not await can_view_lecture(lid, user_id):
        raise NotVisible()
    # Flag off: 404 like any lecture without pages, and lecture_pages is never read.
    if not settings.feature_studio_pages:
        raise NotVisible()
    # The run decides, not lectures.total_slides: a failed parse still
    # finalizes total_slides and may leave a partial set of page rows.
    status = await _latest_run_status(lid)
    if status is None:
        if await _total_pages(lid) == 0:
            raise StillDeveloping()
    elif status in ("failed", "cancelled"):
        raise NotVisible()
    elif status != "completed":
        raise StillDeveloping()
    rows = await _rows(lid)
    if not rows:
        raise NotVisible()
    if [r["page"] for r in rows] != list(range(1, len(rows) + 1)):
        logger.warning("studio pages for lecture %s are not contiguous from 1: %s",
                       lid, [r["page"] for r in rows])
        raise NotVisible()
    signed = await _sign([r["image_path"] for r in rows])
    return shape_pages(lecture_id, rows, signed)
