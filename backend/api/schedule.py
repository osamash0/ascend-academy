"""Personalized weekly study plan endpoints (Task #35).

    GET  /api/schedule/me?days=7         — plan for the authenticated student
    POST /api/schedule/items/{id}/done   — mark one plan item complete

The plan is regenerated on each request from current Supabase state, so
"completing" an item just writes a tiny per-(user, plan_date, lecture_id)
row that the scheduler then strips out of today's view.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from backend.core.auth_middleware import _user_id, verify_token
from backend.core.database import supabase_admin
from backend.core.rate_limit import limiter
from backend.services import scheduler

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/schedule", tags=["schedule"])


class _Envelope(BaseModel):
    success: bool
    data: Any = None


@router.get("/me", response_model=_Envelope)
@limiter.limit("60/minute")
async def get_my_plan(
    request: Request,
    days: int = Query(7, ge=1, le=14),
    user: Any = Depends(verify_token),
):
    """Return the per-day study plan for the authenticated student."""
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _build():
        return scheduler.build_plan_for_user(uid, days, supabase_admin)

    try:
        plan = await run_in_threadpool(_build)
    except Exception as e:
        logger.error("Schedule build failed for %s: %s", uid, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to build study plan.")
    return _Envelope(success=True, data=scheduler.plan_to_dict(plan))


@router.post("/items/{item_id}/done", response_model=_Envelope)
@limiter.limit("60/minute")
async def mark_item_done(
    request: Request,
    item_id: str,
    user: Any = Depends(verify_token),
):
    """Record that the user finished one plan item."""
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    try:
        plan_date, lecture_id = scheduler.parse_item_id(item_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Malformed item id.")

    def _persist():
        return scheduler.record_completion(uid, plan_date, lecture_id, supabase_admin)

    try:
        result = await run_in_threadpool(_persist)
    except Exception as e:
        logger.error("Schedule completion failed for %s/%s: %s", uid, item_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to record completion.")
    return _Envelope(success=True, data=result)
