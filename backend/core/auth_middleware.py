"""
JWT Authentication Middleware for FastAPI.
Validates Supabase access tokens on protected routes.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.core.database import supabase

security = HTTPBearer()


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Dependency that verifies the Supabase JWT from the Authorization header.
    Returns the authenticated user object or raises 401.
    """
    token = credentials.credentials
    try:
        user_response = supabase.auth.get_user(token)
        if user_response and user_response.user:
            return user_response.user
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        )
