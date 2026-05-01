"""
JWT Authentication Middleware for FastAPI.
Validates Supabase access tokens on protected routes.
"""
import logging
from typing import Any, Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.core.database import supabase_admin
from backend.services.cache import get_cached_token, store_cached_token

logger = logging.getLogger(__name__)
security = HTTPBearer()

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Any:
    """
    Dependency that verifies the Supabase JWT from the Authorization header.
    Returns the authenticated user object or raises 401.
    Validated tokens are cached to avoid redundant Supabase round-trips.
    """
    token: str = credentials.credentials

    # 1. Check local cache first
    cached_user = get_cached_token(token)
    if cached_user:
        return cached_user

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
        store_cached_token(token, user)
        return user
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Authentication failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication system error.",
        )
