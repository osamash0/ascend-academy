"""The v4 Lesson reader on real courses and lectures.

Mounted under ``/api/v1/v4/reader`` when ``FEATURE_V4_READER`` is on. Unlike
the rest of v4 it needs no v4 schema: a course is read as the reader's Space
and a lecture as its Lesson, straight from ``courses``/``lectures``/``slides``.
"""
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.core.auth_middleware import _user_id, verify_token
from backend.core.rate_limit import limiter
from backend.services import v4_reader_service as service
from backend.services.v4_personal import is_personal

router = APIRouter(prefix="/v4/reader", tags=["v4-reader"])


def _uid(user: Any) -> str:
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Sign in to read.")
    return uid


async def _lang(request: Request, uid: str) -> str:
    """The language the app is showing (`?lang=`), else the profile's.

    The app sends it with every request, so switching languages answers in
    the new one at once instead of after the profile write lands. Anything
    but a supported locale falls back to the profile.
    """
    asked = request.query_params.get("lang")
    if asked in service.LANGUAGE_NAMES:
        return asked
    return await service.preferred_language(uid)


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
    return await service.get_course(course_id, uid)


@router.get("/lectures/{lecture_id}")
@limiter.limit("60/minute")
async def reader_lecture(request: Request, lecture_id: UUID, user: Any = Depends(verify_token)):
    uid = await _lecture_access(lecture_id, user)
    return await service.get_lecture(lecture_id, await _lang(request, uid))


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
    return await service.explain_page(lecture_id, page, user_id=uid, locale=await _lang(request, uid))


class _Reading(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page: int = Field(ge=1, le=2000)
    #: Time spent on the page being left; under 2 s it is not counted as read.
    seconds: float = Field(ge=0, le=6 * 3600)


@router.post("/lectures/{lecture_id}/progress")
@limiter.limit("240/minute")
async def reader_progress(
    request: Request,
    lecture_id: UUID,
    body: _Reading,
    user: Any = Depends(verify_token),
):
    """The page the reader just left. Writes the rows the old reader writes —
    progress, visits, streak, a slide_view event — so v4 reading counts."""
    from backend.services.v4_reading_service import record_reading

    uid = await _lecture_access(lecture_id, user)
    return await record_reading(lecture_id, uid, body.page, body.seconds)


@router.get("/lectures/{lecture_id}/practice")
@limiter.limit("60/minute")
async def reader_practice(request: Request, lecture_id: UUID, user: Any = Depends(verify_token)):
    """The lecture's real quiz questions, as v4 PracticeQuestions."""
    from backend.services.v4_practice_service import questions_for

    await _lecture_access(lecture_id, user)
    return {"questions": await questions_for(lecture_id)}


class _Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question_id: UUID
    answer: str = Field(min_length=1, max_length=2000)


@router.post("/lectures/{lecture_id}/practice/answer")
@limiter.limit("120/minute")
async def reader_practice_answer(
    request: Request,
    lecture_id: UUID,
    body: _Answer,
    user: Any = Depends(verify_token),
):
    """Grade on the server, log a quiz_attempt, and grant XP once per question."""
    from backend.services.v4_practice_service import answer

    uid = await _lecture_access(lecture_id, user)
    return await answer(lecture_id, uid, body.question_id, body.answer)


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
        locale=await _lang(request, uid),
    )


@router.get("/courses/{course_id}/map")
@limiter.limit("30/minute")
async def reader_course_map(request: Request, course_id: UUID, user: Any = Depends(verify_token)):
    uid = _uid(user)
    if not await service.can_view_course(course_id, uid):
        raise HTTPException(status_code=404, detail="Course not found.")
    return await service.course_map(course_id, uid)


@router.get("/courses/{course_id}/find")
@limiter.limit("60/minute")
async def reader_course_find(
    request: Request,
    course_id: UUID,
    q: str = Query(min_length=2, max_length=120),
    exclude_lecture: UUID | None = Query(default=None),
    limit: int = Query(8, ge=1, le=12),
    strict: bool = Query(default=False),
    user: Any = Depends(verify_token),
):
    uid = _uid(user)
    if not await service.can_view_course(course_id, uid):
        raise HTTPException(status_code=404, detail="Course not found.")
    return {"results": await service.find_in_course(course_id, q, limit, exclude_lecture, strict)}


class RehearsalBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lecture_ids: list[UUID] = Field(min_length=1, max_length=12)
    count: int = Field(default=8, ge=3, le=12)
    weak_ideas: list[str] = Field(default_factory=list, max_length=12)


@router.post("/courses/{course_id}/rehearsal")
@limiter.limit("6/minute")
async def reader_rehearsal(request: Request, body: RehearsalBody, course_id: UUID, user: Any = Depends(verify_token)):
    from backend.services.v4_rehearsal_service import compose_rehearsal

    uid = _uid(user)
    if not await service.can_view_course(course_id, uid):
        raise HTTPException(status_code=404, detail="Course not found.")
    return await compose_rehearsal(
        course_id,
        body.lecture_ids,
        body.count,
        weak_ideas=[w[:60] for w in body.weak_ideas],
        user_id=uid,
        locale=await _lang(request, uid),
    )


class CheckpointBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    first: int = Field(ge=1, le=2000)
    last: int = Field(ge=1, le=2000)
    idea: str = Field(min_length=1, max_length=120)


@router.post("/lectures/{lecture_id}/checkpoint")
@limiter.limit("12/minute")
async def reader_checkpoint(request: Request, body: CheckpointBody, lecture_id: UUID, user: Any = Depends(verify_token)):
    from backend.services.v4_rehearsal_service import checkpoint

    uid = await _lecture_access(lecture_id, user)
    return await checkpoint(
        lecture_id,
        body.first,
        body.last,
        body.idea,
        user_id=uid,
        locale=await _lang(request, uid),
    )


class TeachBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    first: int = Field(ge=1, le=2000)
    last: int = Field(ge=1, le=2000)
    idea: str = Field(min_length=1, max_length=120)
    explanation: str = Field(min_length=1, max_length=2000)


@router.post("/lectures/{lecture_id}/teach-back")
@limiter.limit("10/minute")
async def reader_teach_back(request: Request, body: TeachBody, lecture_id: UUID, user: Any = Depends(verify_token)):
    from backend.services.v4_teachback_service import teach_back

    uid = await _lecture_access(lecture_id, user)
    return await teach_back(
        lecture_id,
        body.first,
        body.last,
        body.idea,
        body.explanation,
        user_id=uid,
        locale=await _lang(request, uid),
    )


@router.get("/courses/{course_id}/links")
@limiter.limit("10/minute")
async def reader_course_links(request: Request, course_id: UUID, user: Any = Depends(verify_token)):
    from backend.services.v4_links_service import course_links

    uid = _uid(user)
    if not await service.can_view_course(course_id, uid):
        raise HTTPException(status_code=404, detail="Course not found.")
    return await course_links(course_id, user_id=uid)


class _Result(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lecture_id: UUID
    page: int = Field(ge=1, le=2000)
    idea: str = Field(min_length=1, max_length=60)
    kind: str = Field(min_length=1, max_length=12)
    correct: bool


class AttemptBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(default="Exam rehearsal", max_length=120)
    lecture_ids: list[UUID] = Field(min_length=1, max_length=12)
    results: list[_Result] = Field(min_length=1, max_length=20)


@router.post("/courses/{course_id}/rehearsals", status_code=201)
@limiter.limit("20/minute")
async def reader_save_rehearsal(request: Request, body: AttemptBody, course_id: UUID, user: Any = Depends(verify_token)):
    from backend.services.v4_rehearsal_service import save_attempt

    uid = _uid(user)
    # Attempts are kept per course (v4_rehearsal_attempts.course_id → courses),
    # and the personal Space has no course row: its rehearsals are not kept yet.
    if is_personal(course_id, uid) or not await service.can_view_course(course_id, uid):
        raise HTTPException(status_code=404, detail="Course not found.")
    return await save_attempt(
        course_id, uid, body.title, body.lecture_ids, [r.model_dump(mode="json") for r in body.results]
    )


@router.get("/courses/{course_id}/rehearsals")
@limiter.limit("60/minute")
async def reader_rehearsal_history(request: Request, course_id: UUID, user: Any = Depends(verify_token)):
    from backend.services.v4_rehearsal_service import history

    uid = _uid(user)
    if not await service.can_view_course(course_id, uid):
        raise HTTPException(status_code=404, detail="Course not found.")
    return await history(course_id, uid)
