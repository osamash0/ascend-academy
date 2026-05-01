import hashlib
import logging
import time
from typing import Any, Optional, List
from backend.core.database import supabase

logger = logging.getLogger(__name__)

# Token validation cache: avoids a Supabase round-trip on every API request.
_token_cache: dict[str, tuple[Any, float]] = {}
_TOKEN_TTL = 45.0  # seconds


def get_cached_token(token: str) -> Any:
    entry = _token_cache.get(token)
    if entry and time.monotonic() < entry[1]:
        return entry[0]
    return None


def store_cached_token(token: str, user: Any) -> None:
    _token_cache[token] = (user, time.monotonic() + _TOKEN_TTL)


def compute_pdf_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


async def get_cached_parse(pdf_hash: str) -> Optional[dict]:
    """Retrieve full parse result from database."""
    try:
        res = supabase.table("pdf_parse_cache").select("result").eq("pdf_hash", pdf_hash).execute()
        if res.data:
            return res.data[0]["result"]
    except Exception as e:
        logger.error("Failed to get cached parse: %s", e)
    return None


async def store_cached_parse(pdf_hash: str, data: dict) -> None:
    """Store full parse result in database."""
    try:
        payload = {"pdf_hash": pdf_hash, "result": data, "created_at": "now()"}
        supabase.table("pdf_parse_cache").upsert(payload, on_conflict="pdf_hash").execute()
    except Exception as e:
        logger.error("Failed to store cached parse: %s", e)


# --- Blueprint Cache (PostgreSQL-backed) ---

async def get_cached_blueprint(pdf_hash: str, version: int = 1) -> Optional[dict]:
    """Retrieve blueprint from Supabase if hash and version match."""
    try:
        res = supabase.table("lecture_blueprints").select("blueprint_json").eq("pdf_hash", pdf_hash).eq("version", version).execute()
        if res.data:
            return res.data[0]["blueprint_json"]
    except Exception as e:
        logger.error("Failed to get cached blueprint: %s", e)
    return None


async def store_cached_blueprint(pdf_hash: str, blueprint: dict, version: int = 1) -> None:
    """Upsert blueprint to Supabase."""
    try:
        data = {
            "pdf_hash": pdf_hash,
            "blueprint_json": blueprint,
            "version": version,
            "created_at": "now()"
        }
        supabase.table("lecture_blueprints").upsert(data, on_conflict="pdf_hash").execute()
    except Exception as e:
        logger.error("Failed to store blueprint: %s", e)


# --- pgvector Semantic Cache ---

async def get_similar_slides(embedding: list[float], limit: int = 5, threshold: float = 0.8) -> list[dict]:
    """
    Search for similar slides in Supabase using cosine similarity.
    Requires the match_slides RPC function in PostgreSQL.
    """
    try:
        res = supabase.rpc("match_slides", {
            "query_embedding": embedding,
            "match_threshold": threshold,
            "match_count": limit
        }).execute()
        return res.data or []
    except Exception as e:
        logger.error("Failed to get similar slides: %s", e)
        return []


async def store_slide_embedding(lecture_id: Optional[str], slide_index: int, embedding: list[float], metadata: dict, content_hash: str, pdf_hash: Optional[str] = None) -> None:
    """Store slide embedding and metadata in Supabase."""
    try:
        data = {
            "lecture_id": lecture_id,
            "pdf_hash": pdf_hash,
            "slide_index": slide_index,
            "embedding": embedding,
            "metadata": metadata,
            "content_hash": content_hash
        }
        supabase.table("slide_embeddings").insert(data).execute()
    except Exception as e:
        logger.error("Failed to store slide embedding: %s", e)