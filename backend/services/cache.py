import hashlib
import json
import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Any, Optional, List, Dict
from uuid import UUID

from backend.core.database import supabase_admin, db_pool
from fastapi.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)


def _json_safe_default(obj: Any) -> Any:
    """JSON encoder fallback for non-primitive types Supabase User objects can carry.

    Supabase's `User` model exposes datetime fields (created_at, last_sign_in_at, …)
    and UUID `id`, both of which the JSON serializer used by postgrest / httpx
    rejects with TypeError. We coerce them here so `set_cache` never crashes
    silently and `store_cached_token` can persist the auth-token cache row.
    """
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, (set, frozenset)):
        return list(obj)
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    if hasattr(obj, "dict") and callable(getattr(obj, "dict")):
        try:
            return obj.dict()
        except Exception:
            pass
    if hasattr(obj, "__dict__"):
        return {k: v for k, v in obj.__dict__.items() if not k.startswith("_")}
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _to_json_safe(value: Any) -> Any:
    """Recursively coerce *value* into JSON-primitive types using `_json_safe_default`."""
    return json.loads(json.dumps(value, default=_json_safe_default))


# --- Token validation cache (Shared Database L2 Cache) ---
# Note: We use the generic backend_cache table to share token validation across workers.
# This avoids redundant Supabase Auth round-trips when scaling.

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def get_cached_token(token: str) -> Optional[Any]:
    """Retrieve user object from database cache if valid and not expired."""
    if not token:
        return None
    key = _hash_token(token)
    cache_key = f"auth_token:{key}"
    
    # Try Redis first
    try:
        from backend.core.redis import get_redis_client
        redis_client = get_redis_client()
        cached_data = await redis_client.get(cache_key)
        if cached_data:
            import json
            return json.loads(cached_data)
    except Exception as e:
        logger.warning("Redis cache read failed for token: %s", e)
        
    # Fallback to PostgreSQL
    return await get_cache(cache_key)


async def store_cached_token(token: str, user: Any) -> None:
    """Store user data in database cache with a 45s TTL."""
    if not token:
        return
    key = _hash_token(token)
    cache_key = f"auth_token:{key}"
    
    # Extract serializable data from Supabase User object
    user_data = user
    if hasattr(user, "dict"):
        user_data = user.dict()
    elif hasattr(user, "__dict__"):
        # Filter out non-serializable or private internal state if necessary
        user_data = {k: v for k, v in user.__dict__.items() if not k.startswith("_")}

    # Try writing to Redis
    try:
        from backend.core.redis import get_redis_client
        redis_client = get_redis_client()
        import json
        safe_data = _to_json_safe(user_data)
        await redis_client.setex(cache_key, 45, json.dumps(safe_data))
    except Exception as e:
        logger.warning("Redis cache write failed for token: %s", e)

    await set_cache(cache_key, user_data, ttl_seconds=45)


async def invalidate_cached_token(token: str) -> None:
    """Remove a token from the shared database cache immediately.

    Called on logout so a sign-out takes effect within the current 45s TTL
    window rather than waiting for natural expiry.  Without this, a
    logged-out user's cached session would remain valid for up to 45s —
    enough time for a token replay attack.
    """
    if not token:
        return
    key = _hash_token(token)
    cache_key = f"auth_token:{key}"
    blocklist_key = f"blocklist:{key}"
    
    # Redis: blocklist the token and delete the cache entry
    try:
        from backend.core.redis import get_redis_client
        redis_client = get_redis_client()
        await redis_client.setex(blocklist_key, 45, "1")
        await redis_client.delete(cache_key)
    except Exception as e:
        logger.warning("Redis token invalidation failed: %s", e)

    # Delete from PostgreSQL
    try:
        if db_pool:
            async with db_pool.acquire() as conn:
                await conn.execute(
                    "DELETE FROM public.backend_cache WHERE cache_key = $1",
                    cache_key
                )
        else:
            def _sync_delete():
                supabase_admin.table("backend_cache").delete().eq("cache_key", cache_key).execute()
            await run_in_threadpool(_sync_delete)
    except Exception as e:
        logger.warning("Failed to invalidate token cache in PG: %s", e)

