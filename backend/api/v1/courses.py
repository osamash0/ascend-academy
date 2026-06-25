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
    require_student,
    verify_token,
)
from backend.core.pagination import PaginationParams, PaginatedResponse
from backend.core.database import supabase_admin  # ADMIN: bulk relationship queries spanning multiple tables and roles
from backend.core.rate_limit import limiter

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


# ── Helpers ─────────────────────────────────────────────────────────────────

def _fetch_course(course_id: str) -> Optional[dict]:
    res = (
        supabase_admin.table("courses")
        .select("id, professor_id, title, description, color, icon, is_archived, created_at, updated_at")
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


from sqlmodel.ext.asyncio.session import AsyncSession
from backend.core.database import get_session
from backend.services import course_service

# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("")
@limiter.limit("60/minute")
async def list_courses(
    request: Request,
    user: Any = Depends(verify_token),
    only_archived: bool = Query(default=False),
    include_archived: bool = Query(default=False),
    params: PaginationParams = Depends(),
    session: AsyncSession = Depends(get_session)
):
    """List courses."""
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    is_prof = await run_in_threadpool(_is_professor, user)

    try:
        data, next_cursor, has_more = await course_service.list_courses(
            session=session,
            uid=uid,
            is_prof=is_prof,
            only_archived=only_archived,
            include_archived=include_archived,
            limit=params.limit,
            cursor=params.cursor
        )
        return PaginatedResponse(data=data, cursor=next_cursor, has_more=has_more)
    except Exception as e:
        logger.error("Courses list failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load courses.")


@router.get("/browse")
@limiter.limit("60/minute")
async def browse_courses(
    request: Request,
    user: Any = Depends(verify_token),
    params: PaginationParams = Depends(),
    session: AsyncSession = Depends(get_session)
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    try:
        data, next_cursor, has_more = await course_service.browse_courses(
            session=session,
            limit=params.limit,
            cursor=params.cursor
        )
        return PaginatedResponse(data=data, cursor=next_cursor, has_more=has_more)
    except Exception as e:
        logger.error("Courses browse failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to browse courses.")


@router.post("/{course_id}/enroll")
@limiter.limit("30/minute")
async def enroll_course(
    request: Request,
    course_id: str,
    user: Any = Depends(require_student),
    session: AsyncSession = Depends(get_session)
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    try:
        await course_service.enroll_course(session, uid, course_id)
        return {"success": True, "data": {"course_id": course_id, "enrolled": True}}
    except ValueError as e:
        if str(e) == "NotFound":
            raise HTTPException(status_code=404, detail="Course not found.")
        raise HTTPException(status_code=500, detail="Failed to enroll.")
    except Exception as e:
        logger.error("Course enrollment failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to enroll in course.")


@router.delete("/{course_id}/enroll", status_code=204)
@limiter.limit("30/minute")
async def unenroll_course(
    request: Request,
    course_id: str,
    user: Any = Depends(require_student),
    session: AsyncSession = Depends(get_session)
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    try:
        await course_service.unenroll_course(session, uid, course_id)
        return None
    except Exception as e:
        logger.error("Course unenrollment failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to unenroll from course.")


@router.get("/{course_id}")
@limiter.limit("120/minute")
async def get_course(
    request: Request, 
    course_id: str, 
    user: Any = Depends(verify_token),
    session: AsyncSession = Depends(get_session)
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    try:
        outcome, data = await course_service.get_course_details(session, course_id, uid)
        if outcome != "ok":
            raise HTTPException(status_code=404, detail="Course not found.")
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Course fetch failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch course.")


@router.post("", status_code=201)
@limiter.limit("30/minute")
async def create_course(
    request: Request,
    body: CourseCreate,
    user: Any = Depends(require_professor),
    session: AsyncSession = Depends(get_session)
):
    uid = _user_id(user)
    try:
        data = await course_service.create_course(
            session, uid, body.title.strip(), 
            (body.description or "").strip() or None, 
            body.color, body.icon
        )
        return {"success": True, "data": data}
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
    session: AsyncSession = Depends(get_session)
):
    uid = _user_id(user)
    try:
        patch = {}
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
            
        success, data = await course_service.update_course(session, course_id, uid, patch)
        if not success:
            raise HTTPException(status_code=404, detail="Course not found.")
        return {"success": True, "data": data}
    except ValueError as e:
        if str(e) == "Forbidden":
            raise HTTPException(status_code=403, detail="You do not own this course.")
        raise HTTPException(status_code=500, detail="Failed to update course.")
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
    session: AsyncSession = Depends(get_session)
):
    uid = _user_id(user)
    try:
        success = await course_service.delete_course(session, course_id, uid, reassign_to)
        if not success:
            raise HTTPException(status_code=404, detail="Course not found.")
        return None
    except ValueError as e:
        if str(e) == "Forbidden":
            raise HTTPException(status_code=403, detail="You do not own this course.")
        elif str(e) == "Target":
            raise HTTPException(status_code=400, detail="reassign_to course not found or not owned by you.")
        elif str(e) == "LecturesExist":
            raise HTTPException(status_code=409, detail="Course still has lectures. Pass ?reassign_to=<other_course_id> to move them, or unassign each lecture first.")
        raise HTTPException(status_code=500, detail="Failed to delete course.")
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
    session: AsyncSession = Depends(get_session)
):
    uid = _user_id(user)
    try:
        await course_service.assign_lecture(session, uid, course_id, lecture_id)
        return {"success": True, "data": {"course_id": course_id, "lecture_id": lecture_id}}
    except ValueError as e:
        if str(e) == "CourseNotFound":
            raise HTTPException(status_code=404, detail="Course not found.")
        elif str(e) == "LectureNotFound":
            raise HTTPException(status_code=404, detail="Lecture not found.")
        elif str(e) == "Forbidden":
            raise HTTPException(status_code=403, detail="You do not own this lecture.")
        raise HTTPException(status_code=500, detail="Failed to assign lecture.")
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
    session: AsyncSession = Depends(get_session)
):
    uid = _user_id(user)
    try:
        await course_service.unassign_lecture(session, uid, course_id, lecture_id)
        return None
    except ValueError as e:
        if str(e) == "CourseNotFound":
            raise HTTPException(status_code=404, detail="Course not found.")
        elif str(e) == "LectureNotFound":
            raise HTTPException(status_code=404, detail="Lecture not found.")
        elif str(e) == "NotAssigned":
            raise HTTPException(status_code=400, detail="Lecture is not assigned to this course.")
        raise HTTPException(status_code=500, detail="Failed to unassign lecture.")
    except Exception as e:
        logger.error("Lecture unassign failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to unassign lecture.")
