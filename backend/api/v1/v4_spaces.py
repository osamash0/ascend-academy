"""v4 on real data, beyond the reader.

Mounted under ``/api/v1/v4`` when ``FEATURE_V4`` is on. Every response is a
shape from src/features/spaces/types.ts (see v4_spaces_service).
"""
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field

from backend.core.auth_middleware import _user_id, require_creator, require_student, verify_token
from backend.core.config import settings
from backend.core.rate_limit import limiter
from backend.services import materials_service
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


class _Visibility(BaseModel):
    model_config = ConfigDict(extra="forbid")
    showInSpaces: bool


@router.patch("/me/visibility")
@limiter.limit("30/minute")
async def v4_set_visibility(request: Request, body: _Visibility, user: Any = Depends(verify_token)):
    """Whether the people in your Spaces see you: rankings and Space cards (LS-036)."""
    on = await service.set_show_in_spaces(_uid(user), body.showInSpaces)
    if on is None:
        raise HTTPException(status_code=404, detail="No profile for this account.")
    return {"showInSpaces": on}


class _NewSpace(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=4000)


@router.post("/spaces", status_code=201)
@limiter.limit("10/minute")
async def v4_create_space(request: Request, body: _NewSpace, user: Any = Depends(require_creator)):
    """Make a Space on the stage (LS-050): a course you own, empty to start."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="A Space needs a name.")
    description = (body.description or "").strip() or None
    return {"id": await service.create_space(_uid(user), name, description)}


class _Publish(BaseModel):
    model_config = ConfigDict(extra="forbid")
    published: bool


@router.patch("/spaces/{space_id}")
@limiter.limit("30/minute")
async def v4_publish_space(space_id: UUID, request: Request, body: _Publish, user: Any = Depends(require_creator)):
    """Make your Space visible to others, or private again (LS-072). Owners only."""
    status = await service.set_space_published(str(space_id), _uid(user), body.published)
    if status is None:
        raise HTTPException(status_code=404, detail="Space not found.")
    return {"published": status == "published"}


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


def _uploads_on() -> None:
    if not settings.feature_student_uploads:
        raise HTTPException(status_code=404, detail="Not found.")


@router.post("/uploads")
@limiter.limit("10/minute")
async def v4_upload(request: Request, file: UploadFile = File(...), user: Any = Depends(require_student)):
    """Bring a file into your Library: a private lecture in your personal Space.

    The same quota-gated pipeline as My Materials; a file you already brought
    in comes back as that lecture instead of a second parse.
    """
    _uploads_on()
    uid = _uid(user)
    try:
        return await materials_service.create_upload(uid, file)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except materials_service.QuotaExceededError as e:
        raise HTTPException(status_code=403, detail=f"You have used all {e.limit} uploads for this month.")


@router.get("/uploads")
@limiter.limit("60/minute")
async def v4_uploads(request: Request, user: Any = Depends(require_student)):
    """Your uploads as the shelf shows them — polled while one is developing."""
    _uploads_on()
    return {"uploads": await service.uploads_for(_uid(user))}


@router.get("/uploads/{run_id}/reading")
@limiter.limit("120/minute")
async def v4_upload_reading(run_id: UUID, request: Request, user: Any = Depends(require_student)):
    """Read your own file while Luna is still reading it: a signed link and her progress."""
    _uploads_on()
    view = await service.early_reading(_uid(user), str(run_id))
    if view is None:
        raise HTTPException(status_code=404, detail="Nothing of yours by that id.")
    return view


@router.delete("/uploads/{upload_id}")
@limiter.limit("30/minute")
async def v4_remove_upload(upload_id: UUID, request: Request, user: Any = Depends(require_student)):
    """Remove one of your uploads: its Lesson (by lecture id) or a failed run (by run id)."""
    _uploads_on()
    if not await service.remove_upload(_uid(user), str(upload_id)):
        raise HTTPException(status_code=404, detail="Nothing of yours by that id.")
    return {"removed": True}


@router.get("/world")
@limiter.limit("60/minute")
async def v4_world(request: Request, user: Any = Depends(verify_token)):
    """Everything the core loop renders, in one round trip: the viewer, every
    Space they can see (theirs, joined, open to join) and those Spaces' Lessons."""
    world = await service.get_world(_uid(user))
    if world["viewer"] is None:
        raise HTTPException(status_code=404, detail="No profile for this account.")
    return world