async def is_token_blocklisted(token: str) -> bool:
    """Check if a token has been blocklisted in Redis after logout."""
    if not token:
        return False
    key = _hash_token(token)
    try:
        from backend.core.redis import get_redis_client
        redis_client = get_redis_client()
        if await redis_client.get(f"blocklist:{key}"):
            return True
    except Exception as e:
        logger.warning("Redis blocklist check failed: %s", e)
    return False


async def purge_expired_backend_cache() -> int:
    """Delete all expired rows from ``backend_cache`` via the DB function.

    Returns the number of rows deleted.  Calls the ``cleanup_backend_cache``
    PostgreSQL SECURITY DEFINER function (migration 20260506000003).
    Safe to call on-demand or via pg_cron nightly.
    """
    try:
        res = supabase_admin.rpc("cleanup_backend_cache").execute()
        deleted = res.data or 0
        logger.info("Purged %d expired backend_cache rows", deleted)
        return int(deleted)
    except Exception as e:
        logger.warning("backend_cache purge failed (non-fatal): %s", e)
        return 0


def compute_pdf_hash(content: bytes) -> str:
    """Computes a SHA-256 hash of the PDF content for caching."""
    return hashlib.sha256(content).hexdigest()


def _scoped_cache_key(pdf_hash: str, parsing_mode: str = "ai") -> str:
    """Namespace a pdf_hash by parsing_mode.

    The AI and on-demand pipelines emit different slide payloads (the
    on-demand path skips LLM-generated titles/summaries/quizzes), so a
    cache row written under one mode must never satisfy a lookup from
    the other. We solve this by prefixing the key for non-default modes
    rather than altering the table schema. The default 'ai' mode keeps
    the bare hash so existing cache rows continue to satisfy lookups
    without a one-off rewrite.
    """
    if not pdf_hash:
        return pdf_hash
    if parsing_mode == "ai" or not parsing_mode:
        return pdf_hash
    return f"{parsing_mode}:{pdf_hash}"


async def get_cached_parse(pdf_hash: str, parsing_mode: str = "ai") -> Optional[Dict[str, Any]]:
    """Retrieve full parse result from database using SUPABASE_ADMIN."""
    key = _scoped_cache_key(pdf_hash, parsing_mode)
    try:
        # Use supabase_admin for background caching to bypass RLS if necessary.
        # Offloaded: this runs in the async upload request path before every
        # parse, and the Supabase client is synchronous.
        res = await run_in_threadpool(
            lambda: supabase_admin.table("pdf_parse_cache").select("result").eq("pdf_hash", key).execute()
        )
        if res.data:
            return res.data[0]["result"]
    except Exception as e:
        logger.error("Failed to get cached parse: %s", e)
    return None


async def store_cached_parse(pdf_hash: str, data: Dict[str, Any], parsing_mode: str = "ai") -> None:
    """Store full parse result in database."""
    key = _scoped_cache_key(pdf_hash, parsing_mode)
    try:
        payload = {"pdf_hash": key, "result": data, "created_at": "now()"}
        supabase_admin.table("pdf_parse_cache").upsert(payload, on_conflict="pdf_hash").execute()
    except Exception as e:
        logger.error("Failed to store cached parse: %s", e)


async def get_cached_parse_meta(pdf_hash: str) -> Optional[Dict[str, Any]]:
    """Lightweight existence check for `pdf_parse_cache`.

    Returns `{parsed_at: <iso-ts-or-None>}` when a cache row exists for
    `pdf_hash`, or `None` when no row exists.  Used by the
    `/api/upload/check-parse-cache` endpoint so the upload UI can decide
    whether to prompt "use saved parse vs. re-parse" instead of silently
    serving the stale cached result.

    Selects only `created_at` so we don't transfer the heavy `result`
    JSONB blob on every upload — the full payload is fetched later (only
    if the user picks "use saved parse") via the regular cache hit path.
    """
    try:
        res = (
            supabase_admin.table("pdf_parse_cache")
            .select("created_at")
            .eq("pdf_hash", pdf_hash)
            .execute()
        )
        if res.data:
            return {"parsed_at": res.data[0].get("created_at")}
    except Exception as e:
        logger.error("Failed to get cached parse meta: %s", e)
    return None


