import datetime
import logging
import asyncio
import os
import time
from typing import Any, List, Optional, Tuple
from .orchestrator import gemini_client, openai_client, OPENAI_ONLY

logger = logging.getLogger(__name__)

# `text-embedding-004` was deprecated and now 404s on the v1 endpoint.
# `gemini-embedding-001` is the current GA Google AI embedding model and
# supports configurable output dimensions; we request 768 dims to match the
# existing `slide_embeddings.embedding vector(768)` column shape so we don't
# need a schema migration.
# In AI_PROVIDER_MODE=openai_only the same 768-dim columns are filled by
# OpenAI's text-embedding-3-small, which takes a `dimensions` parameter, so no
# schema change is needed. The two models' vectors are NOT comparable: after
# switching modes every stored vector must be re-embedded
# (backend/scripts/backfill_slide_embeddings.py --force).
GEMINI_EMBEDDING_MODEL = "gemini-embedding-001"
OPENAI_EMBEDDING_MODEL = os.environ.get("OPENAI_EMBED_MODEL") or "text-embedding-3-small"
# Confirmed live (768-dim response) — the freshness test holds it to 45 days.
OPENAI_EMBEDDING_MODEL_VERIFIED_ON = datetime.date(2026, 10, 11)
EMBEDDING_MODEL = OPENAI_EMBEDDING_MODEL if OPENAI_ONLY else GEMINI_EMBEDDING_MODEL
# Same freshness rule as orchestrator.ProviderConfig.verified_on
# (tests/unit/test_provider_pin_freshness.py).
EMBEDDING_MODEL_VERIFIED_ON = datetime.date(2026, 10, 10)
EMBEDDING_DIMS = 768


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


def _sync_openai_embedding(text: str) -> Tuple[List[float], Any]:
    """OpenAI embedding at EMBEDDING_DIMS; returns ``(values, usage)``."""
    from .cost import LLMUsage
    if not openai_client:
        raise EmbeddingUnavailableError(
            "OPENAI_API_KEY is not configured, so no embedding can be produced."
        )
    res = openai_client.embeddings.create(
        model=OPENAI_EMBEDDING_MODEL, input=text, dimensions=EMBEDDING_DIMS,
    )
    if not res or not res.data:
        raise RuntimeError(
            f"generate_embeddings: OpenAI returned an empty embeddings response "
            f"for model {OPENAI_EMBEDDING_MODEL!r}."
        )
    values = list(res.data[0].embedding)
    if values and all(v == 0.0 for v in values):
        raise RuntimeError(
            f"generate_embeddings: received an all-zero vector from {OPENAI_EMBEDDING_MODEL!r}."
        )
    u = getattr(res, "usage", None)
    usage = LLMUsage(prompt_tokens=getattr(u, "prompt_tokens", 0) or 0, completion_tokens=0) if u else None
    return values, usage


def _sync_generate_embeddings(text: str) -> List[float]:
    """Synchronous implementation of Gemini embedding generation.

    Never returns a zero vector. An unconfigured client raises
    `EmbeddingUnavailableError`; every other failure — bad model name,
    network error, malformed response — propagates as-is so the caller sees
    the real fault instead of silently writing useless all-zero vectors into
    pgvector and poisoning semantic-cache + RAG.
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
            model=GEMINI_EMBEDDING_MODEL,
            contents=text,
            config=_gtypes.EmbedContentConfig(output_dimensionality=EMBEDDING_DIMS),
        )
    except (ImportError, AttributeError, TypeError) as sdk_compat:
        logger.debug(
            "google-genai SDK lacks EmbedContentConfig (%s); retrying without config",
            sdk_compat,
        )
        res = gemini_client.models.embed_content(
            model=GEMINI_EMBEDDING_MODEL,
            contents=text,
        )
    # Note: any *other* exception (RuntimeError, RPC error, 4xx/5xx)
    # propagates — we want the caller to know.

    if not res or not res.embeddings:
        raise RuntimeError(
            f"generate_embeddings: Gemini returned an empty embeddings response "
            f"for model {GEMINI_EMBEDDING_MODEL!r}. Check API key, quota, and model availability."
        )

    values = list(res.embeddings[0].values)

    # Guard: all-zero vector means something went wrong server-side (e.g. the
    # model returned an empty float array that was then padded).  Raise so the
    # caller knows to retry rather than persist a useless zero vector.
    if values and all(v == 0.0 for v in values):
        raise RuntimeError(
            f"generate_embeddings: received an all-zero vector from {GEMINI_EMBEDDING_MODEL!r}. "
            "This usually means the API returned an empty embedding. Retrying may help."
        )

    if len(values) > EMBEDDING_DIMS:
        values = values[:EMBEDDING_DIMS]
    elif len(values) < EMBEDDING_DIMS:
        values = values + [0.0] * (EMBEDDING_DIMS - len(values))
    return values


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
    if OPENAI_ONLY:
        from .orchestrator import _rotator
        # The fleet's daily OpenAI ceiling binds embeddings too; over it, the
        # caller's usual "no embedding" path (queue for retry) applies.
        await _rotator.refresh_from_redis(["openai"])
        if not _rotator.available(["openai"]):
            raise EmbeddingUnavailableError(
                "The daily OpenAI cost ceiling is reached; embedding deferred."
            )
        started = time.perf_counter()
        values, usage = await asyncio.to_thread(_sync_openai_embedding, text)
        from .orchestrator import _account_for_call
        await _account_for_call(
            "openai", OPENAI_EMBEDDING_MODEL, usage,
            user_id=None, course_id=None, feature="embedding",
            duration_seconds=time.perf_counter() - started,
        )
        return values
    started = time.perf_counter()
    values = await asyncio.to_thread(_sync_generate_embeddings, text)
    # Same accounting tail as the OpenAI path: without it every embedding in
    # `multi` mode was invisible to llm_calls, metrics and the parse receipt.
    from .orchestrator import _account_for_call
    await _account_for_call(
        "gemini", GEMINI_EMBEDDING_MODEL, None,
        user_id=None, course_id=None, feature="embedding",
        duration_seconds=time.perf_counter() - started,
    )
    return values


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

