"""
Concept Graph API endpoints.

- POST /api/concepts/ingest/{lecture_id}    — run ingestion for one lecture
- GET  /api/concepts/student/{user_id}      — per-user mastery vector
- GET  /api/concepts/{concept_id}/related-lectures — cross-course overlap
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from backend.core.auth_middleware import require_professor, verify_token
from backend.core.database import supabase_admin
from backend.services.concept_graph import (
    compute_student_mastery,
    ingest_lecture_concepts,
    related_lectures_for_concept,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/concepts", tags=["concepts"])


class _Envelope(BaseModel):
    success: bool
    data: Any


# ── Ingestion (called from the publish flow) ────────────────────────────────

@router.post("/ingest/{lecture_id}", response_model=_Envelope)
async def ingest_lecture(lecture_id: str, user: Any = Depends(require_professor)):
    """Trigger concept-graph ingestion for a lecture the caller owns."""
    user_id = user.id if hasattr(user, "id") else user.get("id")

    def _check_owner() -> None:
        res = supabase_admin.table("lectures").select(
            "id, professor_id"
        ).eq("id", lecture_id).execute()
        rows = res.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Lecture not found.")
        if rows[0].get("professor_id") != user_id:
            raise HTTPException(status_code=403, detail="You do not own this lecture.")

    await run_in_threadpool(_check_owner)

    try:
        report = await ingest_lecture_concepts(lecture_id)
    except Exception as e:
        logger.error("Concept ingestion failed for %s: %s", lecture_id, e, exc_info=True)
        raise HTTPException(status_code=502, detail="Concept ingestion failed.")
    return _Envelope(success=True, data=report)


# ── Per-user mastery vector ─────────────────────────────────────────────────

@router.get("/student/{user_id}", response_model=_Envelope)
async def get_student_mastery(user_id: str, user: Any = Depends(verify_token)):
    """Return ``{vector, mastered, weak}`` for the requested user.

    Students may only request their own vector.  Professors may request any
    student's vector for analytics.
    """
    caller_id = user.id if hasattr(user, "id") else user.get("id")
    if caller_id != user_id:
        is_prof = await run_in_threadpool(_caller_is_professor, caller_id)
        if not is_prof:
            raise HTTPException(status_code=403, detail="Access denied.")

    try:
        data = await compute_student_mastery(user_id)
    except Exception as e:
        logger.error("Failed to compute mastery for %s: %s", user_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to compute mastery.")
    return _Envelope(success=True, data=data)


# ── Related lectures across courses ─────────────────────────────────────────

@router.get("/{concept_id}/related-lectures", response_model=_Envelope)
async def get_related_lectures(
    concept_id: str,
    exclude_lecture_id: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=50),
    user: Any = Depends(verify_token),  # auth-gated, no extra ownership check
):
    try:
        data = await related_lectures_for_concept(
            concept_id,
            exclude_lecture_id=exclude_lecture_id,
            limit=limit,
        )
    except Exception as e:
        logger.error("Failed to load related lectures for %s: %s", concept_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load related lectures.")
    return _Envelope(success=True, data=data)


# ─── Helpers ────────────────────────────────────────────────────────────────

def _caller_is_professor(user_id: str) -> bool:
    try:
        res = supabase_admin.table("user_roles").select("role").eq(
            "user_id", user_id
        ).eq("role", "professor").execute()
        return bool(res.data)
    except Exception as e:
        logger.warning("Role lookup failed for %s: %s", user_id, e)
        return False
