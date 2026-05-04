"""
JWT Authentication Middleware for FastAPI.
Validates Supabase access tokens on protected routes.
"""
import logging
from typing import Any, Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from backend.core.database import supabase_admin, get_client
from backend.services.cache import get_cached_token, store_cached_token

logger = logging.getLogger(__name__)
security = HTTPBearer()

async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Any:
    """
    Dependency that verifies the Supabase JWT from the Authorization header.
    Returns the authenticated user object or raises 401.
    Validated tokens are cached to avoid redundant Supabase round-trips.
    """
    token: str = credentials.credentials

    # 1. Check shared database cache first
    cached_user = await get_cached_token(token)
    if cached_user:
        # Wrap dict back into a DotDict-like object if necessary, or just return dict
        # Most of our code expects user.id, so we should ensure it behaves like an object
        from argparse import Namespace
        return Namespace(**cached_user) if isinstance(cached_user, dict) else cached_user

    # 2. Verify with Supabase Auth
    try:
        # Use supabase_admin for user lookup to ensure consistency, 
        # but the token itself proves user ownership.
        user_response = supabase_admin.auth.get_user(token)
        
        if not user_response or not user_response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token.",
            )
            
        user = user_response.user
        await store_cached_token(token, user)
        return user
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Authentication failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication system error.",
        )


def _user_id(user: Any) -> str:
    """Extract the user id from a Supabase user object or dict."""
    if hasattr(user, "id"):
        return user.id
    if isinstance(user, dict):
        return user.get("id") or user.get("user_id") or ""
    return ""


def _app_metadata(user: Any) -> dict:
    """
    Extract app_metadata dict from a Supabase user object/dict.

    NOTE: app_metadata is server-controlled (only writable by the service
    role / admin API) and therefore safe to use for authorization. Do NOT
    use user_metadata for authz — it is editable by the user themself.
    """
    meta = getattr(user, "app_metadata", None)
    if meta is None and isinstance(user, dict):
        meta = user.get("app_metadata") or user.get("raw_app_meta_data")
    return meta or {}


def _lookup_role_from_db(uid: str) -> Optional[set]:
    """Look up the user's role(s) from the user_roles table. Returns None on error."""
    try:
        res = (
            supabase_admin.table("user_roles")
            .select("role")
            .eq("user_id", uid)
            .execute()
        )
        return {row.get("role") for row in (res.data or []) if row.get("role")}
    except Exception as e:
        logger.warning("Role lookup failed for user %s: %s", uid, e)
        return None


def require_role(*allowed_roles: str):
    """
    Dependency factory that ensures the authenticated user has one of the
    allowed roles. Checks JWT app_metadata.role first (no DB round-trip) and
    falls back to the user_roles table for backward compatibility.
    Raises 403 if no allowed role matches.

    Usage:
        @router.post("/endpoint", ...)
        async def endpoint(user=Depends(require_role("professor"))): ...
    """

    async def _checker(user: Any = Depends(verify_token)) -> Any:
        uid = _user_id(user)
        if not uid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid user context.",
            )

        # 1. Trusted source: JWT app_metadata.role. app_metadata is only
        #    writable by the service role, so it is safe for authz.
        #    user_metadata is intentionally NOT consulted because it is
        #    user-controlled and trivially forgeable by the account owner.
        meta = _app_metadata(user)
        meta_role = meta.get("role") if isinstance(meta, dict) else None
        roles: set = {meta_role} if meta_role else set()

        # 2. Fallback: read user_roles table. Writes to user_roles are
        #    locked down by RLS to the SECURITY DEFINER signup trigger
        #    (see migration 20260502000003), so this is also trustworthy.
        if not roles.intersection(allowed_roles):
            db_roles = _lookup_role_from_db(uid)
            if db_roles is not None:
                roles |= db_roles

        if not roles.intersection(allowed_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions for this action.",
            )
        return user

    return _checker


# Convenience aliases
require_professor = require_role("professor")
require_student = require_role("student")
