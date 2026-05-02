import hashlib
import logging
import time
from datetime import datetime, timedelta
from typing import Any, Optional, List, Dict, Tuple
from collections import OrderedDict
from threading import Lock

from backend.core.database import supabase_admin

logger = logging.getLogger(__name__)


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

    await set_cache(cache_key, user_data, ttl_seconds=45)


async def invalidate_cached_token(token: str) -> None:
    """Remove a token from the shared database cache."""
    if not token:
        return
    key = _hash_token(token)
    cache_key = f"auth_token:{key}"
    try:
        supabase_admin.table("backend_cache").delete().eq("cache_key", cache_key).execute()
    except Exception as e:
        logger.warning("Failed to invalidate token cache: %s", e)


def compute_pdf_hash(content: bytes) -> str:
    """Computes a SHA-256 hash of the PDF content for caching."""
    return hashlib.sha256(content).hexdigest()


async def get_cached_parse(pdf_hash: str) -> Optional[Dict[str, Any]]:
    """Retrieve full parse result from database using SUPABASE_ADMIN."""
    try:
        # Use supabase_admin for background caching to bypass RLS if necessary
        res = supabase_admin.table("pdf_parse_cache").select("result").eq("pdf_hash", pdf_hash).execute()
        if res.data:
            return res.data[0]["result"]
    except Exception as e:
        logger.error("Failed to get cached parse: %s", e)
    return None


async def store_cached_parse(pdf_hash: str, data: Dict[str, Any]) -> None:
    """Store full parse result in database."""
    try:
        payload = {"pdf_hash": pdf_hash, "result": data, "created_at": "now()"}
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

async def get_cached_blueprint(pdf_hash: str, version: int = 1) -> Optional[Dict[str, Any]]:
    """Retrieve blueprint from Supabase if hash and version match."""
    try:
        res = supabase_admin.table("lecture_blueprints").select("blueprint_json").eq("pdf_hash", pdf_hash).eq("version", version).execute()
        if res.data:
            return res.data[0]["blueprint_json"]
    except Exception as e:
        logger.error("Failed to get cached blueprint: %s", e)
    return None


async def store_cached_blueprint(pdf_hash: str, blueprint: Dict[str, Any], version: int = 1) -> None:
    """Upsert blueprint to Supabase."""
    try:
        data = {
            "pdf_hash": pdf_hash,
            "blueprint_json": blueprint,
            "version": version,
            "created_at": "now()"
        }
        supabase_admin.table("lecture_blueprints").upsert(data, on_conflict="pdf_hash").execute()
    except Exception as e:
        logger.error("Failed to store blueprint: %s", e)


# --- pgvector Semantic Cache ---

async def get_similar_slides(embedding: List[float], limit: int = 5, threshold: float = 0.8) -> List[Dict[str, Any]]:
    """
    Search for similar slides in Supabase using cosine similarity.
    Requires the match_slides RPC function in PostgreSQL.
    """
    try:
        res = supabase_admin.rpc("match_slides", {
            "query_embedding": embedding,
            "match_threshold": threshold,
            "match_count": limit
        }).execute()
        return res.data or []
    except Exception as e:
        logger.error("Failed to get similar slides: %s", e)
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


# --- Per-slide parse cache (for checkpoint/resume) ---

async def store_slide_parse_result(
    pdf_hash: str,
    slide_index: int,
    pipeline_version: str,
    slide_data: Dict[str, Any],
) -> None:
    """
    Upsert a single slide's full parse output.
    Used for checkpoint/resume: if a pipeline run times out, the next run
    can skip already-stored slides by querying get_cached_slide_results().
    """
    try:
        payload = {
            "pdf_hash": pdf_hash,
            "slide_index": slide_index,
            "pipeline_version": pipeline_version,
            "slide_data": slide_data,
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
    Returns {slide_index → slide_data} for all slides cached at the given
    pipeline_version.  Used by file_parse_service to skip already-processed
    slides when resuming after a timeout.
    """
    try:
        res = (
            supabase_admin.table("slide_parse_cache")
            .select("slide_index,slide_data")
            .eq("pdf_hash", pdf_hash)
            .eq("pipeline_version", pipeline_version)
            .execute()
        )
        return {row["slide_index"]: row["slide_data"] for row in (res.data or [])}
    except Exception as e:
        logger.warning("Checkpoint lookup failed (non-fatal): %s", e)
        return {}


# --- Generic Backend Cache (PostgreSQL-backed) ---

async def get_cache(key: str) -> Optional[Any]:
    """Retrieve data from generic backend_cache if not expired."""
    try:
        # Use ISO format for timestamp comparison
        now = datetime.utcnow().isoformat()
        res = supabase_admin.table("backend_cache") \
            .select("data") \
            .eq("cache_key", key) \
            .gt("expires_at", now) \
            .execute()
        
        if res.data:
            return res.data[0]["data"]
    except Exception as e:
        logger.error("Cache hit error for key %s: %s", key, e)
    return None


async def set_cache(key: str, data: Any, ttl_seconds: int = 300) -> None:
    """Store data in generic backend_cache with a TTL."""
    try:
        expires_at = (datetime.utcnow() + timedelta(seconds=ttl_seconds)).isoformat()
        
        payload = {
            "cache_key": key,
            "data": data,
            "expires_at": expires_at
        }
        supabase_admin.table("backend_cache").upsert(payload, on_conflict="cache_key").execute()
    except Exception as e:
        logger.error("Cache store error for key %s: %s", key, e)
