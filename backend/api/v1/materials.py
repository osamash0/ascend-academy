"""My Materials API — student self-serve uploads (Roadmap Phase 3.1).

Endpoints:
    POST   /api/v1/materials/upload      — upload a personal PDF (quota-gated)
    GET    /api/v1/materials             — list the caller's private uploads
    GET    /api/v1/materials/quota       — this month's quota status
    DELETE /api/v1/materials/{lecture_id} — delete an owned private lecture

All endpoints require the `student` role. The uploaded PDF gets the same
parse pipeline as a professor's lecture (slides, quizzes, tutor chat, review
cards, semantic search) but stays private to the uploader.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

from backend.core.auth_middleware import _user_id, require_student
from backend.core.rate_limit import limiter
from backend.services import materials_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/materials", tags=["materials"])


@router.post("/upload")
@limiter.limit("10/minute")
async def upload_material(
    request: Request,
    file: UploadFile = File(...),
    user: Any = Depends(require_student),
):
    user_id = _user_id(user)
    try:
        result = await materials_service.create_upload(user_id, file)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except materials_service.QuotaExceededError as e:
        raise HTTPException(
            status_code=403,
            detail=f"You've used all {e.limit} uploads for this month. Upgrade for more.",
        )
    except Exception:
        logger.exception("Student upload failed for user %s", user_id)
        raise HTTPException(status_code=500, detail="Upload failed. Please retry.")
    return result


@router.get("")
@limiter.limit("30/minute")
async def list_materials(request: Request, user: Any = Depends(require_student)):
    user_id = _user_id(user)
    materials = await materials_service.list_my_materials(user_id)
    return {"materials": materials}


@router.get("/quota")
@limiter.limit("30/minute")
async def get_quota(request: Request, user: Any = Depends(require_student)):
    user_id = _user_id(user)
    return await materials_service.get_quota_status(user_id)


@router.delete("/{lecture_id}")
@limiter.limit("30/minute")
async def delete_material(request: Request, lecture_id: str, user: Any = Depends(require_student)):
    user_id = _user_id(user)
    try:
        deleted = await materials_service.delete_material(user_id, lecture_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid lecture_id.")
    if not deleted:
        raise HTTPException(status_code=404, detail="Material not found or not owned by you.")
    return {"lecture_id": lecture_id, "deleted": True}
