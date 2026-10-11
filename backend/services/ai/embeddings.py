import datetime
import logging
import asyncio
from typing import List, Optional, Sequence, Tuple, Union
from .orchestrator import gemini_client

logger = logging.getLogger(__name__)

# `text-embedding-004` was deprecated and now 404s on the v1 endpoint.
# `gemini-embedding-001` is the current GA Google AI embedding model and
# supports configurable output dimensions; we request 768 dims to match the
# existing `slide_embeddings.embedding vector(768)` column shape so we don't
# need a schema migration.
EMBEDDING_MODEL = "gemini-embedding-001"
# Same freshness rule as orchestrator.ProviderConfig.verified_on
# (tests/unit/test_provider_pin_freshness.py).
EMBEDDING_MODEL_VERIFIED_ON = datetime.date(2026, 10, 10)
EMBEDDING_DIMS = 768
# Cache-key / threshold-provenance component: a similarity threshold, and any
# cached vector, is only valid for the model + dimensionality that made it.
EMBEDDING_MODEL_ID = f"{EMBEDDING_MODEL}@{EMBEDDING_DIMS}"
# Gemini's batchEmbedContents accepts at most 100 texts per request.
EMBED_BATCH_MAX = 100


class EmbeddingUnavailableError(RuntimeError):
    """No embedding could be produced (missing credentials, or empty input).

    Raised instead of returning a zero vector. A zero vector is not a
    harmlessly-useless row: pgvector's cosine distance against it is NaN, and
    Postgres treats `NaN > threshold` as TRUE, so it survives the very
    similarity filter that exists to drop irrelevant slides. It does sort
    last (the retrieval RPC orders by distance ascending, where NaN is
    largest), so it cannot displace a genuine match — but it fills leftover
    top-k slots whenever fewer slides clear the threshold than were
    requested, injecting a semantically unrelated slide into the tutor's
    grounding context precisely when the tutor should be reporting the topic
    as uncovered.

    Callers that must not fail (e.g. `_safe_embedding_task`) should catch
    this and queue the slide for retry, leaving no row behind — see
    backend/tests/db/test_zero_vector_retrieval_hazard.py, which pins both
    halves of that behaviour against a real Postgres.
    """


def _fit_dims(values: List[float]) -> List[float]:
    if len(values) > EMBEDDING_DIMS:
        return values[:EMBEDDING_DIMS]
    if len(values) < EMBEDDING_DIMS:
        return values + [0.0] * (EMBEDDING_DIMS - len(values))
    return values


def _sync_embed(contents: Union[str, List[str]]) -> Tuple[List[List[float]], Optional[int]]:
    """One embed_content request for one text (str) or several (list).

    Returns the vectors in input order plus the summed token count, or None
    when the response carries none (the Gemini Developer API reports no
    ``statistics``; Vertex does). Never returns a zero vector: an
    unconfigured client raises `EmbeddingUnavailableError`; every other
    failure (bad model name, network error, malformed or short response)
    propagates so the caller sees the real fault instead of silently writing
    useless all-zero vectors into pgvector and poisoning semantic-cache + RAG.
    """
    if not gemini_client:
        raise EmbeddingUnavailableError(
            "GEMINI_API_KEY is not configured, so no embedding can be produced. "
            "Refusing to return a zero vector: it would survive the retrieval "
            "similarity filter rather than simply being ignored."
        )

    # First try with explicit output_dimensionality; older SDKs don't ship
    # EmbedContentConfig and will raise ImportError/TypeError — for *those*
    # specific cases we fall back to the model's default dim and trim/pad.
    res = None
    try:
        from google.genai import types as _gtypes
        res = gemini_client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=contents,
            config=_gtypes.EmbedContentConfig(output_dimensionality=EMBEDDING_DIMS),
        )
    except (ImportError, AttributeError, TypeError) as sdk_compat:
        logger.debug(
            "google-genai SDK lacks EmbedContentConfig (%s); retrying without config",
            sdk_compat,
        )
        res = gemini_client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=contents,
        )
    # Note: any *other* exception (RuntimeError, RPC error, 4xx/5xx)
    # propagates — we want the caller to know.

    if not res or not res.embeddings:
        raise RuntimeError(
            f"generate_embeddings: Gemini returned an empty embeddings response "
            f"for model {EMBEDDING_MODEL!r}. Check API key, quota, and model availability."
        )
    expected = 1 if isinstance(contents, str) else len(contents)
    if len(res.embeddings) != expected:
        raise RuntimeError(
            f"generate_embeddings: Gemini returned {len(res.embeddings)} embeddings for {expected} texts"
        )

    vectors: List[List[float]] = []
    tokens = 0
    reported = True
    for emb in res.embeddings:
        values = list(emb.values)
        # Guard: all-zero vector means something went wrong server-side (e.g. the
        # model returned an empty float array that was then padded).  Raise so the
        # caller knows to retry rather than persist a useless zero vector.
        if values and all(v == 0.0 for v in values):
            raise RuntimeError(
                f"generate_embeddings: received an all-zero vector from {EMBEDDING_MODEL!r}. "
                "This usually means the API returned an empty embedding. Retrying may help."
            )
        vectors.append(_fit_dims(values))
        count = getattr(getattr(emb, "statistics", None), "token_count", None)
        if count is None:
            reported = False
        else:
            tokens += int(count)
    return vectors, (tokens if reported else None)


def _sync_generate_embeddings(text: str) -> List[float]:
    """Synchronous single-text embedding (kept for existing callers)."""
    return _sync_embed(text)[0][0]


async def generate_embeddings(text: str) -> List[float]:
    """Asynchronous wrapper for embedding generation.

    Propagates exceptions to the caller so they can be handled, logged,
    and queued for retries appropriately. Blank input raises rather than
    returning a zero vector — callers already skip empty slide text
    upstream (`_safe_embedding_task` returns early on falsy text), so this
    only closes the hole for future callers that forget to check.
    """
    if not text.strip():
        raise EmbeddingUnavailableError(
            "Refusing to embed blank text: the result would be a zero vector, "
            "which survives pgvector's similarity filter instead of being ignored."
        )
    return await asyncio.to_thread(_sync_generate_embeddings, text)


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
            try:
                return await generate_embeddings(t)
            except Exception as exc:
                logger.error("Batch generate_embeddings failed for text slot: %s", exc)
                return []

    return await asyncio.gather(*(_one(t) for t in texts))


async def generate_embeddings_batch(texts: Sequence[str]) -> List[List[float]]:
    """Embed many texts, EMBED_BATCH_MAX per request; vectors in input order.

    Unlike batch_generate_embeddings (one request per text, failures become
    []), this raises on any failure or count/dimension mismatch, so the
    semantic grounding eval fails loudly instead of scoring partial data.
    Empty input returns []. Not metered here (embedding metering lives with
    the OpenAI embedding path).
    """
    texts = list(texts)
    if not texts:
        return []
    if any(not t.strip() for t in texts):
        raise EmbeddingUnavailableError(
            "Refusing to embed blank text: the result would be a zero vector, "
            "which survives pgvector's similarity filter instead of being ignored."
        )
    out: List[List[float]] = []
    for start in range(0, len(texts), EMBED_BATCH_MAX):
        chunk = texts[start:start + EMBED_BATCH_MAX]
        vectors, _tokens = await asyncio.to_thread(_sync_embed, chunk)
        if len(vectors) != len(chunk) or any(len(v) != EMBEDDING_DIMS for v in vectors):
            raise RuntimeError(
                f"generate_embeddings_batch: got {len(vectors)} vectors for {len(chunk)} texts"
            )
        out.extend(vectors)
    return out
