"""v4 on real data, beyond the reader.

Mounted under ``/api/v1/v4`` when ``FEATURE_V4`` is on. Every response is a
shape from src/features/spaces/types.ts (see v4_spaces_service).
"""
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.core.auth_middleware import _user_id, verify_token
from backend.core.rate_limit import limiter
from backend.services import v4_spaces_service as service

router = APIRouter(prefix="/v4", tags=["v4"])


def _uid(user: Any) -> str:
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Sign in first.")
    return uid


@router.get("/me")
@limiter.limit("60/minute")
async def v4_me(request: Request, user: Any = Depends(verify_token)):
    """The signed-in person, as the v4 `Person` every screen calls the viewer."""
    person = await service.get_person(_uid(user))
    if person is None:
        raise HTTPException(status_code=404, detail="No profile for this account.")
    return person


@router.post("/spaces/{space_id}/join")
@limiter.limit("30/minute")
async def v4_join_space(space_id: UUID, request: Request, user: Any = Depends(verify_token)):
    """Join an open Space (enrol in the course). Idempotent."""
    if not await service.join_space(str(space_id), _uid(user)):
        raise HTTPException(status_code=404, detail="Space not found.")
    return {"joined": True}


class _Ask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=2, max_length=600)
    space_id: Optional[UUID] = None


@router.post("/ask")
@limiter.limit("20/minute")
async def v4_ask(request: Request, body: _Ask, user: Any = Depends(verify_token)):
    """Home's ask bar: the grounded course tutor in the Space you are working in."""
    return await service.ask(_uid(user), body.question.strip(), str(body.space_id) if body.space_id else None)


@router.post("/friends/{person_id}/{answer}")
@limiter.limit("30/minute")
async def v4_answer_friend_request(person_id: UUID, answer: str, request: Request, user: Any = Depends(verify_token)):
    """Accept or decline a friend request addressed to you."""
    if answer not in ("accept", "decline"):
        raise HTTPException(status_code=404, detail="Not found.")
    if not await service.answer_friend_request(_uid(user), str(person_id), answer == "accept"):
        raise HTTPException(status_code=404, detail="No pending request from this person.")
    return {"ok": True}


class _NoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: str = Field(min_length=1, max_length=20000)
    lesson_id: Optional[UUID] = None


class _NoteEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: str = Field(min_length=1, max_length=20000)


@router.post("/notes")
@limiter.limit("60/minute")
async def v4_add_note(request: Request, body: _NoteIn, user: Any = Depends(verify_token)):
    """A private note, on a Lesson you can open or on nothing."""
    if not body.body.strip():
        raise HTTPException(status_code=422, detail="A note needs something in it.")
    try:
        return await service.add_note(_uid(user), body.body, str(body.lesson_id) if body.lesson_id else None)
    except LookupError:
        raise HTTPException(status_code=404, detail="Lesson not found.")


@router.patch("/notes/{note_id}")
@limiter.limit("120/minute")
async def v4_update_note(note_id: UUID, request: Request, body: _NoteEdit, user: Any = Depends(verify_token)):
    if not body.body.strip():
        raise HTTPException(status_code=422, detail="A note needs something in it.")
    note = await service.update_note(_uid(user), str(note_id), body.body)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found.")
    return note


@router.delete("/notes/{note_id}")
@limiter.limit("60/minute")
async def v4_delete_note(note_id: UUID, request: Request, user: Any = Depends(verify_token)):
    if not await service.delete_note(_uid(user), str(note_id)):
        raise HTTPException(status_code=404, detail="Note not found.")
    return {"deleted": True}


@router.post("/notifications/read-all")
@limiter.limit("30/minute")
async def v4_notifications_read_all(request: Request, user: Any = Depends(verify_token)):
    """The panel's one bulk action."""
    return {"marked": await service.mark_notifications_read(_uid(user))}


@router.get("/world")
@limiter.limit("60/minute")
async def v4_world(request: Request, user: Any = Depends(verify_token)):
    """Everything the core loop renders, in one round trip: the viewer, every
    Space they can see (theirs, joined, open to join) and those Spaces' Lessons."""
    world = await service.get_world(_uid(user))
    if world["viewer"] is None:
        raise HTTPException(status_code=404, detail="No profile for this account.")
    return world
