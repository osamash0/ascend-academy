# backend/api/v1/v4_luna.py
"""Luna study sessions in the v4 reader.

Mounted under ``/api/v1/v4/luna`` when ``FEATURE_LUNA_SESSIONS`` is on. A
turn answers as Server-Sent Events (move → say → blocks → plan → end); every
refusal — not yours, already answering, ended — is an HTTP error *before*
the stream starts, so the browser never has to parse a half-open stream.
"""
from __future__ import annotations

import json
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator

from backend.core.auth_middleware import _user_id, verify_token
from backend.core.rate_limit import limiter
from backend.services import v4_reader_service as reader
from backend.services.luna import session_service as service
from backend.services.luna.store import PgStore

router = APIRouter(prefix="/v4/luna", tags=["v4-luna"])


def _store() -> PgStore:
    return PgStore()


def _uid(user: Any) -> str:
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Sign in to study with Luna.")
    return uid


async def _lang(request: Request, uid: str) -> str:
    asked = request.query_params.get("lang")
    if asked in reader.LANGUAGE_NAMES:
        return asked
    return await reader.preferred_language(uid)


def _http(e: service.LunaError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=e.detail)


def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


class StartBody(BaseModel):
    space_id: str = Field(min_length=1, max_length=64)
    lecture_id: UUID
    page: int = Field(ge=1, le=5000)
    opener: str = Field(default="", max_length=2000)


class PlanEdit(BaseModel):
    id: str = Field(min_length=1, max_length=8)
    title: Optional[str] = Field(default=None, max_length=60)


class CheckResult(BaseModel):
    question: str = Field(max_length=300)
    correct: bool


class TurnBody(BaseModel):
    client_turn_id: UUID
    text: Optional[str] = Field(default=None, max_length=2000)
    action: Optional[Literal["accept_plan", "skip_step", "edit_plan", "continue", "end"]] = None
    plan: Optional[list[PlanEdit]] = Field(default=None, max_length=5)
    reading_at: Optional[int] = Field(default=None, ge=1, le=5000)
    check_result: Optional[CheckResult] = None

    @model_validator(mode="after")
    def _something(self) -> "TurnBody":
        if not (self.text and self.text.strip()) and not self.action:
            raise ValueError("Say something or choose an action.")
        return self


class MemoryEdit(BaseModel):
    text: str = Field(min_length=1, max_length=80)


class GradeBody(BaseModel):
    rating: int = Field(ge=1, le=4)


@router.post("/sessions")
@limiter.limit("10/minute")
async def start_session(request: Request, body: StartBody, user: Any = Depends(verify_token)):
    uid = _uid(user)
    if not await reader.can_view_lecture(body.lecture_id, uid):
        raise HTTPException(status_code=404, detail="Lecture not found.")
    try:
        return await service.start(_store(), user_id=uid, space_id=body.space_id, lecture_id=str(body.lecture_id),
                                   page=body.page, opener=body.opener, locale=await _lang(request, uid))
    except service.LunaError as e:
        raise _http(e)


@router.post("/sessions/{session_id}/turn")
@limiter.limit("30/minute")
async def turn(request: Request, session_id: UUID, body: TurnBody, user: Any = Depends(verify_token)):
    uid = _uid(user)
    try:
        events = await service.open_turn(
            _store(), user_id=uid, session_id=str(session_id), client_turn_id=str(body.client_turn_id),
            text=body.text, action=body.action, plan_edit=[p.model_dump() for p in body.plan] if body.plan else None,
            reading_at=body.reading_at, check_result=body.check_result.model_dump() if body.check_result else None,
            locale=await _lang(request, uid),
        )
    except service.LunaError as e:
        raise _http(e)

    async def stream():
        try:
            async for event, data in events:
                yield _sse(event, data)
        finally:
            await events.aclose()

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/sessions/{session_id}/wrap")
@limiter.limit("6/minute")
async def wrap(request: Request, session_id: UUID, user: Any = Depends(verify_token)):
    uid = _uid(user)
    try:
        return await service.wrap(_store(), user_id=uid, session_id=str(session_id), locale=await _lang(request, uid))
    except service.LunaError as e:
        raise _http(e)


@router.post("/sessions/{session_id}/keep")
@limiter.limit("20/minute")
async def keep(request: Request, session_id: UUID, user: Any = Depends(verify_token)):
    uid = _uid(user)
    try:
        return await service.keep(_store(), user_id=uid, session_id=str(session_id), locale=await _lang(request, uid))
    except service.LunaError as e:
        raise _http(e)


@router.post("/sessions/{session_id}/practice")
@limiter.limit("6/minute")
async def practice(request: Request, session_id: UUID, user: Any = Depends(verify_token)):
    uid = _uid(user)
    try:
        return await service.practice(_store(), user_id=uid, session_id=str(session_id), locale=await _lang(request, uid))
    except service.LunaError as e:
        raise _http(e)


@router.get("/sessions")
@limiter.limit("60/minute")
async def list_sessions(request: Request, space_id: str = Query(min_length=1, max_length=64), user: Any = Depends(verify_token)):
    return {"sessions": await _store().list_sessions(_uid(user), space_id)}


@router.get("/sessions/{session_id}")
@limiter.limit("60/minute")
async def get_session(request: Request, session_id: UUID, user: Any = Depends(verify_token)):
    store = _store()
    session = await store.get_session(str(session_id), _uid(user))
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"session": session, "turns": await store.recent_turns(str(session_id), service.MAX_TURNS * 3)}


def _memory_out(m: dict) -> dict:
    return {"id": m["id"], "kind": m["kind"], "space_id": m["space_id"], "text": m["text"], "active": m["active"]}


@router.get("/memory")
@limiter.limit("60/minute")
async def list_memory(request: Request, user: Any = Depends(verify_token)):
    return {"memory": [_memory_out(m) for m in await _store().list_memory(_uid(user))]}


@router.patch("/memory/{memory_id}")
@limiter.limit("30/minute")
async def edit_memory(request: Request, memory_id: UUID, body: MemoryEdit, user: Any = Depends(verify_token)):
    m = await _store().edit_memory(_uid(user), str(memory_id), body.text.strip())
    if not m:
        raise HTTPException(status_code=404, detail="Not found.")
    return _memory_out(m)


@router.delete("/memory/{memory_id}")
@limiter.limit("30/minute")
async def delete_memory(request: Request, memory_id: UUID, user: Any = Depends(verify_token)):
    if not await _store().delete_memory(_uid(user), str(memory_id)):
        raise HTTPException(status_code=404, detail="Not found.")
    return {"deleted": True}


@router.delete("/memory")
@limiter.limit("5/minute")
async def forget_everything(request: Request, user: Any = Depends(verify_token)):
    return {"deleted": await _store().forget_all(_uid(user))}


@router.get("/practice/due")
@limiter.limit("60/minute")
async def due(request: Request, lecture_id: Optional[UUID] = None, user: Any = Depends(verify_token)):
    cards = await _store().due_cards(_uid(user), str(lecture_id) if lecture_id else None)
    return {"cards": cards, "total": len(cards)}


@router.post("/practice/{card_id}/grade")
@limiter.limit("120/minute")
async def grade(request: Request, card_id: UUID, body: GradeBody, user: Any = Depends(verify_token)):
    out = await _store().grade_owned_card(_uid(user), str(card_id), body.rating)
    if not out:
        raise HTTPException(status_code=404, detail="Card not found.")
    return out
