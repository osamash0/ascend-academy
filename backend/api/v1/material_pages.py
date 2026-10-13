"""Studio pages for one material (real-pages spec §6).

Lives on its own router so it is mounted for FEATURE_STUDIO_PAGES even when
student uploads (which own the rest of /materials) are off.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.core.auth_middleware import _user_id, verify_token
from backend.core.rate_limit import limiter

router = APIRouter(prefix="/materials", tags=["materials"])


@router.get("/{lecture_id}/pages")
@limiter.limit("60/minute")
async def material_pages(request: Request, lecture_id: str, user: Any = Depends(verify_token)):
    """Studio pages: pictures, block geometry, calm summaries (real-pages spec §6).
    Any signed-in reader of the lecture may open it, not only its uploader."""
    from backend.services import studio_pages_service as svc

    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Sign in to open this.")
    try:
        lid = UUID(lecture_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found.")
    try:
        return await svc.get_pages(str(lid), uid)
    except svc.NotVisible:
        raise HTTPException(status_code=404, detail="Not found.")
    except svc.StillDeveloping:
        raise HTTPException(status_code=409, detail="Still reading your pages.")


def mount_materials_routers(parent: Any, settings: Any) -> None:
    """Mount the /materials routers according to the feature flags."""
    if settings.feature_student_uploads:
        from backend.api.v1.materials import router as materials_router

        parent.include_router(materials_router)
    if settings.feature_student_uploads or settings.feature_studio_pages:
        parent.include_router(router)
