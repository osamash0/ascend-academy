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

import logging
from typing import Any, Dict, List, Optional, Tuple

from backend.core.database import supabase_admin
from backend.services.ai.embeddings import generate_embeddings
from backend.services.cache import get_similar_slides

logger = logging.getLogger(__name__)

DEFAULT_K = 5
DEFAULT_THRESHOLD = 0.65


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
        embedding = await generate_embeddings(query)
    except Exception as e:
        logger.warning("Query embedding failed (degrading to current slide): %s", e)
        return await _current_only(current_slide_index, lecture_id, pdf_hash)

    # Pull a generous candidate set; we'll trim after scoping.
    raw_matches: List[Dict[str, Any]]
    try:
        raw_matches = await get_similar_slides(
            embedding, limit=max(k * 4, 8), threshold=threshold
        )
    except Exception as e:
        logger.warning("match_slides RPC failed: %s", e)
        raw_matches = []

    scoped: List[Dict[str, Any]] = []
    for r in raw_matches:
        if lecture_id and r.get("lecture_id") == lecture_id:
            scoped.append(r)
        elif pdf_hash and r.get("pdf_hash") == pdf_hash:
            scoped.append(r)

    # Dedup by slide_index (most-similar wins because RPC orders by distance).
    seen: set[int] = set()
    deduped: List[Dict[str, Any]] = []
    for r in scoped:
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
