import hashlib
import logging
import time
from typing import Any, Optional, List, Dict, Tuple
from collections import OrderedDict
from threading import Lock

from backend.core.database import supabase_admin

logger = logging.getLogger(__name__)


# ── Token validation cache ───────────────────────────────────────────────────
# Bounded LRU+TTL cache. Keys are SHA-256 hashes of the bearer token (we
# never store the raw token). TTL kept short so revoked tokens stop working
# quickly after sign-out / password reset.
_TOKEN_TTL = 30.0          # seconds
_TOKEN_CACHE_MAX = 1024    # max distinct tokens cached
_token_cache: "OrderedDict[str, Tuple[Any, float]]" = OrderedDict()
_token_cache_lock = Lock()


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_cached_token(token: str) -> Optional[Any]:
    """Return cached user object if the token is still valid, else None."""
    if not token:
        return None
    key = _hash_token(token)
    now = time.monotonic()
    with _token_cache_lock:
        entry = _token_cache.get(key)
        if entry is None:
            return None
        user, expires_at = entry
        if now >= expires_at:
            _token_cache.pop(key, None)
            return None
        # Touch for LRU semantics
        _token_cache.move_to_end(key)
        return user


def store_cached_token(token: str, user: Any) -> None:
    """Cache the user object behind a hashed token key."""
    if not token:
        return
    key = _hash_token(token)
    with _token_cache_lock:
        _token_cache[key] = (user, time.monotonic() + _TOKEN_TTL)
        _token_cache.move_to_end(key)
        # Evict oldest entries to stay within bound
        while len(_token_cache) > _TOKEN_CACHE_MAX:
            _token_cache.popitem(last=False)


def invalidate_cached_token(token: str) -> None:
    """Remove a token from the cache (call on explicit sign-out)."""
    if not token:
        return
    key = _hash_token(token)
    with _token_cache_lock:
        _token_cache.pop(key, None)


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
) -> None:
    """Store slide embedding and metadata in Supabase."""
    if embedding is None:
        return

    try:
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
    except Exception as e:
        logger.error("Failed to store slide embedding: %s", e)


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
