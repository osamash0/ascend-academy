"""
JWT Authentication Middleware for FastAPI.
Validates Supabase access tokens on protected routes.
"""
import logging
from dataclasses import dataclass, field
from typing import Any, Optional
from fastapi import Depends, HTTPException, status, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from backend.core.database import supabase_admin, get_client, get_session
from backend.services.cache import get_cached_token, store_cached_token, invalidate_cached_token
from backend.core.rbac import has_permission

logger = logging.getLogger(__name__)
security = HTTPBearer(auto_error=False)


@dataclass
class CachedUser:
    """Lightweight user object reconstructed from the backend_cache table.

    The Supabase ``User`` model is a complex Pydantic object.  When we
    round-trip it through JSON (to store in backend_cache) and back out,
    we lose the Pydantic model.  This dataclass rehydrates only the
    fields our auth/authz code actually reads, so downstream code that
    does ``user.id``, ``user.email``, ``user.app_metadata`` continues
    to work without change.
    """
    id: str = ""
    email: str = ""
    app_metadata: dict = field(default_factory=dict)
    user_metadata: dict = field(default_factory=dict)
    role: str = ""

    @classmethod
    def from_dict(cls, data: dict) -> "CachedUser":
        return cls(
            id=data.get("id", ""),
            email=data.get("email", ""),
            app_metadata=data.get("app_metadata") or {},
            user_metadata=data.get("user_metadata") or {},
            role=data.get("role", ""),
        )

@dataclass
class ApiTokenUser:
    id: str
    email: str = ""
    app_metadata: dict = field(default_factory=dict)
    user_metadata: dict = field(default_factory=dict)
    role: str = ""
    course_id_scope: Optional[str] = None
    is_api_token: bool = True

async def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    session = Depends(get_session)
) -> Any:
    """
    FastAPI dependency that verifies the Supabase JWT from the Authorization
    header and returns the authenticated user object (or raises 401).

    Cache flow:
      1. Hash the raw token with SHA-256 → lookup ``auth_token:<hash>``
         in the shared ``backend_cache`` table (45s TTL).
      2. Cache HIT  → reconstruct a ``CachedUser`` and return immediately
         (no Supabase Auth round-trip, ~2ms latency).
      3. Cache MISS → call ``supabase_admin.auth.get_user(token)`` (~150ms),
         coerce the result to JSON-safe data, write it to the cache,
         and return the live Supabase User object.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header.",
        )

    token: str = credentials.credentials

    # Intercept API Tokens (aa_...)
    if token.startswith("aa_"):
        import hashlib
        from sqlmodel import select
        from backend.models.rbac import ApiToken
        
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        stmt = select(ApiToken).where(ApiToken.token_hash == token_hash, ApiToken.is_active == True)
        res = await session.exec(stmt)
        api_token = res.first()
        
        if not api_token:
            raise HTTPException(status_code=401, detail="Invalid API token.")
            
        return ApiTokenUser(
            id=str(api_token.user_id),
            course_id_scope=str(api_token.course_id_scope) if api_token.course_id_scope else None
        )

    # 0. Check blocklist first
    from backend.services.cache import is_token_blocklisted
    if await is_token_blocklisted(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session invalidated.",
        )

    # 1. Check shared database L2 cache first
    cached_user = await get_cached_token(token)
    if cached_user:
        if isinstance(cached_user, dict):
            return CachedUser.from_dict(cached_user)
        return cached_user

    # 2. Verify with Supabase Auth (slow path)
    try:
        user_response = await run_in_threadpool(supabase_admin.auth.get_user, token)

        if not user_response or not user_response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token.",
            )

        user = user_response.user
        # Store in shared cache so other workers skip the Auth round-trip
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
            db_roles = await run_in_threadpool(_lookup_role_from_db, uid)
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


def require_permission(permission: str, check_course: bool = False):
    """
    Dependency factory that ensures the authenticated user has the required permission.
    If check_course is True, it will attempt to extract course_id from path_params
    and verify the user has the permission specifically for that course.
    """

    async def _checker(
        request: Request,
        user: Any = Depends(verify_token),
        session=Depends(get_session)
    ) -> Any:
        uid = _user_id(user)
        if not uid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid user context.",
            )

        course_id = None
        if check_course:
            course_id = request.path_params.get("course_id")
            
        # 1. Enforce ApiToken strict scoping
        if getattr(user, "is_api_token", False):
            scope = getattr(user, "course_id_scope", None)
            if scope is not None:
                # Token is scoped to a specific course
                if not check_course or not course_id or str(scope) != str(course_id):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="API token scope does not permit this action.",
                    )
            
        # 2. Check RBAC permissions
        allowed = await has_permission(session, uid, permission, course_id)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions for this action.",
            )
            
        return user

    return _checker
