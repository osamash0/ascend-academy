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
"""
from __future__ import annotations

import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from backend.core.auth_middleware import (
    _user_id,
    require_professor,
    verify_token,
)
from backend.core.database import supabase_admin
from backend.core.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/courses", tags=["courses"])


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


# ── Helpers ─────────────────────────────────────────────────────────────────

def _fetch_course(course_id: str) -> Optional[dict]:
    res = (
        supabase_admin.table("courses")
        .select("id, professor_id, title, description, color, icon, created_at, updated_at")
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
    """Course ids whose lectures the student can see via assignment enrollment."""
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
        return set()
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
        return set()
    lectures = (
        supabase_admin.table("lectures")
        .select("id, course_id")
        .in_("id", lecture_ids)
        .execute()
        .data
        or []
    )
    return {l["course_id"] for l in lectures if l.get("course_id")}


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("")
@limiter.limit("60/minute")
async def list_courses(request: Request, user: Any = Depends(verify_token)):
    """List courses.

    Professor → their own courses (with lecture_count).
    Student   → courses tied to lectures they're enrolled in via assignments.
    """
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    is_prof = await run_in_threadpool(_is_professor, user)

    def _load() -> List[dict]:
        q = supabase_admin.table("courses").select(
            "id, professor_id, title, description, color, icon, created_at, updated_at"
        )
        if is_prof:
            q = q.eq("professor_id", uid)
        rows = q.order("created_at", desc=True).execute().data or []

        if not is_prof:
            visible = _student_visible_course_ids(uid)
            rows = [r for r in rows if r["id"] in visible]

        # Batch-load lecture counts.
        counts: dict[str, int] = {r["id"]: 0 for r in rows}
        if rows:
            ids = [r["id"] for r in rows]
            lecs = (
                supabase_admin.table("lectures")
                .select("id, course_id")
                .in_("course_id", ids)
                .execute()
                .data
                or []
            )
            for l in lecs:
                cid = l.get("course_id")
                if cid in counts:
                    counts[cid] = counts[cid] + 1
        return [_serialize(r, counts.get(r["id"], 0)) for r in rows]

    try:
        data = await run_in_threadpool(_load)
        return {"success": True, "data": data}
    except Exception as e:
        logger.error("Courses list failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load courses.")


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
            if course_id not in visible:
                return ("forbidden", None)
        all_lectures = (
            supabase_admin.table("lectures")
            .select("id, title, description, total_slides, created_at, pdf_url, course_id")
            .eq("course_id", course_id)
            .order("created_at", desc=True)
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
    user: Any = Depends(require_professor),
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
    user: Any = Depends(require_professor),
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

        if patch:
            supabase_admin.table("courses").update(patch).eq("id", course_id).execute()
        refreshed = _fetch_course(course_id) or existing
        # Get current lecture count
        lecs = (
            supabase_admin.table("lectures")
            .select("id")
            .eq("course_id", course_id)
            .execute()
            .data
            or []
        )
        return _serialize(refreshed, len(lecs))

    try:
        data = await run_in_threadpool(_update)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Course update failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update course.")


@router.delete("/{course_id}", status_code=204)
@limiter.limit("30/minute")
async def delete_course(
    request: Request,
    course_id: str,
    user: Any = Depends(require_professor),
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
    user: Any = Depends(require_professor),
):
    uid = _user_id(user)

    def _assign():
        course = _fetch_course(course_id)
        if not course or course["professor_id"] != uid:
            raise HTTPException(status_code=404, detail="Course not found.")
        lecture = _fetch_lecture(lecture_id)
        if not lecture:
            raise HTTPException(status_code=404, detail="Lecture not found.")
        if lecture["professor_id"] != uid:
            raise HTTPException(status_code=403, detail="You do not own this lecture.")
        supabase_admin.table("lectures").update({"course_id": course_id}).eq(
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
    user: Any = Depends(require_professor),
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
