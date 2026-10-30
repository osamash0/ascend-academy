"""The v4 Lesson reader on real courses and lectures.

Mounted under ``/api/v1/v4/reader`` when ``FEATURE_V4_READER`` is on. Unlike
the rest of v4 it needs no v4 schema: a course is read as the reader's Space
and a lecture as its Lesson, straight from ``courses``/``lectures``/``slides``.
"""
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from backend.core.auth_middleware import _user_id, verify_token
from backend.core.rate_limit import limiter
from backend.services import v4_reader_service as service
from backend.services import v4_telemetry as telemetry
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


class _Session(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(default="", max_length=64)
    #: False when Explain was only left open while the reader turned to this page: that is not asking for help here.
    #: Absent means opened, so an older client keeps counting what it counted.
    opened: bool = True


@router.post("/lectures/{lecture_id}/pages/{page}/explain")
@limiter.limit("30/minute")
async def reader_explain(
    request: Request,
    lecture_id: UUID,
    page: int = Path(ge=1, le=2000),
    body: Optional[_Session] = None,
    user: Any = Depends(verify_token),
):
    uid = await _lecture_access(lecture_id, user)
    # Opening Explain on this page is asking for help with it, cached answer or not. The answer is also fetched for
    # each page turned while Explain stays open; those the reader did not open are not help.
    if body is None or body.opened:
        await telemetry.record_help(
            lecture_id, uid, page, "explain", "", telemetry.session_or_new(body.session_id if body else "")
        )
    return await service.explain_page(lecture_id, page, user_id=uid, locale=await _lang(request, uid))


class _Reading(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page: int = Field(ge=1, le=2000)
    #: Time spent on the page being left, net of time it was covered or hidden; under 2 s it is not counted as read.
    seconds: float = Field(ge=0, le=6 * 3600)
    #: One per open reader (the browser's), so one sitting can be told from the next.
    session_id: str = Field(default="", max_length=64)
    #: The page now in view, when the reader moved; an earlier page is a way back.
    to_page: int | None = Field(default=None, ge=1, le=2000)


@router.post("/lectures/{lecture_id}/progress")
@limiter.limit("240/minute")
async def reader_progress(
    request: Request,
    lecture_id: UUID,
    body: _Reading,
    user: Any = Depends(verify_token),
):
    """The page the reader just left. Writes the rows the old reader writes —
    progress, visits, streak, a slide_view — plus the way back and the finish."""
    from backend.services.v4_reading_service import record_reading
    from backend.services.v4_telemetry import session_or_new

    uid = await _lecture_access(lecture_id, user)
    return await record_reading(
        lecture_id, uid, body.page, body.seconds, session_id=session_or_new(body.session_id), to_page=body.to_page
    )


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
    session_id: str = Field(default="", max_length=64)


@router.post("/lectures/{lecture_id}/practice/answer")
@limiter.limit("120/minute")
async def reader_practice_answer(
    request: Request,
    lecture_id: UUID,
    body: _Answer,
    user: Any = Depends(verify_token),
):
    """Grade on the server, log a first try or a retry, and grant XP once per question."""
    from backend.services.v4_practice_service import answer
    from backend.services.v4_telemetry import session_or_new

    uid = await _lecture_access(lecture_id, user)
    return await answer(lecture_id, uid, body.question_id, body.answer, session_id=session_or_new(body.session_id))


class _Turn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=400)
    title: str = Field(default="", max_length=160)


class AskBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=2, max_length=400)
    thread: list[_Turn] = Field(default_factory=list, max_length=8)
    session_id: str = Field(default="", max_length=64)


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
    await telemetry.record_help(lecture_id, uid, page, "ask", body.question, telemetry.session_or_new(body.session_id))
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
    session_id: str = Field(default="", max_length=64)


@router.post("/lectures/{lecture_id}/teach-back")
@limiter.limit("10/minute")
async def reader_teach_back(request: Request, body: TeachBody, lecture_id: UUID, user: Any = Depends(verify_token)):
    from backend.services.v4_teachback_service import teach_back

    uid = await _lecture_access(lecture_id, user)
    result = await teach_back(
        lecture_id,
        body.first,
        body.last,
        body.idea,
        body.explanation,
        user_id=uid,
        locale=await _lang(request, uid),
    )
    # The judge's verdict, not the browser's: solid counts as cleared.
    await telemetry.record_checkpoint(
        lecture_id, uid,
        page=int(result["first"]), idea=str(result["idea"]), kind="teach",
        correct=result.get("verdict") == "solid", session_id=telemetry.session_or_new(body.session_id),
    )
    return result


class CheckpointAnswerBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    #: The span as the checkpoint was served (its `first`/`last`), which names its cache entry.
    first: int = Field(ge=1, le=2000)
    last: int = Field(ge=1, le=2000)
    question_id: int = Field(ge=1, le=10)
    answer: dict[str, Any]
    session_id: str = Field(default="", max_length=64)


@router.post("/lectures/{lecture_id}/checkpoint/answer")
@limiter.limit("60/minute")
async def reader_checkpoint_answer(
    request: Request, body: CheckpointAnswerBody, lecture_id: UUID, user: Any = Depends(verify_token)
):
    """Grade one checkpoint answer here, against the checkpoint as served, and record it."""
    from backend.services.v4_rehearsal_service import cached_checkpoint, grade_answer

    uid = await _lecture_access(lecture_id, user)
    cp = await cached_checkpoint(lecture_id, body.first, body.last, await _lang(request, uid))
    q = next((q for q in (cp or {}).get("questions", []) if q.get("id") == body.question_id), None)
    if not cp or q is None:
        raise HTTPException(status_code=409, detail="That checkpoint is no longer open.")
    correct = grade_answer(q, body.answer)
    await telemetry.record_checkpoint(
        lecture_id, uid,
        page=int(q["page"]), idea=str(cp.get("idea") or q.get("idea") or ""), kind=str(q["kind"]),
        correct=correct, session_id=telemetry.session_or_new(body.session_id),
    )
    return {"correct": correct}


class CheckInBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    first: int = Field(ge=1, le=2000)
    last: int = Field(ge=1, le=2000)
    idea: str = Field(min_length=1, max_length=120)
    rating: Literal["got_it", "confused"]
    session_id: str = Field(default="", max_length=64)


@router.post("/lectures/{lecture_id}/check-in", status_code=204)
@limiter.limit("30/minute")
async def reader_check_in(request: Request, body: CheckInBody, lecture_id: UUID, user: Any = Depends(verify_token)):
    """The quiet check-in at an idea's checkpoint: clicked, or still foggy."""
    uid = await _lecture_access(lecture_id, user)
    await telemetry.record_check_in(
        lecture_id, uid, body.first, body.idea, body.rating, telemetry.session_or_new(body.session_id)
    )
    return Response(status_code=204)


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
