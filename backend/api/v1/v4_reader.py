"""The v4 Lesson reader on real courses and lectures.

Mounted under ``/api/v1/v4/reader`` when ``FEATURE_V4_READER`` is on. Unlike
the rest of v4 it needs no v4 schema: a course is read as the reader's Space
and a lecture as its Lesson, straight from ``courses``/``lectures``/``slides``.
"""
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.core.auth_middleware import _user_id, verify_token
from backend.core.rate_limit import limiter
from backend.services import v4_reader_service as service

router = APIRouter(prefix="/v4/reader", tags=["v4-reader"])


def _uid(user: Any) -> str:
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Sign in to read.")
    return uid


async def _lecture_access(lecture_id: UUID, user: Any) -> str:
    uid = _uid(user)
    if not await service.can_view_lecture(lecture_id, uid):
        raise HTTPException(status_code=404, detail="Lecture not found.")
    return uid


@router.get("/courses/{course_id}")
@limiter.limit("60/minute")
async def reader_course(request: Request, course_id: UUID, user: Any = Depends(verify_token)):
    uid = _uid(user)
    if not await service.can_view_course(course_id, uid):
        raise HTTPException(status_code=404, detail="Course not found.")
    return await service.get_course(course_id)


@router.get("/lectures/{lecture_id}")
@limiter.limit("60/minute")
async def reader_lecture(request: Request, lecture_id: UUID, user: Any = Depends(verify_token)):
    uid = await _lecture_access(lecture_id, user)
    return await service.get_lecture(lecture_id, await service.preferred_language(uid))


@router.get("/lectures/{lecture_id}/ideas")
@limiter.limit("20/minute")
async def reader_ideas(request: Request, lecture_id: UUID, user: Any = Depends(verify_token)):
    uid = await _lecture_access(lecture_id, user)
    return {"concepts": await service.get_ideas(lecture_id, uid)}


@router.post("/lectures/{lecture_id}/pages/{page}/explain")
@limiter.limit("30/minute")
async def reader_explain(
    request: Request,
    lecture_id: UUID,
    page: int = Path(ge=1, le=2000),
    user: Any = Depends(verify_token),
):
    uid = await _lecture_access(lecture_id, user)
    return await service.explain_page(lecture_id, page, user_id=uid, locale=await service.preferred_language(uid))


class _Turn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=400)
    title: str = Field(default="", max_length=160)


class AskBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=2, max_length=400)
    thread: list[_Turn] = Field(default_factory=list, max_length=8)


@router.post("/lectures/{lecture_id}/pages/{page}/ask")
@limiter.limit("15/minute")
async def reader_ask(
    request: Request,
    body: AskBody,
    lecture_id: UUID,
    page: int = Path(ge=1, le=2000),
    user: Any = Depends(verify_token),
):
    uid = await _lecture_access(lecture_id, user)
    return await service.ask_page(
        lecture_id,
        page,
        body.question,
        [t.model_dump() for t in body.thread],
        user_id=uid,
        locale=await service.preferred_language(uid),
    )
