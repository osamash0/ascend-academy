import hashlib

from fastapi import Request, HTTPException
from backend.core.redis import get_redis_client


def _caller_namespace(request: Request) -> str:
    """A stable per-caller key for idempotency scoping.

    Previously this read `request.state.user_id`, which nothing in this
    codebase ever sets (grep confirms no assignment anywhere) — every caller
    fell back to the literal string "anonymous", so two different users
    sending the same Idempotency-Key value collided in one shared bucket and
    could 409 each other's unrelated requests.

    Hashing the bearer token instead gives a stable per-session identity
    without needing auth to have already resolved a user id at this point in
    the dependency chain, and mirrors the existing sha256(token) scheme
    already used for the auth-token cache (backend/services/cache.py's
    `_hash_token`) rather than inventing a second convention.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header:
        return "no-auth"
    return hashlib.sha256(auth_header.encode("utf-8")).hexdigest()[:32]


async def check_idempotency(request: Request):
    """
    Dependency to guard POST/PATCH handlers against duplicate *execution* for
    the same (caller, Idempotency-Key) pair — e.g. a client retrying after a
    dropped connection before it saw the original response.

    This blocks a repeat within the window with 409; it does not replay the
    original response body (that would require buffering and storing every
    guarded response, a larger change not needed to fix the two real bugs
    here). A caller retrying a *successful* prior request gets a 409, not the
    original result — a deliberate, documented scope cut, same as the
    codebase's existing convention for calling out cut corners in code
    rather than leaving them implicit.

    Fixes two verified bugs in the previous version:
      1. Every caller collided in one "anonymous" namespace (see
         `_caller_namespace`), so two different users using the same key
         value could spuriously conflict with each other.
      2. The key was set *before* the handler ran and never released or
         extended-then-shortened afterward, so any transient failure (a
         dropped DB connection, a timeout) left the key standing for the
         full 24h TTL — every retry with the same key 409'd for a full day
         even though nothing had actually succeeded. Fixed by releasing the
         key when the guarded handler raises (FastAPI propagates the
         handler's exception into this generator at the `yield`, the same
         mechanism used for e.g. rolling back a DB session dependency on
         error) so an immediate retry after a failure is not locked out.
    """
    idempotency_key = request.headers.get("Idempotency-Key")
    if not idempotency_key:
        yield None
        return

    redis = await get_redis_client()
    if not redis:
        yield None
        return

    cache_key = f"idempotency:{_caller_namespace(request)}:{idempotency_key}"

    # Atomic acquire: SET ... NX only succeeds for the first caller to touch
    # this (caller, key) pair within the window; a concurrent or retried
    # duplicate gets a clean 409 instead of a race between exists()+setex().
    acquired = await redis.set(cache_key, "in-progress", nx=True, ex=86400)
    if not acquired:
        raise HTTPException(status_code=409, detail="Conflict: Duplicate request detected by idempotency key.")

    try:
        yield idempotency_key
    except Exception:
        await redis.delete(cache_key)
        raise
