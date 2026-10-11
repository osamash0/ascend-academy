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
