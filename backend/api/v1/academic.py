"""Academic catalog administration API.

Catalog READS and student-linkage WRITES are handled by SECURITY DEFINER RPCs
(see migration 20260615000000) and called directly from the frontend Supabase
client — they need no FastAPI surface. This router only exposes the admin-only
scraper controls.

Triggering is synchronous: there is no task queue yet (only an in-process nudge
scheduler), and the Marburg CS catalog is small enough to ingest in a few
seconds. When the planned Arq pipeline lands, this becomes an enqueue.
"""
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.core.auth_middleware import require_role
from backend.core.database import supabase_admin
from backend.core.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/academic", tags=["academic"])

require_admin = require_role("admin")


class ScrapeRequest(BaseModel):
    source: str = "marburg"


@router.post("/scrape")
@limiter.limit("2/hour")
async def trigger_scrape(body: ScrapeRequest, request: Request, user: Any = Depends(require_admin)):
    """Run a catalog scrape + ingest for the given source (admin only).

    Synchronous by design for the FOUNDATION phase (small catalog, no queue).
    """
    from backend.services.academic.ingest import run as run_ingest

    try:
        summary = await run_ingest(body.source)
        return {"success": True, "data": summary}
    except KeyError as e:
        logger.error("Catalog scrape configuration error: %s", e)
        raise HTTPException(status_code=400, detail="Invalid scrape configuration.")
    except Exception as e:
        logger.error("Catalog scrape failed for %s: %s", body.source, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Catalog scrape failed.")


@router.get("/sources")
@limiter.limit("30/minute")
async def list_sources(request: Request, user: Any = Depends(require_admin)):
    """Per-source freshness/provenance summary across the catalog tables."""
    try:
        out = []
        # Each university anchors a source; report its freshness + child counts.
        unis = supabase_admin.table("universities").select(
            "id,name,source,external_ref,last_scraped_at"
        ).execute()
        for u in (unis.data or []):
            fac = supabase_admin.table("faculties").select(
                "id", count="exact"
            ).eq("source", u["source"]).execute()
            crs = supabase_admin.table("catalog_courses").select(
                "id", count="exact"
            ).eq("source", u["source"]).execute()
            out.append({
                "source": u["source"],
                "university": u["name"],
                "last_scraped_at": u.get("last_scraped_at"),
                "faculties": fac.count or 0,
                "courses": crs.count or 0,
            })
        return {"success": True, "data": out}
    except Exception as e:
        logger.error("List catalog sources failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load catalog sources.")