# --- Blueprint Cache (PostgreSQL-backed) ---
#
# Keying strategy: (pdf_hash, version).
# Each distinct BLUEPRINT_VERSION gets its own row — bumping the version
# constant in planner_service.py generates a fresh blueprint (cache miss)
# without destroying the previous version's row.  Old-version rows are
# cleaned up by purge_old_blueprint_versions() below.

async def get_cached_blueprint(pdf_hash: str, version: int = 1) -> Optional[Dict[str, Any]]:
    """Retrieve blueprint from Supabase if (pdf_hash, version) matches.

    Returns ``None`` on a cache miss so the caller knows to regenerate.
    """
    try:
        res = (
            supabase_admin.table("lecture_blueprints")
            .select("blueprint_json")
            .eq("pdf_hash", pdf_hash)
            .eq("version", version)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0]["blueprint_json"]
    except Exception as e:
        logger.error("Failed to get cached blueprint: %s", e)
    return None


async def store_cached_blueprint(
    pdf_hash: str,
    blueprint: Dict[str, Any],
    version: int = 1,
) -> None:
    """Upsert blueprint keyed by (pdf_hash, version).

    After migration 20260506000002 the unique constraint covers both
    columns, so different versions of the same PDF each get their own
    row.  The on_conflict target must match that composite constraint.
    """
    try:
        data = {
            "pdf_hash": pdf_hash,
            "blueprint_json": blueprint,
            "version": version,
            "created_at": "now()",
        }
        # on_conflict MUST reference the composite unique constraint
        # (pdf_hash, version) — NOT just pdf_hash.  Using only pdf_hash
        # would overwrite a version-1 row when storing version-2, losing
        # the old blueprint and defeating the versioned keying strategy.
        supabase_admin.table("lecture_blueprints").upsert(
            data, on_conflict="pdf_hash,version"
        ).execute()
    except Exception as e:
        logger.error("Failed to store blueprint: %s", e)


async def purge_old_blueprint_versions(keep_version: int) -> int:
    """Delete blueprint rows whose version is older than ``keep_version``.

    Calls the ``cleanup_old_blueprint_versions`` PostgreSQL SECURITY
    DEFINER function (migration 20260506000002).  Safe to call any time;
    rows for the active version are never touched.

    Example: after bumping BLUEPRINT_VERSION from 1 to 2 and running the
    new pipeline, call ``purge_old_blueprint_versions(keep_version=2)``
    to remove all version-1 rows across every pdf_hash.
    """
    try:
        res = supabase_admin.rpc(
            "cleanup_old_blueprint_versions", {"keep_version": keep_version}
        ).execute()
        deleted = res.data or 0
        logger.info(
            "Purged %d blueprint rows older than version %d", deleted, keep_version
        )
        return int(deleted)
    except Exception as e:
        logger.warning("Blueprint version purge failed (non-fatal): %s", e)
        return 0


# --- pgvector Semantic Cache ---

# NOTE: the old unscoped get_similar_slides() (called match_slides directly,
# then relied on a Python post-filter in retrieval.py) was deleted here —
# Roadmap P1-4 replaced its only caller with get_similar_slides_by_lecture()
# below, which pushes the lecture_id/pdf_hash scope into SQL instead. The
# match_slides RPC itself is left in place (P0-3's canonical function,
# tested directly in backend/tests/db/test_slide_embeddings_migration.py) —
# only this now-dead Python wrapper was removed.

