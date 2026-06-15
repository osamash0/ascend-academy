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
    concepts_for_lecture,
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
    student's vector for analytics if they share a course.
    """
    caller_id = user.id if hasattr(user, "id") else user.get("id")
    if caller_id != user_id:
        shares = await run_in_threadpool(_caller_shares_course_with_student, caller_id, user_id)
        if not shares:
            raise HTTPException(status_code=403, detail="Access denied.")

    try:
        data = await compute_student_mastery(user_id)
    except Exception as e:
        logger.error("Failed to compute mastery for %s: %s", user_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to compute mastery.")
    return _Envelope(success=True, data=data)


# ── Concepts touched by a single lecture ────────────────────────────────────

@router.get("/lecture/{lecture_id}", response_model=_Envelope)
async def get_lecture_concepts(lecture_id: str, user: Any = Depends(verify_token)):
    """Return the canonical concepts tagged on a given lecture.

    Powers the in-lecture "Related across your courses" panel by giving the
    client the concept ids it needs to call ``/related-lectures`` for each.
    """
    caller_id = user.id if hasattr(user, "id") else user.get("id")
    # Verify access
    def _verify_access():
        l_res = supabase_admin.table("lectures").select("course_id, professor_id").eq("id", lecture_id).execute()
        if not l_res.data:
            raise HTTPException(status_code=404, detail="Lecture not found.")
        if l_res.data[0].get("professor_id") == caller_id:
            return
        c_id = l_res.data[0].get("course_id")
        accessible_courses = _get_accessible_course_ids(caller_id)
        if c_id not in accessible_courses:
            raise HTTPException(status_code=403, detail="Access denied.")
            
    await run_in_threadpool(_verify_access)

    try:
        data = await concepts_for_lecture(lecture_id)
    except Exception as e:
        logger.error("Failed to load concepts for lecture %s: %s", lecture_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load lecture concepts.")
    return _Envelope(success=True, data=data)


# ── Related lectures across courses ─────────────────────────────────────────

@router.get("/{concept_id}/related-lectures", response_model=_Envelope)
async def get_related_lectures(
    concept_id: str,
    exclude_lecture_id: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=50),
    user: Any = Depends(verify_token),  # auth-gated, no extra ownership check
):
    caller_id = user.id if hasattr(user, "id") else user.get("id")
    try:
        data = await related_lectures_for_concept(
            concept_id,
            exclude_lecture_id=exclude_lecture_id,
            limit=limit,
        )
        if data:
            lecture_ids = [r["lecture_id"] for r in data if r.get("lecture_id")]
            if lecture_ids:
                # Filter by accessible courses
                def _filter():
                    accessible = _get_accessible_course_ids(caller_id)
                    lec_res = supabase_admin.table("lectures").select("id, course_id, professor_id").in_("id", lecture_ids).execute()
                    lec_map = {r["id"]: r for r in (lec_res.data or [])}
                    return [r for r in data if (lec_map.get(r["lecture_id"], {}).get("professor_id") == caller_id) or (lec_map.get(r["lecture_id"], {}).get("course_id") in accessible)]
                data = await run_in_threadpool(_filter)
    except Exception as e:
        logger.error("Failed to load related lectures for %s: %s", concept_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load related lectures.")
    return _Envelope(success=True, data=data)


# ─── Helpers ────────────────────────────────────────────────────────────────

def _caller_shares_course_with_student(prof_id: str, student_id: str) -> bool:
    try:
        res = supabase_admin.table("assignment_enrollments").select("assignment_id").eq("user_id", student_id).execute()
        a_ids = [e["assignment_id"] for e in (res.data or []) if e.get("assignment_id")]
        if not a_ids: return False
        res2 = supabase_admin.table("assignments").select("course_id").in_("id", a_ids).execute()
        c_ids = [a["course_id"] for a in (res2.data or []) if a.get("course_id")]
        if not c_ids: return False
        res3 = supabase_admin.table("courses").select("id").eq("professor_id", prof_id).in_("id", c_ids).execute()
        return bool(res3.data)
    except Exception as e:
        logger.warning("Course overlap lookup failed for prof %s student %s: %s", prof_id, student_id, e)
        return False

def _get_accessible_course_ids(user_id: str) -> set[str]:
    try:
        res = supabase_admin.table("user_roles").select("role").eq("user_id", user_id).eq("role", "professor").execute()
        is_prof = bool(res.data)
        if is_prof:
            cres = supabase_admin.table("courses").select("id").eq("professor_id", user_id).execute()
            return {c["id"] for c in (cres.data or []) if c.get("id")}
        else:
            enroll = supabase_admin.table("assignment_enrollments").select("assignment_id").eq("user_id", user_id).execute()
            a_ids = [e["assignment_id"] for e in (enroll.data or []) if e.get("assignment_id")]
            if not a_ids: return set()
            al = supabase_admin.table("assignment_lectures").select("lecture_id").in_("assignment_id", a_ids).execute()
            l_ids = [r["lecture_id"] for r in (al.data or []) if r.get("lecture_id")]
            if not l_ids: return set()
            lectures = supabase_admin.table("lectures").select("course_id").in_("id", l_ids).execute()
            return {l["course_id"] for l in (lectures.data or []) if l.get("course_id")}
    except Exception:
        return set()
