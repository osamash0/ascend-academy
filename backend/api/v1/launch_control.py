"""Launch Control API — the admin's launch-day screen.

GET  /admin/launch/overview                       gates, real-user pulse, AI spend, catalog
POST /admin/launch/users/{user_id}/classification mark one account internal / real / auto

See backend/services/launch_control_service.py for what each panel measures.
"""
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.core.auth_middleware import _user_id, require_role
from backend.core.database import get_db_connection
from backend.core.rate_limit import limiter
from backend.services import launch_control_service as svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/launch", tags=["admin"])
require_admin = require_role("admin")


@router.get("/overview")
@limiter.limit("60/minute")
async def launch_overview(request: Request, user: Any = Depends(require_admin)):
    try:
        conn_cm = await get_db_connection()
        async with conn_cm as conn:
            return await svc.build_overview(conn)
    except Exception as e:
        logger.error("Launch overview failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to build the launch overview.")


class ClassificationRequest(BaseModel):
    # true = internal, false = real, null = back to the email rules.
    is_internal: Optional[bool] = None
    reason: Optional[str] = Field(default=None, max_length=200)


@router.post("/users/{target_user_id}/classification")
@limiter.limit("30/minute")
async def set_user_classification(
    target_user_id: str,
    body: ClassificationRequest,
    request: Request,
    user: Any = Depends(require_admin),
):
    try:
        conn_cm = await get_db_connection()
        async with conn_cm as conn:
            if not await conn.fetchval(
                "SELECT 1 FROM public.profiles WHERE user_id = $1::uuid", target_user_id
            ):
                raise HTTPException(status_code=404, detail="No such user.")
            await svc.set_classification(
                conn, user_id=target_user_id, is_internal=body.is_internal,
                reason=body.reason, set_by=_user_id(user),
            )
            row = await conn.fetchrow(
                "SELECT is_internal, internal_reason FROM public.account_classification "
                "WHERE user_id = $1::uuid",
                target_user_id,
            )
            return {"user_id": target_user_id, **dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Classification update failed for %s: %s", target_user_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update the account.")