async def get_similar_slides_by_lecture(
    embedding: List[float],
    lecture_id: Optional[str],
    pdf_hash: Optional[str],
    limit: int = 5,
    threshold: float = 0.65,
) -> List[Dict[str, Any]]:
    """Single-lecture-scoped ANN search via `match_slides_by_lecture` (Roadmap P1-4).

    Unlike the old `get_similar_slides` + Python post-filter path, the
    lecture_id/pdf_hash scope is applied in SQL, so a relevant slide in the
    target lecture is never dropped because a global candidate window
    filled up with other lectures' slides first (the same class of bug
    `get_similar_slides_scoped` already fixed for the course-wide path).
    """
    if not lecture_id and not pdf_hash:
        return []
    try:
        res = await run_in_threadpool(
            lambda: supabase_admin.rpc("match_slides_by_lecture", {
                "query_embedding": embedding,
                "p_lecture_id": lecture_id,
                "p_pdf_hash": pdf_hash,
                "match_threshold": threshold,
                "match_count": limit,
            }).execute()
        )
        return res.data or []
    except Exception as e:
        logger.error("Failed to get lecture-scoped similar slides: %s", e)
        return []


async def get_similar_slides_scoped(
    embedding: List[float],
    course_ids: List[str],
    limit: int = 8,
    threshold: float = 0.6,
) -> List[Dict[str, Any]]:
    """Course-scoped ANN search via the `match_slides_scoped` RPC.

    Unlike `get_similar_slides`, the course filter is applied in SQL (not a
    Python post-filter over a global candidate window) so results from an
    enrolled course are never dropped because the ANN window filled up with
    other courses' slides first.
    """
    if not course_ids:
        return []
    try:
        res = await run_in_threadpool(
            lambda: supabase_admin.rpc("match_slides_scoped", {
                "query_embedding": embedding,
                "scoped_course_ids": course_ids,
                "match_threshold": threshold,
                "match_count": limit,
            }).execute()
        )
        return res.data or []
    except Exception as e:
        logger.error("Failed to get scoped similar slides: %s", e)
        return []


async def search_slides_keyword_scoped(
    query: str, course_ids: List[str], limit: int = 8
) -> List[Dict[str, Any]]:
    """Postgres full-text fallback via `search_slides_keyword`, same course scope."""
    if not course_ids or not query.strip():
        return []
    try:
        res = await run_in_threadpool(
            lambda: supabase_admin.rpc("search_slides_keyword", {
                "search_query": query,
                "scoped_course_ids": course_ids,
                "match_count": limit,
            }).execute()
        )
        return res.data or []
    except Exception as e:
        logger.error("Failed keyword slide search: %s", e)
        return []


async def store_slide_embedding(
    lecture_id: Optional[str],
    slide_index: int,
    embedding: Optional[List[float]],
    metadata: Dict[str, Any],
    content_hash: str,
    pdf_hash: Optional[str] = None,
    pipeline_version: str = "1",
) -> bool:
    """Store slide embedding and metadata in Supabase.

    Idempotent on (pdf_hash, slide_index, pipeline_version): if a row already
    exists for that key it is replaced.  The `slide_embeddings` table has no
    unique constraint on this triple yet, so we emulate upsert with a
    delete-then-insert.

    Returns True on a successful insert, False if the embedding was missing
    or the insert failed (failures are still logged here so existing
    fire-and-forget callers can keep ignoring the return value).
    """
    if embedding is None:
        return False

    try:
        if pdf_hash:
            try:
                supabase_admin.table("slide_embeddings") \
                    .delete() \
                    .eq("pdf_hash", pdf_hash) \
                    .eq("slide_index", slide_index) \
                    .eq("pipeline_version", pipeline_version) \
                    .execute()
            except Exception as e:
                # Pre-delete failures are non-fatal; the insert below may
                # produce a duplicate row but that's strictly better than
                # losing the embedding entirely.
                logger.warning("Pre-insert delete failed for slide %d: %s", slide_index, e)

        data = {
            "lecture_id": lecture_id,
            "pdf_hash": pdf_hash,
            "slide_index": slide_index,
            "embedding": embedding,
            "metadata": metadata,
            "content_hash": content_hash,
            "pipeline_version": pipeline_version,
        }
        supabase_admin.table("slide_embeddings").insert(data).execute()
        return True
    except Exception as e:
        logger.error("Failed to store slide embedding: %s", e)
        return False


