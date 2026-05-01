"""
JWT Authentication Middleware for FastAPI.
Validates Supabase access tokens on protected routes.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.core.database import supabase
from backend.services.cache import get_cached_token, store_cached_token

security = HTTPBearer()


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Dependency that verifies the Supabase JWT from the Authorization header.
    Returns the authenticated user object or raises 401.
    Validated tokens are cached for 45 seconds to avoid redundant Supabase round-trips.
    """
    token = credentials.credentials

    cached = get_cached_token(token)
    if cached:
        return cached

    try:
        user_response = supabase.auth.get_user(token)
        if user_response and user_response.user:
            store_cached_token(token, user_response.user)
            return user_response.user
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        )
