"""Per-feature user feedback endpoint.

POST /api/feedback — any signed-in user can submit a free-text comment about
a feature. Stored in `public.user_feedback`. Service-role insert keeps the
endpoint working even if the user-scoped client cannot satisfy RLS.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.core.auth_middleware import verify_token, _user_id
from backend.core.database import supabase_admin
from backend.core.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/feedback", tags=["feedback"])


class FeedbackBody(BaseModel):
    feature: str = Field(..., min_length=1, max_length=120)
    message: str = Field(..., min_length=1, max_length=4000)
    route: Optional[str] = Field(default=None, max_length=500)


@router.post("")
@limiter.limit("10/minute")
async def submit_feedback(
    request: Request,
    body: FeedbackBody,
    user: Any = Depends(verify_token),
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    user_agent = request.headers.get("user-agent", "")[:500] or None

    try:
        supabase_admin.table("user_feedback").insert({
            "user_id": uid,
            "feature": body.feature.strip(),
            "message": body.message.strip(),
            "route": body.route,
            "user_agent": user_agent,
        }).execute()
    except Exception as e:
        logger.error("Feedback insert failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not record feedback.")

    return {"ok": True}