async def attach_lecture_id_to_embeddings(
    pdf_hash: str, lecture_id: str
) -> int:
    """Backfill `lecture_id` on all `slide_embeddings` rows for a given PDF.

    Embeddings are written during parsing keyed by `pdf_hash` only — the
    lecture row may not exist yet.  Once the frontend persists the lecture,
    this helper attaches the lecture_id so retrieval can scope by lecture.
    Returns the number of rows updated.
    """
    if not pdf_hash or not lecture_id:
        return 0
    try:
        res = (
            supabase_admin.table("slide_embeddings")
            .update({"lecture_id": lecture_id})
            .eq("pdf_hash", pdf_hash)
            .execute()
        )
        return len(res.data or [])
    except Exception as e:
        logger.error(
            "Failed to attach lecture_id %s to pdf_hash %s: %s",
            lecture_id, pdf_hash, e,
        )
        return 0


# Checkpoint rows are only useful during the resume window: a professor is
# unlikely to retry a failed upload more than 7 days later, and holding
# them indefinitely wastes storage. Bump this down for faster cleanup or
# up if your professors need longer retry windows.
_CHECKPOINT_TTL_DAYS = 7


async def store_slide_parse_result(
    pdf_hash: str,
    slide_index: int,
    pipeline_version: str,
    slide_data: Dict[str, Any],
) -> None:
    """
    Upsert a single slide's full parse output with a 7-day TTL.

    Used for checkpoint/resume: if a pipeline run times out, the next run
    can skip already-stored slides by querying get_cached_slide_results().
    Rows older than ``_CHECKPOINT_TTL_DAYS`` are considered stale and are
    excluded from reads; the ``purge_expired_slide_checkpoints`` helper
    (or the ``cleanup_slide_parse_cache`` DB function) removes them.
    """
    try:
        expires_at = (
            datetime.utcnow() + timedelta(days=_CHECKPOINT_TTL_DAYS)
        ).isoformat()
        payload = {
            "pdf_hash": pdf_hash,
            "slide_index": slide_index,
            "pipeline_version": pipeline_version,
            "slide_data": slide_data,
            "expires_at": expires_at,
        }
        supabase_admin.table("slide_parse_cache").upsert(
            payload, on_conflict="pdf_hash,slide_index,pipeline_version"
        ).execute()
    except Exception as e:
        logger.error("Failed to store slide parse result (slide %d): %s", slide_index, e)


async def record_pipeline_run(
    pdf_hash: str,
    pipeline_version: str,
    started_at: str,
    finished_at: str,
    totals: Dict[str, Any],
    fallbacks: Dict[str, Any],
) -> None:
    """Insert a single ``pipeline_run_metrics`` row.

    Called fire-and-forget at deck-finalize time so a telemetry write
    never blocks the parse stream.  Errors are swallowed (logged) — the
    diagnostics endpoint degrades gracefully when the row is absent.
    """
    if not pdf_hash:
        return
    try:
        payload = {
            "pdf_hash": pdf_hash,
            "pipeline_version": pipeline_version,
            "started_at": started_at,
            "finished_at": finished_at,
            "totals": totals or {},
            "fallbacks": fallbacks or {},
        }
        supabase_admin.table("pipeline_run_metrics").insert(payload).execute()
    except Exception as e:
        logger.warning("pipeline_run_metrics insert failed (non-fatal): %s", e)


