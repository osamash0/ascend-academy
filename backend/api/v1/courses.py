"""Courses API.

Top-level professor-owned containers grouping lectures (slide decks).
A course is a lightweight folder; lectures still own the actual content.

Endpoints:
    GET    /api/courses                                    — list (role-aware)
    GET    /api/courses/{course_id}                        — single course (with lectures)
    POST   /api/courses                                    — professor create
    PATCH  /api/courses/{course_id}                        — professor update
    DELETE /api/courses/{course_id}[?reassign_to=UUID]     — professor delete
    POST   /api/courses/{course_id}/lectures/{lecture_id}  — assign lecture to course
    DELETE /api/courses/{course_id}/lectures/{lecture_id}  — unassign (back to Uncategorized)
    GET    /api/courses/{course_id}/context                — syllabus facts (Roadmap Phase 3)
    PATCH  /api/courses/{course_id}/context                — professor edits syllabus facts
    GET    /api/courses/{course_id}/concept-map             — merged cross-lecture concept graph
    GET    /api/courses/{course_id}/study-guide[?regenerate] — per-course study guide (Roadmap Phase 4.4)
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from backend.core.auth_middleware import (
    _user_id,
    require_creator,
    require_student,
    verify_token,
)
from backend.core.pagination import PaginationParams, PaginatedResponse
from backend.core.database import supabase_admin  # ADMIN: bulk relationship queries spanning multiple tables and roles
from backend.core.rate_limit import limiter
from backend.core.idempotency import check_idempotency

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/courses", tags=["courses"])


# ── Models ──────────────────────────────────────────────────────────────────

class CourseCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=4000)
    color: Optional[str] = Field(default=None, max_length=32)
    icon: Optional[str] = Field(default=None, max_length=64)


class CourseUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=4000)
    color: Optional[str] = Field(default=None, max_length=32)
    icon: Optional[str] = Field(default=None, max_length=64)
    is_archived: Optional[bool] = Field(default=None)
    status: Optional[str] = Field(default=None, pattern="^(draft|published)$")


class TitleSuggestionRequest(BaseModel):
    lectures: List[str]


# ── Helpers ─────────────────────────────────────────────────────────────────

def _fetch_course(course_id: str) -> Optional[dict]:
    res = (
        supabase_admin.table("courses")
        .select("id, professor_id, title, description, color, icon, is_archived, status, created_at, updated_at")
        .eq("id", course_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _fetch_lecture(lecture_id: str) -> Optional[dict]:
    res = (
        supabase_admin.table("lectures")
        .select("id, professor_id, course_id, title")
        .eq("id", lecture_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _serialize(course: dict, lecture_count: int = 0) -> dict:
    return {
        "id": course["id"],
        "professor_id": course["professor_id"],
        "title": course["title"],
        "description": course.get("description"),
        "color": course.get("color"),
        "icon": course.get("icon"),
        "is_archived": course.get("is_archived", False),
        "status": course.get("status", "published"),
        "created_at": course.get("created_at"),
        "updated_at": course.get("updated_at"),
        "lecture_count": lecture_count,
    }


def _is_professor(user: Any) -> bool:
    meta = getattr(user, "app_metadata", None)
    if meta is None and isinstance(user, dict):
        meta = user.get("app_metadata") or {}
    if isinstance(meta, dict) and meta.get("role") == "professor":
        return True
    uid = _user_id(user)
    if not uid:
        return False
    try:
        res = supabase_admin.table("user_roles").select("role").eq("user_id", uid).execute()
        return any(r.get("role") == "professor" for r in (res.data or []))
    except Exception:
        return False


def _student_visible_course_ids(user_id: str) -> set[str]:
    """Course ids whose lectures the student can see via course enrollment or assignment enrollment."""
    # 1. Direct course enrollments
    ce = (
        supabase_admin.table("course_enrollments")
        .select("course_id")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    course_ids = {r["course_id"] for r in ce if r.get("course_id")}

    # 2. Assignment enrollments
    enroll = (
        supabase_admin.table("assignment_enrollments")
        .select("assignment_id")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    a_ids = [e["assignment_id"] for e in enroll if e.get("assignment_id")]
    if not a_ids:
        return course_ids

    al = (
        supabase_admin.table("assignment_lectures")
        .select("lecture_id")
        .in_("assignment_id", a_ids)
        .execute()
        .data
        or []
    )
    lecture_ids = [r["lecture_id"] for r in al if r.get("lecture_id")]
    if not lecture_ids:
        return course_ids

    lectures = (
        supabase_admin.table("lectures")
        .select("id, course_id")
        .in_("id", lecture_ids)
        .execute()
        .data
        or []
    )
    course_ids.update({l["course_id"] for l in lectures if l.get("course_id")})
    return course_ids



# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("")
@limiter.limit("60/minute")
async def list_courses(
    request: Request,
    user: Any = Depends(verify_token),
    only_archived: bool = Query(default=False),
    include_archived: bool = Query(default=False),
    params: PaginationParams = Depends(),
):
    """List courses.

    Own courses (rows with professor_id == uid, regardless of role) plus,
    for non-owned rows, any course visible via course/assignment enrollment.
    A creator who is also enrolled elsewhere as a student sees both.
    """
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _load() -> List[dict]:
        q = supabase_admin.table("courses").select(
            "id, professor_id, title, description, color, icon, is_archived, status, created_at, updated_at"
        )

        if only_archived:
            q = q.eq("is_archived", True)
        elif not include_archived:
            q = q.eq("is_archived", False)

        if params.cursor:
            q = q.lt("created_at", params.cursor)

        rows = q.order("created_at", desc=True).limit(params.limit + 1).execute().data or []
        has_more = len(rows) > params.limit
        if has_more:
            rows = rows[:-1]

        visible = _student_visible_course_ids(uid)
        rows = [r for r in rows if r["professor_id"] == uid or r["id"] in visible]

        # Batch-load lecture counts.
        counts: dict[str, int] = {r["id"]: 0 for r in rows}
        if rows:
            ids = [r["id"] for r in rows]
            lecs = (
                supabase_admin.table("lectures")
                .select("id, course_id, is_archived")
                .in_("course_id", ids)
                .execute()
                .data
                or []
            )
            for l in lecs:
                cid = l.get("course_id")
                if cid in counts:
                    if only_archived or l.get("is_archived") is False:
                        counts[cid] = counts[cid] + 1
        next_cursor = rows[-1]["created_at"] if rows else None
        return PaginatedResponse(data=[_serialize(r, counts.get(r["id"], 0)) for r in rows], cursor=next_cursor, has_more=has_more)

    try:
        data = await run_in_threadpool(_load)
        return data
    except Exception as e:
        logger.error("Courses list failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load courses.")


@router.get("/browse")
@limiter.limit("60/minute")
async def browse_courses(
    request: Request,
    user: Any = Depends(verify_token),
    params: PaginationParams = Depends(),
):
    """Browse all available (non-archived) courses. Useful for onboarding and discovery."""
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _load() -> List[dict]:
        # Only show courses created by professors in the global catalog
        professors = supabase_admin.table("user_roles").select("user_id").eq("role", "professor").execute().data or []
        prof_ids = [p["user_id"] for p in professors] if professors else []

        q = (
            supabase_admin.table("courses")
            .select("id, professor_id, title, description, color, icon, is_archived, status, created_at, updated_at")
            .eq("is_archived", False)
            .eq("status", "published")
        )
        if prof_ids:
            q = q.in_("professor_id", prof_ids)
        else:
            # If no professors exist, return empty to be safe
            q = q.eq("id", "00000000-0000-0000-0000-000000000000")

        if params.cursor:
            q = q.lt("created_at", params.cursor)
            
        rows = q.order("created_at", desc=True).limit(params.limit + 1).execute().data or []
        has_more = len(rows) > params.limit
        if has_more:
            rows = rows[:-1]
        # Batch-load lecture counts
        counts: dict[str, int] = {r["id"]: 0 for r in rows}
        if rows:
            ids = [r["id"] for r in rows]
            lecs = (
                supabase_admin.table("lectures")
                .select("id, course_id, is_archived")
                .in_("course_id", ids)
                .execute()
                .data
                or []
            )
            for l in lecs:
                cid = l.get("course_id")
                if cid in counts and l.get("is_archived") is False:
                    counts[cid] = counts[cid] + 1

        next_cursor = rows[-1]["created_at"] if rows else None
        return PaginatedResponse(data=[{**_serialize(r, counts.get(r["id"], 0)), "professor_id": None} for r in rows], cursor=next_cursor, has_more=has_more)

    try:
        data = await run_in_threadpool(_load)
        return data
    except Exception as e:
        logger.error("Courses browse failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to browse courses.")


@router.post("/generate-title-suggestion")
async def generate_title_suggestion(req: TitleSuggestionRequest, _user_id: UUID = Depends(_user_id)):
    from openai import AsyncOpenAI
    from backend.core.config import settings

    if not req.lectures:
        return {"title": "My New Course"}

    # Use a small temperature to get a bit of variation on retry
    prompt = f"Suggest a short, catchy, professional course title (max 6 words) for a course that covers these lectures: {', '.join(req.lectures)}. Output ONLY the title, no quotes or prefix."

    try:
        client = AsyncOpenAI(api_key=settings.litellm_client_key, base_url=settings.litellm_base_url)
        resp = await client.chat.completions.create(
            # Using stage-text or default model mapped in litellm
            model="gpt-4o-mini", 
            messages=[{"role": "user", "content": prompt}],
            max_tokens=20,
            temperature=0.8
        )
        title = resp.choices[0].message.content.strip().strip('"').strip("'")
        return {"title": title}
    except Exception as e:
        logger.error(f"Failed to generate title suggestion: {e}")
        return {"title": "My AI Generated Course"}


@router.post("/{course_id}/enroll")
@limiter.limit("30/minute")
async def enroll_course(
    request: Request,
    course_id: str,
    user: Any = Depends(require_student),
):
    """Enroll a student into a course explicitly."""
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _enroll():
        course = _fetch_course(course_id)
        if not course:
            raise HTTPException(status_code=404, detail="Course not found.")
        if course.get("status") != "published" and course["professor_id"] != uid:
            raise HTTPException(status_code=404, detail="Course not found.")

        # Upsert enrollment
        supabase_admin.table("course_enrollments").upsert(
            {"user_id": uid, "course_id": course_id},
            on_conflict="user_id,course_id"
        ).execute()
        return {"course_id": course_id, "enrolled": True}

    try:
        data = await run_in_threadpool(_enroll)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Course enrollment failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to enroll in course.")


@router.delete("/{course_id}/enroll", status_code=204)
@limiter.limit("30/minute")
async def unenroll_course(
    request: Request,
    course_id: str,
    user: Any = Depends(require_student),
):
    """Unenroll a student from a course."""
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _unenroll():
        supabase_admin.table("course_enrollments").delete().eq("user_id", uid).eq("course_id", course_id).execute()

    try:
        await run_in_threadpool(_unenroll)
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Course unenrollment failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to unenroll from course.")


@router.get("/{course_id}")
@limiter.limit("120/minute")
async def get_course(request: Request, course_id: str, user: Any = Depends(verify_token)):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _load():
        c = _fetch_course(course_id)
        if not c:
            return ("missing", None)
        is_owner = c["professor_id"] == uid
        if not is_owner:
            visible = _student_visible_course_ids(uid)
            if c.get("status") != "published" or course_id not in visible:
                return ("forbidden", None)

        lec_query = (
            supabase_admin.table("lectures")
            .select("id, title, description, total_slides, created_at, pdf_url, course_id, is_archived")
            .eq("course_id", course_id)
        )
        if not c.get("is_archived"):
            lec_query = lec_query.eq("is_archived", False)

        all_lectures = (
            lec_query.order("created_at", desc=True)
            .execute()
            .data
            or []
        )
        if is_owner:
            lectures = all_lectures
        else:
            # Students may only see lectures inside this course that they are
            # actually enrolled in via an assignment — never the full course
            # roster, even if they are enrolled in *some* lecture of it.
            enroll = (
                supabase_admin.table("assignment_enrollments")
                .select("assignment_id")
                .eq("user_id", uid)
                .execute()
                .data
                or []
            )
            a_ids = [e["assignment_id"] for e in enroll if e.get("assignment_id")]
            allowed_lecture_ids: set[str] = set()
            if a_ids:
                al = (
                    supabase_admin.table("assignment_lectures")
                    .select("lecture_id")
                    .in_("assignment_id", a_ids)
                    .execute()
                    .data
                    or []
                )
                allowed_lecture_ids = {r["lecture_id"] for r in al if r.get("lecture_id")}
            lectures = [l for l in all_lectures if l["id"] in allowed_lecture_ids]

        payload = _serialize(c, len(all_lectures) if is_owner else len(lectures))
        payload["lectures"] = lectures
        return ("ok", payload)

    outcome, data = await run_in_threadpool(_load)
    if outcome != "ok":
        raise HTTPException(status_code=404, detail="Course not found.")
    return {"success": True, "data": data}


@router.post("", status_code=201)
@limiter.limit("30/minute")
async def create_course(
    request: Request,
    body: CourseCreate,
    user: Any = Depends(require_creator),
    idempotency: Optional[str] = Depends(check_idempotency),
):
    uid = _user_id(user)

    def _create():
        ins = (
            supabase_admin.table("courses")
            .insert(
                {
                    "professor_id": uid,
                    "title": body.title.strip(),
                    "description": (body.description or "").strip() or None,
                    "color": body.color,
                    "icon": body.icon,
                }
            )
            .execute()
        )
        if not ins.data:
            raise HTTPException(status_code=500, detail="Failed to create course.")
        return _serialize(ins.data[0], 0)

    try:
        data = await run_in_threadpool(_create)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Course create failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create course.")


@router.patch("/{course_id}")
@limiter.limit("30/minute")
async def update_course(
    request: Request,
    course_id: str,
    body: CourseUpdate,
    user: Any = Depends(require_creator),
):
    uid = _user_id(user)

    def _update():
        existing = _fetch_course(course_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Course not found.")
        if existing["professor_id"] != uid:
            raise HTTPException(status_code=403, detail="You do not own this course.")

        patch: dict[str, Any] = {}
        if body.title is not None:
            patch["title"] = body.title.strip()
        if "description" in body.model_fields_set:
            patch["description"] = (body.description or "").strip() or None
        if "color" in body.model_fields_set:
            patch["color"] = body.color
        if "icon" in body.model_fields_set:
            patch["icon"] = body.icon
        if body.is_archived is not None:
            patch["is_archived"] = body.is_archived
        if body.status is not None and body.status != existing.get("status"):
            if body.status == "published":
                ready = (
                    supabase_admin.table("lectures")
                    .select("id, total_slides")
                    .eq("course_id", course_id)
                    .eq("is_archived", False)
                    .gt("total_slides", 0)
                    .limit(1)
                    .execute()
                    .data
                    or []
                )
                if not ready:
                    raise HTTPException(
                        status_code=400,
                        detail="Add at least one fully-parsed lecture before publishing.",
                    )
            patch["status"] = body.status

        if patch:
            supabase_admin.table("courses").update(patch).eq("id", course_id).execute()
        refreshed = _fetch_course(course_id) or existing
        # Get current lecture count
        lec_query = (
            supabase_admin.table("lectures")
            .select("id, is_archived")
            .eq("course_id", course_id)
        )
        if not refreshed.get("is_archived"):
            lec_query = lec_query.eq("is_archived", False)
        lecs = lec_query.execute().data or []
        return _serialize(refreshed, len(lecs))

    try:
        data = await run_in_threadpool(_update)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Course update failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update course.")


# ── Course context (Roadmap Phase 3, "course brain") ─────────────────────────
# Structured syllabus facts (instructor, exam dates, grading scheme) extracted
# from administrative slides during parsing (behind FEATURE_COURSE_BRAIN) or
# entered directly by the professor. A missing row just means "no facts yet".

class CourseContextUpdate(BaseModel):
    instructor: Optional[str] = Field(default=None, max_length=200)
    exam_dates: Optional[List[Dict[str, Any]]] = Field(default=None)
    syllabus_facts: Optional[Dict[str, Any]] = Field(default=None)
    grading_scheme: Optional[str] = Field(default=None, max_length=2000)


@router.get("/{course_id}/context")
@limiter.limit("60/minute")
async def get_course_context_endpoint(
    request: Request,
    course_id: str,
    user: Any = Depends(verify_token),
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _check_visibility() -> None:
        c = _fetch_course(course_id)
        if not c:
            raise HTTPException(status_code=404, detail="Course not found.")
        is_owner = c["professor_id"] == uid
        if not is_owner and (
            c.get("status") != "published" or course_id not in _student_visible_course_ids(uid)
        ):
            raise HTTPException(status_code=403, detail="You do not have access to this course.")

    await run_in_threadpool(_check_visibility)

    from backend.services.course_context_service import get_course_context
    ctx = await get_course_context(UUID(course_id))
    return {"success": True, "data": ctx}


@router.patch("/{course_id}/context")
@limiter.limit("30/minute")
async def update_course_context_endpoint(
    request: Request,
    course_id: str,
    body: CourseContextUpdate,
    user: Any = Depends(require_creator),
):
    uid = _user_id(user)

    def _check_owner() -> None:
        c = _fetch_course(course_id)
        if not c:
            raise HTTPException(status_code=404, detail="Course not found.")
        if c["professor_id"] != uid:
            raise HTTPException(status_code=403, detail="You do not own this course.")

    await run_in_threadpool(_check_owner)

    patch: Dict[str, Any] = {}
    for field in ("instructor", "exam_dates", "syllabus_facts", "grading_scheme"):
        if field in body.model_fields_set:
            patch[field] = getattr(body, field)

    from backend.services.course_context_service import replace_course_context_fields
    try:
        result = await replace_course_context_fields(UUID(course_id), patch)
    except Exception as e:
        logger.error("Course context update failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update course context.")
    return {"success": True, "data": result}


# ── Concept map (Roadmap Phase 3.2) ──────────────────────────────────────────
# Cross-lecture concept DEDUP already exists (backend/services/concept_graph.py)
# — this merges concept_lectures into a per-course view, deriving "builds on"
# ordering from lectures.created_at rather than a new schema column: a
# concept's first appearance (earliest lecture) "introduces" it, later
# appearances "reinforce/build on" it.

@router.get("/{course_id}/concept-map")
@limiter.limit("30/minute")
async def get_concept_map_endpoint(
    request: Request,
    course_id: str,
    user: Any = Depends(verify_token),
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _load() -> List[Dict[str, Any]]:
        c = _fetch_course(course_id)
        if not c:
            raise HTTPException(status_code=404, detail="Course not found.")
        is_owner = c["professor_id"] == uid
        if not is_owner and (
            c.get("status") != "published" or course_id not in _student_visible_course_ids(uid)
        ):
            raise HTTPException(status_code=403, detail="You do not have access to this course.")

        lec_query = (
            supabase_admin.table("lectures")
            .select("id, title, created_at")
            .eq("course_id", course_id)
        )
        if not c.get("is_archived"):
            lec_query = lec_query.eq("is_archived", False)
        lectures = lec_query.execute().data or []
        if not lectures:
            return []
        lecture_by_id = {l["id"]: l for l in lectures}

        cl_rows = (
            supabase_admin.table("concept_lectures")
            .select("concept_id, lecture_id, slide_indices, weight")
            .in_("lecture_id", list(lecture_by_id.keys()))
            .execute()
            .data
            or []
        )
        if not cl_rows:
            return []
        concept_ids = list({r["concept_id"] for r in cl_rows if r.get("concept_id")})
        concepts = (
            supabase_admin.table("concepts")
            .select("id, canonical_name")
            .in_("id", concept_ids)
            .execute()
            .data
            or []
        )
        concept_by_id = {cn["id"]: cn for cn in concepts}

        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for r in cl_rows:
            lec = lecture_by_id.get(r.get("lecture_id"))
            concept_id = r.get("concept_id")
            if not lec or not concept_id or concept_id not in concept_by_id:
                continue
            grouped.setdefault(concept_id, []).append({
                "lecture_id": r["lecture_id"],
                "lecture_title": lec["title"],
                "created_at": lec["created_at"],
                "slide_indices": r.get("slide_indices") or [],
                "weight": r.get("weight"),
            })

        result: List[Dict[str, Any]] = []
        for concept_id, appearances in grouped.items():
            appearances.sort(key=lambda a: a["created_at"] or "")
            result.append({
                "id": concept_id,
                "canonical_name": concept_by_id[concept_id]["canonical_name"],
                "first_lecture": {
                    "id": appearances[0]["lecture_id"],
                    "title": appearances[0]["lecture_title"],
                    "created_at": appearances[0]["created_at"],
                },
                "appearances": appearances,
            })
        result.sort(key=lambda c: c["first_lecture"]["created_at"] or "")
        return result

    try:
        data = await run_in_threadpool(_load)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Concept map fetch failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load concept map.")
    return {"success": True, "data": data}


# ── Study guide (Roadmap Phase 4.4) ──────────────────────────────────────────
# Off by default — gates only this endpoint (FEATURE_STUDY_GUIDE), not a whole
# router, since it lives on the always-mounted courses router.

@router.get("/{course_id}/study-guide")
@limiter.limit("20/minute")
async def get_study_guide_endpoint(
    request: Request,
    course_id: str,
    regenerate: bool = Query(default=False),
    user: Any = Depends(verify_token),
):
    from backend.core.config import settings
    if not settings.feature_study_guide:
        raise HTTPException(status_code=404, detail="Not found.")

    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _check_visibility() -> None:
        c = _fetch_course(course_id)
        if not c:
            raise HTTPException(status_code=404, detail="Course not found.")
        is_owner = c["professor_id"] == uid
        if not is_owner and (
            c.get("status") != "published" or course_id not in _student_visible_course_ids(uid)
        ):
            raise HTTPException(status_code=403, detail="You do not have access to this course.")

    await run_in_threadpool(_check_visibility)

    from backend.services.study_guide_service import get_or_generate_study_guide
    try:
        content = await get_or_generate_study_guide(UUID(course_id), force_regenerate=regenerate)
    except Exception as e:
        logger.error("Study guide generation failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate study guide.")
    return {"success": True, "data": content}


@router.delete("/{course_id}", status_code=204)
@limiter.limit("30/minute")
async def delete_course(
    request: Request,
    course_id: str,
    user: Any = Depends(require_creator),
    reassign_to: Optional[str] = Query(default=None),
):
    """Delete a course.

    If the course still has lectures, the request is rejected (409) unless
    `reassign_to=<other_course_id>` is provided — in which case the
    lectures are reassigned to that course before deletion. A `null` /
    sentinel value is intentionally not supported here; the migration's
    ON DELETE SET NULL will handle the "Uncategorized" case for an empty
    course delete only.
    """
    uid = _user_id(user)

    def _delete():
        existing = _fetch_course(course_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Course not found.")
        if existing["professor_id"] != uid:
            raise HTTPException(status_code=403, detail="You do not own this course.")

        lecs = (
            supabase_admin.table("lectures")
            .select("id")
            .eq("course_id", course_id)
            .execute()
            .data
            or []
        )
        if lecs:
            if reassign_to:
                target = _fetch_course(reassign_to)
                if not target or target["professor_id"] != uid:
                    raise HTTPException(
                        status_code=400,
                        detail="reassign_to course not found or not owned by you.",
                    )
                supabase_admin.table("lectures").update(
                    {"course_id": reassign_to}
                ).eq("course_id", course_id).execute()
            else:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Course still has lectures. Pass ?reassign_to=<other_course_id> "
                        "to move them, or unassign each lecture first."
                    ),
                )
        supabase_admin.table("courses").delete().eq("id", course_id).execute()

    try:
        await run_in_threadpool(_delete)
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Course delete failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete course.")


@router.post("/{course_id}/lectures/{lecture_id}")
@limiter.limit("60/minute")
async def assign_lecture(
    request: Request,
    course_id: str,
    lecture_id: str,
    user: Any = Depends(require_creator),
):
    uid = _user_id(user)

    def _assign():
        course = _fetch_course(course_id)
        if not course or course["professor_id"] != uid:
            raise HTTPException(status_code=404, detail="Course not found.")
        lecture = _fetch_lecture(lecture_id)
        if not lecture:
            raise HTTPException(status_code=404, detail="Lecture not found.")
        owner_id = lecture.get("professor_id") or lecture.get("student_owner_id")
        if owner_id != uid:
            raise HTTPException(status_code=403, detail="You do not own this lecture.")
        
        update_data = {"course_id": course_id}
        if lecture.get("visibility") == "private_student":
            update_data.update({
                "visibility": "course",
                "professor_id": uid,
                "student_owner_id": None,
            })
            
        supabase_admin.table("lectures").update(update_data).eq(
            "id", lecture_id
        ).execute()
        return {"course_id": course_id, "lecture_id": lecture_id}

    try:
        data = await run_in_threadpool(_assign)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Lecture assign failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to assign lecture.")


@router.delete("/{course_id}/lectures/{lecture_id}", status_code=204)
@limiter.limit("60/minute")
async def unassign_lecture(
    request: Request,
    course_id: str,
    lecture_id: str,
    user: Any = Depends(require_creator),
):
    uid = _user_id(user)

    def _unassign():
        course = _fetch_course(course_id)
        if not course or course["professor_id"] != uid:
            raise HTTPException(status_code=404, detail="Course not found.")
        lecture = _fetch_lecture(lecture_id)
        if not lecture or lecture["professor_id"] != uid:
            raise HTTPException(status_code=404, detail="Lecture not found.")
        if lecture.get("course_id") != course_id:
            raise HTTPException(
                status_code=400,
                detail="Lecture is not assigned to this course.",
            )
        supabase_admin.table("lectures").update({"course_id": None}).eq(
            "id", lecture_id
        ).execute()

    try:
        await run_in_threadpool(_unassign)
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Lecture unassign failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to unassign lecture.")
