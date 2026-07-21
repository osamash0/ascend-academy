"""Course DTOs.

Concrete first slice of the P4-2 DTO-centralization effort
(docs/ROADMAP_10X_FOUNDATION.md §9, P4-2): pulls the response models for
`GET /api/courses` (`list_courses` in `backend/api/v1/courses.py`) out of the
router and into `schemas/`, wired via `response_model=` so FastAPI validates
and documents the real shape instead of returning a bare dict.

This intentionally covers only the `list_courses` response — see the P4-2
follow-up plan (reported alongside the pagination fix) for the rest of the
77 inline models still living in routers.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from backend.core.pagination import PaginatedResponse


class CourseOut(BaseModel):
    """Public shape of a course row, as returned by `_serialize()` in
    `backend/api/v1/courses.py`."""

    id: str
    professor_id: Optional[str] = Field(
        default=None,
        description="Null on the /browse (catalog) endpoint, which strips ownership.",
    )
    title: str
    description: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    is_archived: bool = False
    status: str = "published"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    lecture_count: int = 0


class CourseListResponse(PaginatedResponse[CourseOut]):
    """Response envelope for `GET /api/courses` and `GET /api/courses/browse`."""
