"""Lazy per-slide synthesis for the import-pdf-lazy pipeline.

A slide's `title`/`content`/`summary`/`questions` are only generated when
the student actually opens that slide. The first call for a given
(pdf_hash, slide_index) makes one LLM call and writes to slide_parse_cache;
subsequent calls hit the cache.

The slide dict shape matches what file_parse_service.parse_pdf_stream
emits, so the existing UI and downstream consumers work unchanged.
"""
import logging
from typing import Any, Dict, List, Optional

from backend.services.ai_service import batch_analyze_text_slides, safe_truncate_text
from backend.services.cache import (
    get_cached_parse,
    get_cached_slide_results,
    store_slide_parse_result,
)
from backend.services.layout_analyzer import PageLayout, layout_features_dict

logger = logging.getLogger(__name__)

PIPELINE_VERSION = "lazy-1"
NEIGHBOR_RADIUS = 1


async def synthesize_slide(
    pdf_hash: str,
    idx: int,
    ai_model: str = "groq",
) -> Optional[Dict[str, Any]]:
    """Return a fully-AI-synthesized slide dict for (pdf_hash, idx).

    Cache-first. On miss, makes one LLM batch call with `idx` as the
    target slide and `idx-1`/`idx+1` as context-only neighbors so the
    model can resolve back-references like "this method".

    Returns None if no cached layouts exist for `pdf_hash` (caller should
    have run the lazy import first).
    """
    cached_slides = await get_cached_slide_results(pdf_hash, PIPELINE_VERSION)
    if idx in cached_slides:
        return cached_slides[idx]

    pdf_cache = await get_cached_parse(pdf_hash)
    if not pdf_cache or "layouts" not in pdf_cache:
        logger.warning(
            "synthesize_slide: no cached layouts for %s — run import first", pdf_hash
        )
        return None

    layouts_raw: List[Dict[str, Any]] = pdf_cache["layouts"]
    if idx < 0 or idx >= len(layouts_raw):
        return None

    layouts = [PageLayout(**l) for l in layouts_raw]
    layout = layouts[idx]

    if not layout.raw_text.strip():
        result = _make_empty_slide(idx, layout, pdf_cache.get("filename", "upload.pdf"))
        await store_slide_parse_result(pdf_hash, idx, PIPELINE_VERSION, result)
        return result

    lo = max(0, idx - NEIGHBOR_RADIUS)
    hi = min(len(layouts), idx + NEIGHBOR_RADIUS + 1)
    slides_input: List[Dict[str, Any]] = []
    for j in range(lo, hi):
        txt, _ = safe_truncate_text(layouts[j].raw_text)
        entry: Dict[str, Any] = {
            "index": j,
            "page_number": j + 1,
            "text": txt,
        }
        if j != idx:
            entry["context_only"] = True
        slides_input.append(entry)

    try:
        results = await batch_analyze_text_slides(
            slides_input, ai_model=ai_model, blueprint=None,
        )
    except Exception as exc:
        logger.error("synthesize_slide LLM call failed for %s/%d: %s", pdf_hash, idx, exc)
        return None

    target = next((r for r in results if r.get("index") == idx), None)
    if target is None:
        logger.warning("synthesize_slide: no result for idx %d in batch response", idx)
        return None

    _enrich(target, layout, pdf_cache.get("filename", "upload.pdf"))
    await store_slide_parse_result(pdf_hash, idx, PIPELINE_VERSION, target)
    return target


def make_stub_slide(idx: int, layout: PageLayout, filename: str) -> Dict[str, Any]:
    """A pre-AI placeholder shown immediately on import.

    Title and content come from raw text heuristics so the UI has
    something to render before lazy synth runs.
    """
    raw = layout.raw_text.strip()
    first_line = raw.split("\n", 1)[0].strip() if raw else ""
    title = first_line[:80] if first_line else f"Slide {idx + 1}"
    return {
        "index": idx,
        "slide_index": idx,
        "title": title,
        "content": raw[:500],
        "summary": "",
        "questions": [],
        "slide_type": "stub",
        "_meta": {
            "filename": filename,
            "page": idx + 1,
            "type": "stub",
            "engine": "none",
            "tokens": layout.word_count * 4,
            "parse_time_ms": 0,
            "column_count": layout.column_count,
            "has_math": layout.has_math,
            "has_code": layout.has_code_block,
            "route": "lazy_stub",
            "route_reason": "pre-AI placeholder",
            "layout_features": layout_features_dict(layout),
        },
    }


def _make_empty_slide(idx: int, layout: PageLayout, filename: str) -> Dict[str, Any]:
    return {
        "index": idx,
        "slide_index": idx,
        "title": f"Slide {idx + 1}",
        "content": "",
        "summary": "",
        "questions": [],
        "slide_type": "metadata",
        "is_metadata": True,
        "_meta": {
            "filename": filename,
            "page": idx + 1,
            "type": "metadata",
            "engine": "none",
            "tokens": 0,
            "parse_time_ms": 0,
            "column_count": layout.column_count,
            "has_math": False,
            "has_code": False,
            "route": "skip",
            "route_reason": "empty raw_text",
            "layout_features": layout_features_dict(layout),
        },
    }


def _enrich(
    result: Dict[str, Any], layout: PageLayout, filename: str,
) -> None:
    idx = result.get("index", 0)
    result.setdefault("slide_index", idx)
    result.setdefault("title", f"Slide {idx + 1}")
    result["_meta"] = {
        "filename": filename,
        "page": idx + 1,
        "type": result.get("slide_type", "content"),
        "engine": "lazy_text",
        "tokens": layout.word_count * 4,
        "parse_time_ms": 0,
        "column_count": layout.column_count,
        "has_math": layout.has_math,
        "has_code": layout.has_code_block,
        "route": "lazy",
        "route_reason": "synthesized on demand",
        "layout_features": layout_features_dict(layout),
    }
