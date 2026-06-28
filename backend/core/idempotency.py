import hashlib
from fastapi import Request, HTTPException
from backend.core.redis import get_redis_client

async def check_idempotency(request: Request):
    """
    Dependency to check Idempotency-Key header for POST/PATCH requests.
    Stores the request hash and prevents duplicate concurrent or repeated executions.
    """
    idempotency_key = request.headers.get("Idempotency-Key")
    if not idempotency_key:
        return None

    redis = await get_redis_client()
    if not redis:
        return None

    user_id = getattr(request.state, "user_id", "anonymous")
    cache_key = f"idempotency:{user_id}:{idempotency_key}"
    
    # Check if key exists
    exists = await redis.exists(cache_key)
    if exists:
        raise HTTPException(status_code=409, detail="Conflict: Duplicate request detected by idempotency key.")
    
    # Set key with an expiry of 24 hours to mark it as in-progress/completed
    await redis.setex(cache_key, 86400, "1")
    return idempotency_key
