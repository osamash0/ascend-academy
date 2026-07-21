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
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from backend.core.auth_middleware import verify_token, require_role, _user_id
from backend.core.database import supabase_admin
from backend.core.rate_limit import limiter
from backend.services.account_service import (
    erase_user_storage_and_derived_data,
    export_user_data,
)
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


@router.get("/export-data")
@limiter.limit("5/minute")
async def export_data_endpoint(
    request: Request,
    user: Any = Depends(verify_token),
):
    """Export every PII / derived-from-PII row belonging to the caller
    (GDPR Art. 20 right to data portability).

    Returns a single JSON document — one key per source table (profile,
    progress, events, uploads/lectures, exams, review schedule, etc.) plus
    ``exported_at``. This is the full server-side counterpart to the
    previously partial client-side-only export in ``src/pages/Settings.tsx``.
    """
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user context.")

    try:
        return await export_user_data(uid)
    except Exception as e:
        logger.error("Data export failed for %s: %s", uid, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not export your data. Please contact support.",
        )


@router.post("/delete-account")
@limiter.limit("3/minute")
async def delete_account_endpoint(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    user: Any = Depends(verify_token),
):
    """Permanently delete the caller's account (GDPR right to erasure).

    Deleting the ``auth.users`` row is a service-role-only operation, so it
    cannot be done from the client. It also cascades: every table that
    references ``auth.users(id) ON DELETE CASCADE`` (profiles, achievements,
    student_progress, practice_attempts, …) is cleaned up by Postgres, which is
    why client-side row deletion alone (the old Settings flow) left the auth
    identity — and anything not client-reachable — behind.

    Two things a DB cascade cannot reach — Supabase Storage objects
    (``pdf-uploads``/``worksheets``) and the (historically script-only)
    ``slide_embeddings``/``lecture_blueprints`` rows — are cleaned up
    explicitly by ``erase_user_storage_and_derived_data`` BEFORE the
    ``auth.users`` row is deleted, since that call reads ``lectures`` rows a
    subsequent cascade would otherwise remove first. See
    ``backend/services/account_service.py`` for the full design rationale
    (content-addressed dedup safety, what is intentionally NOT deleted).

    We invalidate the token cache first so the just-deleted user can't replay
    their bearer token within the 45s TTL window.
    """
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user context.")

    await invalidate_cached_token(credentials.credentials)

    try:
        storage_summary = await erase_user_storage_and_derived_data(uid)
    except Exception as e:
        # Non-fatal: storage cleanup failing should not block the user's
        # right to erasure of their DB-resident data. Logged for follow-up;
        # any orphaned content-addressed blob is still unreachable once the
        # owning lecture rows are cascaded away with the auth.users delete.
        logger.error("Erasure storage cleanup failed for %s: %s", uid, e)
        storage_summary = None

    try:
        await run_in_threadpool(supabase_admin.auth.admin.delete_user, uid)
    except Exception as e:
        logger.error("Account deletion failed for %s: %s", uid, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not delete the account. Please contact support.",
        )
    return {"message": "Account deleted.", "storage_cleanup": storage_summary}


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
