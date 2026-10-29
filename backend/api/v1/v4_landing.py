"""How it's landing: the owner's view of a Space (spec §4 B4).

Mounted with the other v4 routers (FEATURE_V4). Only the person who runs a
Space may open it: a member gets 403, everyone else 404. The payload is
aggregates over members only, with no member's words in it.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request

from backend.core.auth_middleware import _user_id, verify_token
from backend.core.config import settings
from backend.core.rate_limit import limiter
from backend.services import v4_landing_service as service

router = APIRouter(prefix="/v4", tags=["v4"])


def _uid(user: Any) -> str:
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Sign in first.")
    return uid


def _lang(request: Request) -> str:
    """The app's language, as every v4 request tags it (`?lang=`)."""
    return "de" if (request.query_params.get("lang") or "").lower().startswith("de") else "en"


@router.get("/spaces/{space_id}/landing")
@limiter.limit("30/minute")
async def v4_landing(request: Request, space_id: UUID, user: Any = Depends(verify_token)):
    """Figures, every Lesson's light and help, ranked findings and themes."""
    return await service.get_landing(space_id, _uid(user), _lang(request))


def _people_salt() -> str:
    """Person-level views exist only with the flag on and a salt set; otherwise they are not here."""
    if not settings.feature_landing_people or not settings.landing_pseudonym_salt:
        raise HTTPException(status_code=404, detail="Not found.")
    return settings.landing_pseudonym_salt


@router.get("/spaces/{space_id}/landing/people")
@limiter.limit("30/minute")
async def v4_landing_people(
    request: Request, space_id: UUID, user: Any = Depends(verify_token), salt: str = Depends(_people_salt)
):
    return await service.get_people(space_id, _uid(user), salt)


@router.get("/spaces/{space_id}/landing/people/{person}/journey")
@limiter.limit("30/minute")
async def v4_landing_journey(
    request: Request,
    space_id: UUID,
    person: str = Path(pattern=r"^p_[0-9a-f]{16}$"),
    lesson: UUID = Query(...),
    user: Any = Depends(verify_token),
    salt: str = Depends(_people_salt),
):
    steps = await service.get_journey(space_id, _uid(user), salt, person, str(lesson))
    if steps is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return {"steps": steps}
