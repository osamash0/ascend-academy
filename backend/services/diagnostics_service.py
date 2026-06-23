import logging
from typing import Any, Dict, List, Optional
from backend.core.database import supabase_admin
from backend.services.cache import get_cached_parse_meta, get_cached_slide_results, get_pipeline_run
from backend.services.diagnostics import flag_suspicious
from backend.repositories.lecture_repo import list_lectures_by_pdf_hash

logger = logging.getLogger(__name__)

async def check_duplicate_pdf(user_id: str, pdf_hash: str) -> List[Dict[str, Any]]:
    """Return the current professor's lectures that already use this PDF."""
    try:
        from backend.core import database as _db
        matches = list_lectures_by_pdf_hash(_db.supabase_admin, user_id, pdf_hash)
        return matches
    except Exception as e:
        logger.error("check-duplicate lookup failed: %s", e)
        raise ValueError("Duplicate lookup failed.")

async def check_parse_cache(pdf_hash: str) -> Dict[str, Any]:
    """Tell the caller whether `pdf_parse_cache` already has a parse for this PDF."""
    try:
        meta = await get_cached_parse_meta(pdf_hash)
    except Exception as e:
        logger.error("check-parse-cache lookup failed: %s", e)
        raise ValueError("Cache lookup failed.")

    if meta is None:
        return {"cached": False, "parsed_at": None}
    return {"cached": True, "parsed_at": meta.get("parsed_at")}

async def get_pdf_diagnostics(user_id: str, pdf_hash: str, pipeline_version: str) -> Dict[str, Any]:
    """Routing telemetry for a parsed PDF."""
    try:
        owned_res = (
            supabase_admin.table("lectures")
            .select("id, professor_id, pdf_hash")
            .eq("pdf_hash", pdf_hash)
            .eq("professor_id", user_id)
            .limit(1)
            .execute()
        )
        if owned_res.data:
            pass
        else:
            any_res = (
                supabase_admin.table("lectures")
                .select("id")
                .eq("pdf_hash", pdf_hash)
                .limit(1)
                .execute()
            )
            if not (any_res.data or []):
                raise FileNotFoundError("No lecture found for this pdf_hash.")
            raise PermissionError("Not your lecture.")
    except (FileNotFoundError, PermissionError):
        raise
    except Exception as e:
        logger.error("diagnostics ownership lookup failed: %s", e)
        raise ValueError("Authorization check failed.")

    cached = await get_cached_slide_results(pdf_hash, pipeline_version)
    per_slide: List[Dict[str, Any]] = []
    for slide_index in sorted(cached):
        slide = cached[slide_index] or {}
        meta = slide.get("_meta") or {}
        per_slide.append({
            "slide_index": slide_index,
            "route": meta.get("route") or "",
            "route_reason": meta.get("route_reason") or "",
            "layout_features": meta.get("layout_features") or {},
            "has_parse_error": bool(slide.get("parse_error")),
        })

    run_metrics = await get_pipeline_run(pdf_hash, pipeline_version)
    flags = flag_suspicious(per_slide)

    return {
        "pdf_hash": pdf_hash,
        "pipeline_version": pipeline_version,
        "run_metrics": run_metrics,
        "per_slide": per_slide,
        "flags": flags,
    }
