"""
Auth management endpoints.

Handles session lifecycle operations that require backend coordination —
primarily the logout flow, which must invalidate the shared token cache
immediately so a signed-out user cannot replay their token within the
45-second TTL window.

The frontend (Better Auth / Supabase Auth) handles the actual sign-in
and session minting; this router handles backend-side cleanup.
"""
import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from backend.core.auth_middleware import verify_token, require_role
from backend.core.rate_limit import limiter
from backend.services.cache import (
    invalidate_cached_token,
    purge_expired_backend_cache,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])
_bearer = HTTPBearer()


@router.post("/logout")
@limiter.limit("10/minute")
async def logout_endpoint(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    user: Any = Depends(verify_token),
):
    """Invalidate the current bearer token in the shared backend cache.

    Why this matters:
    - ``verify_token`` caches validated tokens for 45 seconds so all
      backend workers skip the Supabase Auth round-trip on repeat requests.
    - Without this endpoint, a user who signs out via the frontend still
      has a live cache entry for up to 45 seconds — enough time for a
      token replay attack if the JWT is intercepted.
    - Calling this endpoint deletes the ``auth_token:<hash>`` row from
      ``backend_cache`` immediately, making the token unusable across all
      workers within milliseconds.

    The frontend should call ``POST /api/auth/logout`` with the current
    bearer token immediately before (or after) calling the Supabase
    ``auth.signOut()`` method.
    """
    token = credentials.credentials
    await invalidate_cached_token(token)
    return {"message": "Session invalidated."}


@router.post("/cleanup-token-cache")
@limiter.limit("5/minute")
async def cleanup_token_cache_endpoint(
    request: Request,
    user: Any = Depends(require_role("admin")),
):
    """Purge all expired rows from the shared ``backend_cache`` table.

    Expired token rows are invisible to ``get_cache()`` already (filtered
    by ``expires_at > now()``), but they accumulate on disk until deleted.
    This endpoint triggers the ``cleanup_backend_cache`` PostgreSQL function
    to physically remove them.

    Rate-limited to 5/minute.  Can also be run as a nightly pg_cron job:
        ``SELECT cleanup_backend_cache();``
    """
    deleted = await purge_expired_backend_cache()
    return {"deleted": deleted, "message": f"Purged {deleted} expired cache rows."}
