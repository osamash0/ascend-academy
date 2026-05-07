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
        logger.warning(
            "generate_embeddings: GEMINI_API_KEY not set — returning zero vector. "
            "AI Tutor semantic search will be degraded until a key is configured."
        )
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

    if not res or not res.embeddings:
        raise RuntimeError(
            f"generate_embeddings: Gemini returned an empty embeddings response "
            f"for model {EMBEDDING_MODEL!r}. Check API key, quota, and model availability."
        )

    values = list(res.embeddings[0].values)

    # Guard: all-zero vector means something went wrong server-side (e.g. the
    # model returned an empty float array that was then padded).  Raise so the
    # caller knows to retry rather than persist a useless zero vector.
    if values and all(v == 0.0 for v in values):
        raise RuntimeError(
            f"generate_embeddings: received an all-zero vector from {EMBEDDING_MODEL!r}. "
            "This usually means the API returned an empty embedding. Retrying may help."
        )

    if len(values) > EMBEDDING_DIMS:
        values = values[:EMBEDDING_DIMS]
    elif len(values) < EMBEDDING_DIMS:
        values = values + [0.0] * (EMBEDDING_DIMS - len(values))
    return values


async def generate_embeddings(text: str) -> List[float]:
    """Asynchronous wrapper for embedding generation.

    Returns an empty list on failure so callers can decide whether to retry
    or skip embedding without crashing the parse pipeline.  The real error
    is logged inside ``_sync_generate_embeddings``.
    """
    if not text.strip():
        return [0.0] * EMBEDDING_DIMS
    try:
        return await asyncio.to_thread(_sync_generate_embeddings, text)
    except Exception as exc:
        logger.error(
            "generate_embeddings failed (slide will be stored without vector): %s", exc
        )
        return []


async def batch_generate_embeddings(
    texts: List[str], concurrency: int = 4,
) -> List[List[float]]:
    """Embed many strings, parallelized with a bounded semaphore.

    Returns one vector per input in input order. Failed slots become an
    empty list so callers can detect and skip them. Concurrency defaults
    to 4 — Gemini's embedding endpoint tolerates this comfortably and
    keeps us well under the 60 RPM free-tier ceiling.
    """
    sem = asyncio.Semaphore(concurrency)

    async def _one(t: str) -> List[float]:
        async with sem:
            return await generate_embeddings(t)

    return await asyncio.gather(*(_one(t) for t in texts))

