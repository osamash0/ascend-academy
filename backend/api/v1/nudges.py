"""Nudge engine API.

Currently exposes:
    POST /api/nudges/{notification_id}/dismiss   — mark a nudge dismissed
    POST /api/nudges/run                          — manual trigger (admin)

The dismiss endpoint is what the student-dashboard banner calls when the user
hits the X. The run endpoint is intended for cron / smoke-testing — it is
gated behind a shared-secret header so it can be called by a Supabase cron
job without a real user JWT.
"""
from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from backend.core.auth_middleware import _user_id, verify_token
from backend.core.rate_limit import limiter
from backend.services import nudge_engine

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/nudges", tags=["nudges"])


class _Envelope(BaseModel):
    success: bool
    data: Any = None


@router.post("/{notification_id}/dismiss", response_model=_Envelope)
@limiter.limit("60/minute")
async def dismiss_nudge(
    request: Request,
    notification_id: str,
    user: Any = Depends(verify_token),
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _do() -> bool:
        return nudge_engine.dismiss_nudge(user_id=uid, notification_id=notification_id)

    ok = await run_in_threadpool(_do)
    if not ok:
        # Don't leak existence — but the engine only matches rows the user
        # owns, so a False is genuinely "no such dismissable nudge".
        raise HTTPException(status_code=404, detail="Nudge not found.")
    return _Envelope(success=True, data={"dismissed": True})


@router.post("/run", response_model=_Envelope)
async def run_engine(
    x_nudge_run_secret: str = Header(default=""),
):
    """Manual trigger for the daily runner.

    Protected by a shared secret so a Supabase cron / external scheduler can
    call it without minting a JWT. If the secret is not configured, the
    endpoint is disabled (404) rather than open to the world.
    """
    expected = os.environ.get("NUDGE_RUN_SECRET", "")
    if not expected:
        raise HTTPException(status_code=404, detail="Not found.")
    if x_nudge_run_secret != expected:
        raise HTTPException(status_code=401, detail="Unauthorized.")
    report = await run_in_threadpool(nudge_engine.run_daily)
    return _Envelope(success=True, data=report)
