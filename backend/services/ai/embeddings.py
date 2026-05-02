import logging
import asyncio
from typing import List
from .orchestrator import gemini_client

logger = logging.getLogger(__name__)

# `text-embedding-004` was deprecated and now 404s on the v1 endpoint.
# `gemini-embedding-001` is the current GA Google AI embedding model and
# supports configurable output dimensions; we request 768 dims to match the
# existing `slide_embeddings.embedding vector(768)` column shape so we don't
# need a schema migration.
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIMS = 768


def _sync_generate_embeddings(text: str) -> List[float]:
    """Synchronous implementation of Gemini embedding generation.

    Returns a 768-zero vector ONLY when the Gemini client is not configured
    (no GEMINI_API_KEY → `gemini_client is None`). Any other failure — bad
    model name, network error, malformed response — is re-raised so the
    caller sees the real failure instead of silently writing useless
    all-zero vectors into pgvector and poisoning semantic-cache + RAG.
    """
    if not gemini_client:
        return [0.0] * EMBEDDING_DIMS

    # First try with explicit output_dimensionality; older SDKs don't ship
    # EmbedContentConfig and will raise ImportError/TypeError — for *those*
    # specific cases we fall back to the model's default dim and trim/pad.
    res = None
    try:
        from google.genai import types as _gtypes
        res = gemini_client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=text,
            config=_gtypes.EmbedContentConfig(output_dimensionality=EMBEDDING_DIMS),
        )
    except (ImportError, AttributeError, TypeError) as sdk_compat:
        logger.debug(
            "google-genai SDK lacks EmbedContentConfig (%s); retrying without config",
            sdk_compat,
        )
        res = gemini_client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=text,
        )
    # Note: any *other* exception (RuntimeError, RPC error, 4xx/5xx)
    # propagates — we want the caller to know.

    values = list(res.embeddings[0].values)
    if len(values) > EMBEDDING_DIMS:
        values = values[:EMBEDDING_DIMS]
    elif len(values) < EMBEDDING_DIMS:
        values = values + [0.0] * (EMBEDDING_DIMS - len(values))
    return values


async def generate_embeddings(text: str) -> List[float]:
    """Asynchronous wrapper for embedding generation."""
    if not text.strip():
        return [0.0] * EMBEDDING_DIMS
    return await asyncio.to_thread(_sync_generate_embeddings, text)