async def get_pipeline_run(
    pdf_hash: str,
    pipeline_version: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Most recent ``pipeline_run_metrics`` row for a pdf_hash.

    When ``pipeline_version`` is provided the lookup is filtered to that
    version; otherwise the latest row across all versions is returned.
    """
    if not pdf_hash:
        return None
    try:
        q = supabase_admin.table("pipeline_run_metrics").select("*").eq("pdf_hash", pdf_hash)
        if pipeline_version:
            q = q.eq("pipeline_version", pipeline_version)
        res = q.order("started_at", desc=True).limit(1).execute()
        if res.data:
            return res.data[0]
    except Exception as e:
        logger.warning("pipeline_run_metrics lookup failed: %s", e)
    return None


async def get_cached_slide_results(
    pdf_hash: str,
    pipeline_version: str,
) -> Dict[int, Dict[str, Any]]:
    """
    Returns {slide_index → slide_data} for all non-expired slides cached at
    the given pipeline_version.  Used by file_parse_service to skip
    already-processed slides when resuming after a timeout.

    Expired rows (``expires_at < NOW()``) are silently excluded so stale
    checkpoints never surface as valid results after their TTL window.
    """
    try:
        now = datetime.utcnow().isoformat()
        res = (
            supabase_admin.table("slide_parse_cache")
            .select("slide_index,slide_data")
            .eq("pdf_hash", pdf_hash)
            .eq("pipeline_version", pipeline_version)
            # Exclude expired rows. Rows without expires_at (pre-migration
            # legacy rows) are treated as non-expired via the OR clause so
            # existing checkpoints keep working until the migration lands.
            .or_(f"expires_at.gt.{now},expires_at.is.null")
            .execute()
        )
        return {row["slide_index"]: row["slide_data"] for row in (res.data or [])}
    except Exception as e:
        logger.warning("Checkpoint lookup failed (non-fatal): %s", e)
        return {}


async def purge_expired_slide_checkpoints() -> int:
    """Delete all expired ``slide_parse_cache`` rows via the DB helper function.

    Returns the number of rows deleted.  Calls the ``cleanup_slide_parse_cache``
    PostgreSQL function (created by migration 20260506000001) which runs as
    SECURITY DEFINER under the table owner — no RLS friction, one round-trip.

    This can be called:
    - From ``POST /api/upload/cleanup-cache`` (admin endpoint).
    - Via a pg_cron schedule: ``SELECT cleanup_slide_parse_cache();`` nightly.
    - Manually via the Supabase SQL editor.
    """
    try:
        res = supabase_admin.rpc("cleanup_slide_parse_cache").execute()
        deleted = (res.data or 0)
        logger.info("Purged %d expired slide_parse_cache rows", deleted)
        return int(deleted)
    except Exception as e:
        logger.warning("slide_parse_cache purge failed (non-fatal): %s", e)
        return 0


# --- Generic Backend Cache (PostgreSQL-backed) ---

async def get_cache(key: str) -> Optional[Any]:
    """Retrieve data from generic backend_cache if not expired."""
    try:
        if db_pool:
            async with db_pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT data FROM public.backend_cache WHERE cache_key = $1 AND expires_at > NOW()",
                    key
                )
                if row:
                    import json
                    data = row["data"]
                    return json.loads(data) if isinstance(data, str) else data
        else:
            def _sync_get():
                now = datetime.utcnow().isoformat()
                res = supabase_admin.table("backend_cache") \
                    .select("data") \
                    .eq("cache_key", key) \
                    .gt("expires_at", now) \
                    .execute()
                return res.data[0]["data"] if res.data else None
            return await run_in_threadpool(_sync_get)
    except Exception as e:
        logger.error("Cache hit error for key %s: %s", key, e)
    return None


async def set_cache(key: str, data: Any, ttl_seconds: int = 300) -> None:
    """Store data in generic backend_cache with a TTL.

    `data` is coerced through `_to_json_safe` first so datetime/UUID/Decimal/Enum
    values (typical on Supabase `User` objects) don't crash the postgrest JSON
    encoder downstream.
    """
    try:
        try:
            safe_data = _to_json_safe(data)
        except TypeError as enc_exc:
            logger.error("Cache payload not JSON-serializable for key %s: %s", key, enc_exc)
            return

        from datetime import timezone
        expires_at_dt = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)

        if db_pool:
            async with db_pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO public.backend_cache (cache_key, data, expires_at, created_at)
                    VALUES ($1, $2, $3, NOW())
                    ON CONFLICT (cache_key) DO UPDATE
                    SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at, created_at = NOW()
                    """,
                    key,
                    json.dumps(safe_data),
                    expires_at_dt
                )
        else:
            expires_at = expires_at_dt.isoformat()
            payload = {
                "cache_key": key,
                "data": safe_data,
                "expires_at": expires_at
            }
            def _sync_set():
                supabase_admin.table("backend_cache").upsert(payload, on_conflict="cache_key").execute()
            await run_in_threadpool(_sync_set)
    except Exception as e:
        logger.error("Cache store error for key %s: %s", key, e)
