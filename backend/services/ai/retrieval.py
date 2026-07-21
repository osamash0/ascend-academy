"""
Retrieval helpers for the grounded AI tutor.

Embeds a student question, queries `match_slides` (pgvector), filters the
results to slides belonging to the active lecture (by `lecture_id` or
`pdf_hash`), and enriches each match with the slide's actual content so the
prompt builder can stuff it directly into the model context.

The current slide is always included as the first entry, regardless of its
similarity to the question — it is the student's anchor and the tutor must
be able to reference it even when the rest of the lecture is more relevant.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from backend.core.database import supabase_admin
from backend.services.ai.embeddings import generate_embeddings
from backend.services.cache import (
    get_similar_slides_by_lecture,
    get_similar_slides_scoped,
    search_slides_keyword_scoped,
)

logger = logging.getLogger(__name__)

DEFAULT_K = 5
DEFAULT_THRESHOLD = 0.65
DEFAULT_COURSE_K = 6

# Tutor query-embedding cache (P3-2, docs/ROADMAP_10X_FOUNDATION.md §8).
# A student re-asking the same/near-identical question minutes apart (typo
# fix, re-read, retry after a refusal) shouldn't re-pay the embedding call.
# 10 minutes is long enough to absorb that same-session repetition without
# meaningfully risking a stale vector — the embedding model itself doesn't
# change within a session, so there is no correctness downside to reusing it
# a few minutes later, only a cost/latency win.
QUERY_EMBED_CACHE_TTL_SECONDS = 600


def _query_embed_cache_key(query: str) -> str:
    digest = hashlib.sha256(query.strip().encode("utf-8")).hexdigest()
    return f"query_embed:{digest}"


async def _get_cached_query_embedding(query: str) -> Optional[List[float]]:
    """Best-effort Redis lookup for a previously embedded query.

    Any Redis failure (not configured, connection error, bad payload) is
    swallowed and treated as a cache miss — the caller falls back to calling
    `generate_embeddings` normally, so a cache outage degrades to the
    pre-P3-2 behavior rather than breaking retrieval.
    """
    try:
        from backend.core.redis import get_redis_client
        redis_client = get_redis_client()
        cached = await redis_client.get(_query_embed_cache_key(query))
        if cached:
            return json.loads(cached)
    except Exception as e:
        logger.debug("Query-embedding cache read failed (will re-embed): %s", e)
    return None


async def _store_query_embedding(query: str, embedding: List[float]) -> None:
    try:
        from backend.core.redis import get_redis_client
        redis_client = get_redis_client()
        await redis_client.setex(
            _query_embed_cache_key(query),
            QUERY_EMBED_CACHE_TTL_SECONDS,
            json.dumps(embedding),
        )
    except Exception as e:
        logger.debug("Query-embedding cache write failed (non-fatal): %s", e)


async def _embed_query_cached(query: str) -> List[float]:
    """`generate_embeddings(query)` with a short-TTL Redis cache in front."""
    cached = await _get_cached_query_embedding(query)
    if cached is not None:
        return cached
    embedding = await generate_embeddings(query)
    if embedding:
        await _store_query_embedding(query, embedding)
    return embedding


async def retrieve_relevant_slides(
    query: str,
    *,
    lecture_id: Optional[str] = None,
    pdf_hash: Optional[str] = None,
    current_slide_index: Optional[int] = None,
    k: int = DEFAULT_K,
    threshold: float = DEFAULT_THRESHOLD,
) -> List[Dict[str, Any]]:
    """Retrieve top-K slides relevant to `query`, scoped to the lecture.

    Returns a list of dicts ordered with the current slide first (if any),
    followed by the top semantic matches:
        [{"slide_index": int, "title": str,
          "content": str, "similarity": float}, ...]

    Both `lecture_id` and `pdf_hash` are optional but at least one is
    required to scope retrieval; otherwise we'd be matching across every
    slide ever embedded.  When neither is provided we return only the
    current slide (if known), so the caller falls back to single-slide
    grounding rather than a global similarity dump.
    """
    if not query or not query.strip():
        return _current_only(current_slide_index, lecture_id, pdf_hash)

    if not (lecture_id or pdf_hash):
        return await _current_only(current_slide_index, lecture_id, pdf_hash)

    try:
        embedding = await _embed_query_cached(query)
    except Exception as e:
        logger.warning("Query embedding failed (degrading to current slide): %s", e)
        return await _current_only(current_slide_index, lecture_id, pdf_hash)

    # Scoped in SQL (Roadmap P1-4) — no over-fetch, no Python post-filter.
    # match_slides_by_lecture applies the lecture_id/pdf_hash scope in the
    # WHERE clause itself, so a relevant slide in this lecture is never
    # dropped because a global candidate window filled up with other
    # lectures' slides first (see migration 20260719020000's comment).
    raw_matches: List[Dict[str, Any]]
    try:
        raw_matches = await get_similar_slides_by_lecture(
            embedding, lecture_id, pdf_hash, limit=k, threshold=threshold
        )
    except Exception as e:
        logger.warning("match_slides_by_lecture RPC failed: %s", e)
        raw_matches = []

    # Dedup by slide_index (most-similar wins because RPC orders by distance).
    seen: set[int] = set()
    deduped: List[Dict[str, Any]] = []
    for r in raw_matches:
        idx = r.get("slide_index")
        if idx is None or idx in seen:
            continue
        seen.add(idx)
        deduped.append(r)

    deduped = deduped[:k]

    enriched: List[Dict[str, Any]] = []
    for r in deduped:
        idx = int(r["slide_index"])
        slide = await _fetch_slide(idx, lecture_id, pdf_hash)
        if not slide:
            continue
        enriched.append({
            "slide_index": idx,
            "title": slide.get("title") or f"Slide {idx + 1}",
            "content": slide.get("content") or "",
            "similarity": float(r.get("similarity", 0.0)),
        })

    # Always anchor on the current slide, deduping if it was already retrieved.
    if current_slide_index is not None:
        if not any(e["slide_index"] == current_slide_index for e in enriched):
            anchor = await _fetch_slide(current_slide_index, lecture_id, pdf_hash)
            if anchor:
                enriched.insert(0, {
                    "slide_index": current_slide_index,
                    "title": anchor.get("title") or f"Slide {current_slide_index + 1}",
                    "content": anchor.get("content") or "",
                    # Synthetic similarity so refusal logic doesn't conflate
                    # "we picked the current slide as anchor" with "the
                    # current slide is highly relevant to the question."
                    "similarity": 0.0,
                })
        else:
            # Move the current slide to the top.
            enriched.sort(key=lambda e: 0 if e["slide_index"] == current_slide_index else 1)

    return enriched


async def retrieve_relevant_slides_course_scoped(
    query: str,
    *,
    course_ids: List[str],
    k: int = DEFAULT_COURSE_K,
    threshold: float = DEFAULT_THRESHOLD,
) -> List[Dict[str, Any]]:
    """Retrieve top-K slides relevant to `query` across every lecture in
    `course_ids`, fusing semantic (pgvector) and keyword (Postgres FTS)
    results with Reciprocal Rank Fusion so an exact-title query and a
    paraphrase query both surface the right slide.

    Returns entries shaped like `retrieve_relevant_slides` plus
    `lecture_id`/`lecture_title`, since a course spans multiple lectures:
        [{"lecture_id": str, "lecture_title": str, "slide_index": int,
          "title": str, "content": str, "similarity": float}, ...]
    """
    if not query or not query.strip() or not course_ids:
        return []

    vector_hits: List[Dict[str, Any]] = []
    try:
        embedding = await _embed_query_cached(query)
        vector_hits = await get_similar_slides_scoped(
            embedding, course_ids, limit=max(k * 2, 8), threshold=threshold
        )
    except Exception as e:
        logger.warning("Scoped query embedding/search failed: %s", e)

    keyword_hits: List[Dict[str, Any]] = []
    try:
        keyword_hits = await search_slides_keyword_scoped(
            query, course_ids, limit=max(k * 2, 8)
        )
    except Exception as e:
        logger.warning("Scoped keyword slide search failed: %s", e)

    fused = rrf_fuse(vector_hits, keyword_hits, k=k)

    enriched: List[Dict[str, Any]] = []
    lecture_titles: Dict[str, str] = {}
    for r in fused:
        lecture_id = r["lecture_id"]
        idx = r["slide_index"]
        slide = await _fetch_from_slides_table(lecture_id, idx)
        if not slide:
            continue
        if lecture_id not in lecture_titles:
            lecture_titles[lecture_id] = await _fetch_lecture_title(lecture_id)
        enriched.append({
            "lecture_id": lecture_id,
            "lecture_title": lecture_titles[lecture_id],
            "slide_index": idx,
            "title": slide.get("title") or f"Slide {idx + 1}",
            "content": slide.get("content") or "",
            "similarity": float(r.get("similarity", 0.0)),
        })
    return enriched


def rrf_fuse(
    vector_hits: List[Dict[str, Any]],
    keyword_hits: List[Dict[str, Any]],
    *,
    k: int,
    rrf_constant: int = 60,
) -> List[Dict[str, Any]]:
    """Reciprocal Rank Fusion over two ranked result lists, keyed by
    (lecture_id, slide_index). Preserves the best-available `similarity`
    (vector score when present, else 0.0) for downstream refusal logic.
    """
    scores: Dict[Tuple[str, int], float] = {}
    best: Dict[Tuple[str, int], Dict[str, Any]] = {}

    def _key(r: Dict[str, Any]) -> Tuple[str, int]:
        return (str(r["lecture_id"]), int(r["slide_index"]))

    for rank, r in enumerate(vector_hits):
        key = _key(r)
        scores[key] = scores.get(key, 0.0) + 1.0 / (rrf_constant + rank + 1)
        best[key] = r

    for rank, r in enumerate(keyword_hits):
        key = _key(r)
        scores[key] = scores.get(key, 0.0) + 1.0 / (rrf_constant + rank + 1)
        if key not in best:
            best[key] = {**r, "similarity": 0.0}

    ordered_keys = sorted(scores.keys(), key=lambda key: scores[key], reverse=True)
    return [best[key] for key in ordered_keys[:k]]


async def _fetch_lecture_title(lecture_id: str) -> str:
    try:
        res = (
            supabase_admin.table("lectures")
            .select("title")
            .eq("id", lecture_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0]["title"] if rows else "Untitled lecture"
    except Exception as e:
        logger.debug("Lecture title lookup failed for %s: %s", lecture_id, e)
        return "Untitled lecture"


async def _current_only(
    current_slide_index: Optional[int],
    lecture_id: Optional[str],
    pdf_hash: Optional[str],
) -> List[Dict[str, Any]]:
    """Return just the current slide when no real retrieval is possible."""
    if current_slide_index is None:
        return []
    slide = await _fetch_slide(current_slide_index, lecture_id, pdf_hash)
    if not slide:
        return []
    return [{
        "slide_index": current_slide_index,
        "title": slide.get("title") or f"Slide {current_slide_index + 1}",
        "content": slide.get("content") or "",
        "similarity": 0.0,
    }]


async def _fetch_slide(
    slide_index: int,
    lecture_id: Optional[str],
    pdf_hash: Optional[str],
) -> Optional[Dict[str, Any]]:
    """Fetch slide title+content for prompt enrichment.

    Tries the persisted `slides` table first (when scoped by lecture_id),
    then falls back to `slide_parse_cache` keyed by `pdf_hash`.  Returns
    None if neither lookup succeeds — the caller will simply drop that
    slide from the prompt rather than substituting empty context.
    """
    if lecture_id:
        slide = await _fetch_from_slides_table(lecture_id, slide_index)
        if slide:
            return slide
    if pdf_hash:
        slide = await _fetch_from_parse_cache(pdf_hash, slide_index)
        if slide:
            return slide
    return None


async def _fetch_from_slides_table(
    lecture_id: str, slide_index: int
) -> Optional[Dict[str, Any]]:
    """Lookup the persisted slide row (slide_number is 1-indexed)."""
    try:
        res = (
            supabase_admin.table("slides")
            .select("title, content_text, summary")
            .eq("lecture_id", lecture_id)
            .eq("slide_number", slide_index + 1)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        row = rows[0]
        return {
            "title": row.get("title"),
            "content": row.get("content_text") or row.get("summary") or "",
        }
    except Exception as e:
        logger.debug("slides table lookup failed for %s/%d: %s", lecture_id, slide_index, e)
        return None


async def _fetch_from_parse_cache(
    pdf_hash: str, slide_index: int
) -> Optional[Dict[str, Any]]:
    """Lookup the slide_parse_cache entry written during streaming parse."""
    try:
        res = (
            supabase_admin.table("slide_parse_cache")
            .select("slide_data")
            .eq("pdf_hash", pdf_hash)
            .eq("slide_index", slide_index)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        slide_data = rows[0].get("slide_data") or {}
        return {
            "title": slide_data.get("title"),
            "content": slide_data.get("content")
                or slide_data.get("summary")
                or "",
        }
    except Exception as e:
        logger.debug("slide_parse_cache lookup failed for %s/%d: %s", pdf_hash, slide_index, e)
        return None
