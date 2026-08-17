"""Authenticated preferred-language study-content reads."""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.core.auth_middleware import _user_id, verify_token
from backend.core.database import get_db_connection
from backend.core.rate_limit import limiter
from backend.services.localization_service import (
    SUPPORTED_LOCALES,
    get_localized_lecture,
    get_localized_course,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/localized-content", tags=["localized-content"])


async def _preferred_language(user_id: str) -> str:
    async with await get_db_connection() as conn:
        value = await conn.fetchval(
            "SELECT preferred_language FROM profiles WHERE user_id = $1", UUID(user_id),
        )
    return value if value in SUPPORTED_LOCALES else "en"


async def _can_view_lecture(lecture_id: UUID, user_id: str) -> bool:
    """Authorization mirrors lecture visibility without relying on client RLS.

    The endpoint uses the server connection to compose localized data, so this
    explicit check is required before reading any source or translation row.
    """
    async with await get_db_connection() as conn:
        allowed = await conn.fetchval(
            """
            SELECT EXISTS (
              SELECT 1 FROM lectures l
              WHERE l.id = $1 AND (
                l.professor_id = $2::uuid
                OR l.student_owner_id = $2::uuid
                OR EXISTS (
                  SELECT 1 FROM course_enrollments ce
                  WHERE ce.course_id = l.course_id AND ce.user_id = $2::uuid
                )
                OR EXISTS (
                  SELECT 1
                  FROM assignment_lectures al
                  JOIN assignment_enrollments ae ON ae.assignment_id = al.assignment_id
                  WHERE al.lecture_id = l.id AND ae.user_id = $2::uuid
                )
              )
            )
            """,
            lecture_id, user_id,
        )
    return bool(allowed)


async def _lecture_metadata(lecture_id: UUID) -> dict[str, Any]:
    async with await get_db_connection() as conn:
        row = await conn.fetchrow(
            """
            SELECT l.id, l.title, l.description, l.total_slides, l.created_at, l.pdf_url,
                   l.poster_url,
                   l.course_id, l.is_archived, l.source_language, l.content_revision,
                   c.id AS course_id_joined, c.title AS course_title, c.color AS course_color
            FROM lectures l LEFT JOIN courses c ON c.id = l.course_id
            WHERE l.id = $1
            """,
            lecture_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Lecture not found.")
    return dict(row)


@router.get("/lectures/{lecture_id}")
@limiter.limit("60/minute")
async def localized_lecture_endpoint(
    request: Request,
    lecture_id: str,
    user: Any = Depends(verify_token),
):
    try:
        lecture_uuid = UUID(lecture_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid lecture id.")
    user_id = _user_id(user)
    if not user_id or not await _can_view_lecture(lecture_uuid, user_id):
        raise HTTPException(status_code=404, detail="Lecture not found.")

    locale = await _preferred_language(user_id)
    content = await get_localized_lecture(lecture_uuid, locale)
    if content is None:
        # No source fallback: a caller can retry after the processing job has
        # finished, but never sees an accidental mixed-language lecture.
        raise HTTPException(
            status_code=409,
            detail="The preferred-language version is still being prepared.",
        )
    metadata = await _lecture_metadata(lecture_uuid)
    course_localization = (
        await get_localized_course(metadata["course_id_joined"], locale)
        if metadata["course_id_joined"] else None
    )
    localized_lecture = content.get("lecture") or {}
    slides = content.get("slides") or []
    questions = [question for slide in slides for question in slide.get("questions", [])]
    lecture = {
        "id": str(metadata["id"]),
        "title": localized_lecture.get("title") or metadata["title"],
        "description": localized_lecture.get("description") or metadata["description"],
        "total_slides": metadata["total_slides"],
        "created_at": metadata["created_at"].isoformat(),
        "pdf_url": metadata["pdf_url"],
        "poster_url": metadata["poster_url"],
        "course_id": str(metadata["course_id"]) if metadata["course_id"] else None,
        "is_archived": metadata["is_archived"],
        "source_language": metadata["source_language"],
        "content_revision": metadata["content_revision"],
        "course": (
            {"id": str(metadata["course_id_joined"]), "title": (course_localization or {}).get("title") or metadata["course_title"], "color": metadata["course_color"]}
            if metadata["course_id_joined"] else None
        ),
    }
    return {"locale": locale, "lecture": lecture, "slides": slides, "questions": questions}


@router.post("/lectures/{lecture_id}/retry")
@limiter.limit("10/minute")
async def retry_localization_endpoint(
    request: Request,
    lecture_id: str,
    user: Any = Depends(verify_token),
):
    try:
        lecture_uuid = UUID(lecture_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid lecture id.")
    user_id = _user_id(user)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user context.")
    async with await get_db_connection() as conn:
        row = await conn.fetchrow(
            "SELECT professor_id, student_owner_id FROM lectures WHERE id = $1", lecture_uuid,
        )
    if not row or str(row["professor_id"] or row["student_owner_id"]) != user_id:
        raise HTTPException(status_code=404, detail="Lecture not found.")
    from backend.core.config import settings
    from backend.services.localization_service import localize_lecture
    try:
        await localize_lecture(lecture_uuid, settings.parser_llm_model or "cerebras")
    except Exception as exc:
        logger.warning("Localization retry failed for %s: %s", lecture_id, exc)
        raise HTTPException(status_code=502, detail="Could not rebuild localized content.")
    return {"lecture_id": lecture_id, "status": "ready"}
