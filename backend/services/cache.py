import hashlib
import logging
import time
from typing import Any, Optional, List, Dict, Tuple
from backend.core.database import supabase_admin

logger = logging.getLogger(__name__)

# Token validation cache: avoids a Supabase round-trip on every API request.
_token_cache: Dict[str, Tuple[Any, float]] = {}
_TOKEN_TTL = 45.0  # seconds


def get_cached_token(token: str) -> Optional[Any]:
    """Retrieve user object from memory cache if token is valid and not expired."""
    entry = _token_cache.get(token)
    if entry and time.monotonic() < entry[1]:
        return entry[0]
    return None


def store_cached_token(token: str, user: Any) -> None:
    """Store user object in memory cache with a TTL."""
    _token_cache[token] = (user, time.monotonic() + _TOKEN_TTL)


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
    pdf_hash: Optional[str] = None
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
            "content_hash": content_hash
        }
        supabase_admin.table("slide_embeddings").insert(data).execute()
    except Exception as e:
        logger.error("Failed to store slide embedding: %s", e)