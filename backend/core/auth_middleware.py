"""
JWT Authentication Middleware for FastAPI.
Validates Supabase access tokens on protected routes.
"""
import logging
from dataclasses import dataclass, field
from typing import Any, Optional
import httpx
from fastapi import Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from backend.core.database import supabase_admin
from backend.services.cache import get_cached_token, store_cached_token

logger = logging.getLogger(__name__)
security = HTTPBearer(auto_error=False)

# Bounded timeout: this client backs every auth-cache-miss request. Without a
# bound a slow Supabase Auth would hang each request indefinitely and pile up.
_AUTH_TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0)

# Shared, connection-pooled client reused across requests. A fresh
# AsyncClient per request (the previous approach) pays a new TCP+TLS
# handshake to Supabase Auth on every cache miss (~150-700ms measured
# locally); reusing one client via keep-alive drops that to ~30ms.
_auth_http_client: Optional[httpx.AsyncClient] = None


def get_auth_http_client() -> httpx.AsyncClient:
    global _auth_http_client
    if _auth_http_client is None:
        _auth_http_client = httpx.AsyncClient(http2=False, timeout=_AUTH_TIMEOUT)
    return _auth_http_client


async def close_auth_http_client() -> None:
    global _auth_http_client
    if _auth_http_client is not None:
        await _auth_http_client.aclose()
        _auth_http_client = None


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

async def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
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
        url = f"{supabase_admin.auth_url}/user"
        client = get_auth_http_client()
        resp = await client.get(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": supabase_admin.supabase_key,
            }
        )

        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token.",
            )

        user_data = resp.json()
        user = CachedUser.from_dict(user_data)
        
        # Store in shared cache so other workers skip the Auth round-trip
        await store_cached_token(token, user)
        return user

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Authentication failed: %s", e, exc_info=True)
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
# Course/lecture creation is open to any authenticated user, professor or
# student — ownership (not role) is what RLS and endpoint checks gate on.
require_creator = require_role("professor", "student")
