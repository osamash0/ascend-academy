"""
Two-pass, zero-cost PDF ingestion pipeline.

Pass 1 — structural analysis (no LLM, no pixmap renders):
  - All pages analyzed concurrently; each thread opens its own fitz.Document.
  - Returns PageLayout dataclasses (no live fitz objects after this point).
  - content_filter.is_metadata_slide() run on each page's raw_text.
  - ODL data (if available) merged into PageLayout.odl_table_md.
  - RoutingManifest built: TEXT / VISION / TABLE_LLM / TABLE_ODL / SKIP.

Pass 2 — routed processing (skip already_done checkpoint):
  - TEXT + TABLE_ODL: batched 12 at a time, max 2 concurrent batches (Semaphore).
  - VISION + TABLE_LLM: individual VLM calls, max 3 concurrent (Semaphore).
  - SKIP: yielded immediately as is_metadata=True, no LLM call.
  - OCR fallback: Tesseract injected for scanned slides when VLM unavailable.
  - Each slide result cached to slide_parse_cache as a background task.
  - Failed cache writes accumulated and retried at deck finalize.

Memory safety:
  - PDFReader is stateless — each method opens/closes its own document.
  - render_page_jpeg nullifies the Pixmap inside the thread before returning bytes.
  - image_bytes and b64 string both released after VLM call.
"""
import asyncio
import base64
import hashlib
import logging
import time
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

from backend.services.ai_service import (
    batch_analyze_text_slides,
    analyze_slide_vision,
    generate_deck_summary,
    generate_deck_quiz,
    safe_truncate_text,
    cerebras_client,
)
from backend.services.cache import (
    get_cached_blueprint,
    get_cached_slide_results,
    record_pipeline_run,
    store_cached_blueprint,
    store_slide_embedding,
    store_slide_parse_result,
)
from backend.services.ai.embeddings import generate_embeddings
from backend.services.content_filter import is_metadata_slide
from backend.services.layout_analyzer import (
    PageLayout,
    analyze_page_layout_async,
    layout_features_dict,
)
from backend.services.ocr_fallback import OCRFallback
from backend.services.pdf_reader import PDFReader
from backend.services.planner_service import (
    BLUEPRINT_VERSION,
    generate_blueprint,
    get_slide_context,
)
from backend.services.slide_classifier import (
    ROUTE_SKIP,
    ROUTE_TEXT,
    build_routing_manifest,
    RoutingManifest,
)
from backend.services.summarizer_service import generate_hierarchical_summary

logger = logging.getLogger(__name__)

TEXT_BATCH_SIZE  = 12
TEXT_BATCH_SEM   = 2    # max concurrent text-batch LLM calls (rate-limit guard)
VISION_SEM_LIMIT = 3    # max concurrent VLM calls
LAYOUT_SEM_LIMIT = 8    # max concurrent Pass-1 layout analyses (memory guard)
PIPELINE_VERSION = "2"  # bump when prompts/schema change to invalidate checkpoints


async def parse_pdf_stream(
    pdf_bytes: bytes,
    filename: str = "upload.pdf",
    ai_model: str = "groq",
    use_blueprint: bool = True,
    odl_pages: Optional[Dict[int, Dict[str, Any]]] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Streaming PDF parser.  Yields SSE-compatible dicts:
      {"type": "progress", "current": int, "total": int, "message": str}
      {"type": "slide", "index": int, "slide": dict}
      {"type": "deck_complete", "deck_summary": str, "deck_quiz": list}
      {"type": "complete", "total": int}
      {"type": "partial_complete", "slides_processed": int, "total_expected": int}
      {"type": "error", "message": str, "recoverable": bool}
    """
    t_start = time.monotonic()
    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()
    odl_pages = odl_pages or {}

    reader = PDFReader(pdf_bytes)
    total_pages = await reader.get_page_count()

    _failed_cache_queue: List[Tuple] = []  # slides whose cache write failed
    _failed_embed_queue: List[Tuple] = []  # slides whose embedding write failed

    # Surface pdf_hash early so the frontend can attach the lecture to the
    # embeddings written below once the user clicks "Save".
    yield {"type": "meta", "pdf_hash": pdf_hash}

    yield {
        "type": "progress",
        "current": 0,
        "total": total_pages,
        "message": "Analyzing slide structure…",
    }

    # ------------------------------------------------------------------
    # PASS 1: Layout analysis — concurrent, no LLM, no pixmaps held.
    # Bounded by LAYOUT_SEM_LIMIT so a 300-page PDF doesn't spawn 300
    # threads and blow the container's memory.
    # ------------------------------------------------------------------
    layout_sem = asyncio.Semaphore(LAYOUT_SEM_LIMIT)

    async def _bounded_layout(i: int) -> PageLayout:
        async with layout_sem:
            return await analyze_page_layout_async(reader, i, odl_pages.get(i + 1))

    layouts_list = await asyncio.gather(*[
        _bounded_layout(i) for i in range(total_pages)
    ])
    layouts: Dict[int, PageLayout] = {l.index: l for l in layouts_list}

    # Metadata detection (synchronous heuristic, no I/O)
    metadata_flags: Dict[int, bool] = {}
    for idx, layout in layouts.items():
        txt, _ = safe_truncate_text(layout.raw_text)
        meta = is_metadata_slide(txt, idx, total_pages, ai_model)
        metadata_flags[idx] = meta.get("is_metadata", False)

    manifest: RoutingManifest = build_routing_manifest(layouts, metadata_flags, ai_model)
    logger.info(
        "Routing for %s (%d pages): text=%d vision=%d table_llm=%d skip=%d",
        filename, total_pages,
        len(manifest.text_indices), len(manifest.vision_indices),
        len(manifest.table_llm_indices), len(manifest.skip_indices),
    )

    # ------------------------------------------------------------------
    # Telemetry counters — incremented in-place at fallback sites.
    # Surfaced in pipeline_run_metrics at deck-finalize time.
    # ------------------------------------------------------------------
    fallback_counters: Dict[str, int] = {
        "text_batch_fallback": 0,
        "vision_rate_limit": 0,
        "ocr_used": 0,
        "cache_write_retries": 0,
    }
    started_at_iso = datetime.now(timezone.utc).isoformat()

    # ------------------------------------------------------------------
    # Blueprint — fits between passes, uses raw_text already in memory
    # ------------------------------------------------------------------
    blueprint: Optional[Dict[str, Any]] = None
    if use_blueprint:
        blueprint = await _stage_planning(
            pdf_bytes, pdf_hash,
            [layouts[i].raw_text for i in range(total_pages)],
            ai_model,
        )
        if blueprint:
            yield {
                "type": "progress",
                "current": 0,
                "total": total_pages,
                "message": "Master Plan ready. Starting analysis…",
            }

    # ------------------------------------------------------------------
    # Checkpoint: re-yield already-processed slides
    # ------------------------------------------------------------------
    already_done: Dict[int, Dict] = await get_cached_slide_results(pdf_hash, PIPELINE_VERSION)
    if already_done:
        logger.info("Resuming from checkpoint: %d slides already done", len(already_done))
    for idx in sorted(already_done):
        # Older cache rows pre-date the routing telemetry fields.  Stamp
        # _meta.route / route_reason / layout_features in-memory so the
        # diagnostics endpoint and frontend panel work for in-flight
        # reruns without forcing a full reparse.
        cached_slide = already_done[idx]
        if _backfill_route_meta(cached_slide, layouts.get(idx), manifest):
            # Persist the enriched row back to slide_parse_cache so the
            # diagnostics endpoint (which reads cache directly) sees the
            # new telemetry without waiting for another full parse.
            asyncio.create_task(
                _safe_cache_task(idx, cached_slide, pdf_hash, _failed_cache_queue, fallback_counters)
            )
        yield {"type": "slide", "index": idx, "slide": cached_slide}

    # ------------------------------------------------------------------
    # PASS 2: Routed processing
    # ------------------------------------------------------------------
    text_sem   = asyncio.Semaphore(TEXT_BATCH_SEM)
    vision_sem = asyncio.Semaphore(VISION_SEM_LIMIT)
    collected_count = len(already_done)

    try:
        # --- SKIP slides ---
        for idx in manifest.skip_indices:
            if idx in already_done:
                continue
            slide = _make_skip_slide(idx, layouts[idx], filename, manifest)
            asyncio.create_task(
                _safe_cache_task(idx, slide, pdf_hash, _failed_cache_queue, fallback_counters)
            )
            collected_count += 1
            yield {"type": "slide", "index": idx, "slide": slide}

        # --- TEXT + TABLE_ODL batches ---
        pending_text = [i for i in manifest.text_indices if i not in already_done]

        # OCR fallback: scanned pages (low alpha_ratio) routed through TEXT
        # because the model can't do vision get a one-shot OCR pass so the
        # LLM has *something* to work with.  The fallback only fires for
        # non-vision models — vision-capable models would have been routed
        # through the VISION path by classify_page.
        ocr_text_overrides: Dict[int, str] = {}
        for idx in pending_text:
            if idx in manifest.odl_table_indices:
                continue  # ODL markdown is already a better signal than OCR
            layout = layouts[idx]
            if not OCRFallback.is_needed(ai_model, layout.alpha_ratio):
                continue
            try:
                image_bytes = await reader.render_page_jpeg(idx, zoom=2.0)
                ocr_text = await OCRFallback.extract_text(image_bytes)
                if ocr_text:
                    ocr_text_overrides[idx] = ocr_text
                    fallback_counters["ocr_used"] = (
                        fallback_counters.get("ocr_used", 0) + 1
                    )
            except Exception as e:
                logger.warning("OCR fallback failed for slide %d: %s", idx, e)

        batch_inputs = [
            _build_text_batch(
                pending_text[s:s + TEXT_BATCH_SIZE],
                layouts, manifest.odl_table_indices, ai_model,
                ocr_overrides=ocr_text_overrides,
            )
            for s in range(0, len(pending_text), TEXT_BATCH_SIZE)
        ]
        text_tasks = [
            _process_text_batch_safe(batch, ai_model, blueprint, text_sem, fallback_counters)
            for batch in batch_inputs
        ]
        for batch_result in await asyncio.gather(*text_tasks, return_exceptions=True):
            if isinstance(batch_result, Exception):
                logger.error("Text batch error (non-fatal): %s", batch_result)
                continue
            for res in batch_result:
                idx = res["index"]
                _enrich_result(res, layouts[idx], filename, "Text", manifest)
                asyncio.create_task(
                    _safe_cache_task(idx, res, pdf_hash, _failed_cache_queue, fallback_counters)
                )
                asyncio.create_task(_safe_embedding_task(idx, res, pdf_hash, _failed_embed_queue))
                collected_count += 1
                yield {
                    "type": "progress",
                    "current": collected_count,
                    "total": total_pages,
                    "message": f"Processed {collected_count}/{total_pages} slides…",
                }
                yield {"type": "slide", "index": idx, "slide": res}

        # --- VISION + TABLE_LLM ---
        pending_vision = [
            i for i in (manifest.vision_indices + manifest.table_llm_indices)
            if i not in already_done
        ]
        vision_tasks = [
            _process_vision_slide(
                reader, i, layouts[i], ai_model, blueprint,
                vision_sem, fallback_counters,
                use_table_prompt=(i in manifest.table_llm_indices),
            )
            for i in pending_vision
        ]
        for res in await asyncio.gather(*vision_tasks, return_exceptions=True):
            if isinstance(res, Exception):
                logger.error("Vision task error (non-fatal): %s", res)
                continue
            idx = res["index"]
            _enrich_result(res, layouts[idx], filename, "Vision", manifest)
            asyncio.create_task(
                _safe_cache_task(idx, res, pdf_hash, _failed_cache_queue, fallback_counters)
            )
            asyncio.create_task(_safe_embedding_task(idx, res, pdf_hash, _failed_embed_queue))
            collected_count += 1
            yield {
                "type": "progress",
                "current": collected_count,
                "total": total_pages,
                "message": f"Processed {collected_count}/{total_pages} slides…",
            }
            yield {"type": "slide", "index": idx, "slide": res}

    except Exception as e:
        logger.error("Pipeline error after %d slides: %s", collected_count, e, exc_info=True)
        if collected_count > 0:
            yield {
                "type": "partial_complete",
                "slides_processed": collected_count,
                "total_expected": total_pages,
            }
        yield {"type": "error", "message": str(e), "recoverable": collected_count > 0}
        return

    # ------------------------------------------------------------------
    # Finalize: deck summary + quiz + cache flush
    # ------------------------------------------------------------------
    async for event in _stage_finalize_deck(
        layouts, blueprint, ai_model, _failed_cache_queue, _failed_embed_queue, pdf_hash,
        manifest=manifest, fallback_counters=fallback_counters,
        started_at_iso=started_at_iso,
    ):
        yield event

    logger.info(
        "Pipeline complete: %d slides in %.1fs", total_pages, time.monotonic() - t_start
    )


# ---------------------------------------------------------------------------
# Text batch helpers
# ---------------------------------------------------------------------------

def _build_text_batch(
    batch_indices: List[int],
    layouts: Dict[int, PageLayout],
    odl_table_indices: List[int],
    ai_model: str,
    ocr_overrides: Optional[Dict[int, str]] = None,
) -> List[Dict]:
    """Assembles slide dicts for batch_analyze_text_slides, injecting ODL/OCR text."""
    slides_input = []
    overrides = ocr_overrides or {}
    for idx in batch_indices:
        layout = layouts[idx]

        if idx in odl_table_indices and layout.odl_table_md:
            txt = (
                "[This slide contains a structured table. "
                "Content is pre-formatted as Markdown.]\n\n"
                + layout.odl_table_md
            )
        elif idx in overrides:
            # Scanned page rescued by OCR — prefer the OCR text over the
            # garbled raw text so the LLM has something coherent to work
            # with.  We tag it so the downstream prompt knows.
            ocr_txt, _ = safe_truncate_text(overrides[idx])
            txt = "[OCR fallback applied — text extracted from page image]\n\n" + ocr_txt
        else:
            txt, _ = safe_truncate_text(layout.raw_text)

        slides_input.append({
            "index": idx,
            "page_number": idx + 1,
            "text": txt,
        })
    return slides_input


async def _process_text_batch_safe(
    slides_input: List[Dict],
    ai_model: str,
    blueprint: Optional[Dict],
    sem: asyncio.Semaphore,
    fallback_counters: Optional[Dict[str, int]] = None,
) -> List[Dict]:
    """
    Runs the LLM batch under the semaphore.
    On failure, falls back to per-slide calls with asyncio.gather.
    """
    async with sem:
        try:
            return await batch_analyze_text_slides(
                slides_input, ai_model=ai_model, blueprint=blueprint
            )
        except Exception as e:
            if fallback_counters is not None:
                fallback_counters["text_batch_fallback"] = (
                    fallback_counters.get("text_batch_fallback", 0) + 1
                )
            logger.warning(
                "Batch of %d failed (%s), retrying per-slide", len(slides_input), e
            )
            per_slide_tasks = [
                _single_slide_text(s, ai_model, blueprint) for s in slides_input
            ]
            results = await asyncio.gather(*per_slide_tasks, return_exceptions=True)
            out = []
            for s, r in zip(slides_input, results):
                if isinstance(r, list) and r:
                    out.extend(r)
                elif isinstance(r, dict):
                    out.append(r)
                else:
                    logger.error("Single slide %d fallback also failed: %s", s["index"], r)
                    out.append(_make_fallback_slide(s["index"], s["text"]))
            return out


async def _single_slide_text(
    slide_input: Dict, ai_model: str, blueprint: Optional[Dict]
) -> List[Dict]:
    return await batch_analyze_text_slides(
        [slide_input], ai_model=ai_model, blueprint=blueprint
    )


# ---------------------------------------------------------------------------
# Vision helper
# ---------------------------------------------------------------------------

async def _process_vision_slide(
    reader: PDFReader,
    page_index: int,
    layout: PageLayout,
    ai_model: str,
    blueprint: Optional[Dict],
    sem: asyncio.Semaphore,
    fallback_counters: Optional[Dict[str, int]] = None,
    use_table_prompt: bool = False,
) -> Dict:
    """
    Renders the page and calls the VLM.
    Pixmap is released inside the thread (PDFReader.render_page_jpeg).
    image_bytes and b64 are explicitly released after encoding / after VLM call.
    """
    try:
        async with sem:
            image_bytes = await reader.render_page_jpeg(page_index, zoom=2.0)
            b64 = base64.b64encode(image_bytes).decode()
            image_bytes = None
            del image_bytes  # release raw bytes buffer

            ctx = get_slide_context(blueprint, page_index) if blueprint else ""
            result = await analyze_slide_vision(b64, layout.raw_text[:1000], ai_model, ctx)
            b64 = None
            del b64  # release base64 string

            result["index"] = page_index

            # Normalize vision result structure
            if "content_extraction" in result:
                from backend.services.ai.vision import format_slide_content
                ce = result["content_extraction"]
                result["content"] = format_slide_content(ce)
                result["title"] = (
                    result.get("metadata", {}).get("lecture_title")
                    or ce.get("main_topic")
                    or f"Slide {page_index + 1}"
                )
                result["summary"] = ce.get("summary", "")
                result["questions"] = [result["quiz"]] if result.get("quiz") else []

            return result
    except Exception as e:
        msg = str(e).lower()
        if fallback_counters is not None and (
            "rate limit" in msg or "rate-limit" in msg or "429" in msg or "ratelimit" in msg
        ):
            fallback_counters["vision_rate_limit"] = (
                fallback_counters.get("vision_rate_limit", 0) + 1
            )
        logger.error("Vision failed for slide %d: %s", page_index, e)
        return {
            "index": page_index,
            "title": f"Slide {page_index + 1}",
            "content": layout.raw_text[:500] or "(visual content)",
            "summary": "",
            "questions": [],
            "slide_type": "diagram",
            "parse_error": str(e),
        }


# ---------------------------------------------------------------------------
# Result helpers
# ---------------------------------------------------------------------------

def _enrich_result(
    result: Dict,
    layout: PageLayout,
    filename: str,
    engine: str,
    manifest: Optional[RoutingManifest] = None,
) -> None:
    """Attaches metadata to a slide result in-place."""
    idx = result.get("index", 0)
    result.setdefault("slide_index", idx)
    result.setdefault("title", f"Slide {idx + 1}")
    result["_meta"] = {
        "filename": filename,
        "page": idx + 1,
        "type": result.get("slide_type", "content"),
        "engine": engine,
        "tokens": layout.word_count * 4,
        "parse_time_ms": 0,
        "column_count": layout.column_count,
        "has_math": layout.has_math,
        "has_code": layout.has_code_block,
        # Routing telemetry — sourced from the classifier so the rule
        # name on every slide always matches the rule that fired.
        "route": (manifest.route_labels.get(idx, ROUTE_TEXT) if manifest else ROUTE_TEXT),
        "route_reason": (manifest.reasons.get(idx, "") if manifest else ""),
        "layout_features": layout_features_dict(layout),
    }


def _make_skip_slide(
    idx: int,
    layout: PageLayout,
    filename: str,
    manifest: Optional[RoutingManifest] = None,
) -> Dict:
    return {
        "index": idx,
        "slide_index": idx,
        "title": f"Slide {idx + 1}",
        "content": layout.raw_text[:300] if layout.raw_text else "",
        "summary": "",
        "questions": [],
        "slide_type": "metadata",
        "is_metadata": True,
        "_meta": {
            "filename": filename,
            "page": idx + 1,
            "type": "metadata",
            "engine": "Skip",
            "tokens": 0,
            "parse_time_ms": 0,
            "route": ROUTE_SKIP,
            "route_reason": (manifest.reasons.get(idx, "") if manifest else ""),
            "layout_features": layout_features_dict(layout),
        },
    }


def _backfill_route_meta(
    cached_slide: Dict[str, Any],
    layout: Optional[PageLayout],
    manifest: RoutingManifest,
) -> bool:
    """Stamp routing telemetry onto a cached slide dict in-place.

    Older cache rows (written before this telemetry shipped) lack
    ``_meta.route``, ``_meta.route_reason`` and ``_meta.layout_features``.
    This is invoked on the resume path so the diagnostics endpoint and
    frontend panel work for in-flight reruns without forcing a reparse.
    Only fields that are missing or empty are filled — anything the
    cached slide already carries is preserved.

    Returns ``True`` when at least one missing field was filled, so the
    caller can decide whether to persist the enriched row back to the
    cache.  ``False`` means the cached row was already fully stamped.
    """
    if not isinstance(cached_slide, dict):
        return False
    meta = cached_slide.setdefault("_meta", {}) or {}
    if not isinstance(meta, dict):
        return False
    idx = cached_slide.get("slide_index", cached_slide.get("index", 0))
    changed = False
    if "route" not in meta or not meta.get("route"):
        meta["route"] = manifest.route_labels.get(idx, ROUTE_TEXT)
        changed = True
    if "route_reason" not in meta or not meta.get("route_reason"):
        meta["route_reason"] = manifest.reasons.get(idx, "")
        changed = True
    if ("layout_features" not in meta or not meta.get("layout_features")) and layout is not None:
        meta["layout_features"] = layout_features_dict(layout)
        changed = True
    cached_slide["_meta"] = meta
    return changed


def _make_fallback_slide(idx: int, text: str) -> Dict:
    return {
        "index": idx,
        "slide_index": idx,
        "title": f"Slide {idx + 1}",
        "content": text[:500] if text else "",
        "summary": "",
        "questions": [],
        "slide_type": "content",
        "parse_error": "processing_failed",
    }


# ---------------------------------------------------------------------------
# Background cache task
# ---------------------------------------------------------------------------

async def _safe_cache_task(
    idx: int,
    result: Dict,
    pdf_hash: str,
    failed_queue: List[Tuple],
    fallback_counters: Optional[Dict[str, int]] = None,
) -> None:
    try:
        await store_slide_parse_result(pdf_hash, idx, PIPELINE_VERSION, result)
    except Exception as e:
        if fallback_counters is not None:
            fallback_counters["cache_write_retries"] = (
                fallback_counters.get("cache_write_retries", 0) + 1
            )
        logger.error("Cache write failed for slide %d: %s — queued for retry", idx, e)
        failed_queue.append((idx, result, pdf_hash))


def _build_embedding_text(slide: Dict) -> str:
    """Compact, retrieval-friendly text for a slide: title + summary + body.

    We bias toward title and summary (short, high-signal) and truncate the
    body to roughly 600 tokens so a single slide can't dominate the
    embedding budget.  Returns "" when the slide has no usable text — the
    caller should skip embedding in that case rather than store a zero
    vector.
    """
    parts: List[str] = []
    title = (slide.get("title") or "").strip()
    if title and not title.lower().startswith("slide "):
        # Don't waste tokens on auto-generated "Slide 7" placeholders.
        parts.append(title)
    summary = (slide.get("summary") or "").strip()
    if summary:
        parts.append(summary)
    content = (slide.get("content") or "").strip()
    if content:
        parts.append(content[:2400])
    return "\n\n".join(parts)


async def _safe_embedding_task(
    idx: int,
    result: Dict,
    pdf_hash: str,
    failed_queue: List[Tuple],
) -> None:
    """Generate + persist a slide embedding without ever failing the parse.

    Skips slides flagged as metadata (title pages, dividers) — they don't
    carry teaching content so embedding them just adds noise to retrieval.
    On failure the (idx, result, pdf_hash) tuple is appended to
    `failed_queue` so deck-finalize can do one more attempt.
    """
    if result.get("is_metadata") or result.get("slide_type") == "metadata":
        return
    text = _build_embedding_text(result)
    if not text:
        return
    try:
        embedding = await generate_embeddings(text)
        if not embedding:
            return
        content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
        meta = result.get("_meta", {}) or {}
        metadata = {
            "slide_type": result.get("slide_type"),
            "engine": meta.get("engine"),
            "has_math": meta.get("has_math", False),
            "title": result.get("title"),
        }
        await store_slide_embedding(
            lecture_id=None,
            slide_index=idx,
            embedding=embedding,
            metadata=metadata,
            content_hash=content_hash,
            pdf_hash=pdf_hash,
            pipeline_version=PIPELINE_VERSION,
        )
    except Exception as e:
        logger.error("Embedding write failed for slide %d: %s — queued for retry", idx, e)
        failed_queue.append((idx, result, pdf_hash))


# ---------------------------------------------------------------------------
# Blueprint generation
# ---------------------------------------------------------------------------

async def _stage_planning(
    pdf_bytes: bytes,
    pdf_hash: str,
    all_text: List[str],
    ai_model: str,
) -> Optional[Dict[str, Any]]:
    blueprint = await get_cached_blueprint(pdf_hash, version=BLUEPRINT_VERSION)
    if blueprint:
        return blueprint

    plan_model = "cerebras" if cerebras_client else "groq"

    try:
        reader = PDFReader(pdf_bytes)
        outline = await reader.get_toc()

        summary = ""
        async for event in generate_hierarchical_summary(all_text, outline, plan_model):
            if event["type"] == "result":
                summary = event["data"]

        first_3 = [t for t in all_text[:3] if t.strip()]
        blueprint = None
        async for event in generate_blueprint(outline, summary, first_3, plan_model):
            if event["type"] == "result":
                blueprint = event["data"]

        if blueprint:
            await store_cached_blueprint(pdf_hash, blueprint, version=BLUEPRINT_VERSION)
        return blueprint
    except Exception as e:
        logger.error("Blueprint generation failed (non-fatal): %s", e)
        return None


# ---------------------------------------------------------------------------
# Deck finalization
# ---------------------------------------------------------------------------

async def _stage_finalize_deck(
    layouts: Dict[int, PageLayout],
    blueprint: Optional[Dict],
    ai_model: str,
    failed_cache_queue: List[Tuple],
    failed_embed_queue: List[Tuple],
    pdf_hash: str,
    manifest: Optional[RoutingManifest] = None,
    fallback_counters: Optional[Dict[str, int]] = None,
    started_at_iso: Optional[str] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    try:
        final_model = "cerebras" if cerebras_client else ai_model

        if blueprint and blueprint.get("overall_summary"):
            summary = blueprint["overall_summary"]
        else:
            all_text = "\n\n".join(
                f"[Slide {i + 1}] {layouts[i].raw_text}"
                for i in sorted(layouts)
                if layouts[i].raw_text.strip()
            )
            summary = await generate_deck_summary(all_text, final_model)

        # Pass the blueprint so generate_deck_quiz can produce a CROSS-SLIDE
        # quiz (linked_slides + concept) when the planner has identified
        # cross-slide concepts. Falls back to a summary-only quiz otherwise.
        quiz = await generate_deck_quiz(summary, final_model, blueprint=blueprint)
        yield {"type": "deck_complete", "deck_summary": summary, "deck_quiz": quiz}
        yield {"type": "complete", "total": len(layouts)}

    except Exception as e:
        logger.error("Deck finalization failed: %s", e)
        yield {"type": "error", "message": "Failed to generate deck summary."}

    finally:
        # Flush any failed per-slide cache writes
        if failed_cache_queue:
            logger.info("Retrying %d failed cache writes…", len(failed_cache_queue))
            for idx, result, ph in failed_cache_queue:
                try:
                    await store_slide_parse_result(ph, idx, PIPELINE_VERSION, result)
                except Exception as e:
                    if fallback_counters is not None:
                        fallback_counters["cache_write_retries"] = (
                            fallback_counters.get("cache_write_retries", 0) + 1
                        )
                    logger.error("Final cache retry failed for slide %d: %s", idx, e)
            failed_cache_queue.clear()

        # Fire-and-forget run-metrics row.  Wrapped in try/except so a
        # telemetry write never breaks the parse stream.
        if manifest is not None:
            try:
                totals = {
                    "text": len(manifest.text_indices) - len(manifest.odl_table_indices),
                    "vision_diagram": sum(
                        1 for i in manifest.vision_indices
                        if manifest.route_labels.get(i) == "vision_diagram"
                    ),
                    "vision_generic": sum(
                        1 for i in manifest.vision_indices
                        if manifest.route_labels.get(i) == "vision_generic"
                    ),
                    "table_llm": len(manifest.table_llm_indices),
                    "table_odl": len(manifest.odl_table_indices),
                    "skip": len(manifest.skip_indices),
                    "total": len(layouts),
                }
                # Truly fire-and-forget: scheduling as a background task
                # avoids any synchronous Supabase round-trip blocking the
                # final stream chunk that the upload endpoint yields.
                async def _persist_metrics() -> None:
                    try:
                        await record_pipeline_run(
                            pdf_hash=pdf_hash,
                            pipeline_version=PIPELINE_VERSION,
                            started_at=started_at_iso or datetime.now(timezone.utc).isoformat(),
                            finished_at=datetime.now(timezone.utc).isoformat(),
                            totals=totals,
                            fallbacks=dict(fallback_counters or {}),
                        )
                    except Exception as e:
                        logger.warning(
                            "Failed to record pipeline_run_metrics (non-fatal): %s", e
                        )

                asyncio.create_task(_persist_metrics())
            except Exception as e:
                logger.warning("Failed to schedule pipeline_run_metrics (non-fatal): %s", e)

        # Flush any failed embedding writes (one more attempt; best-effort).
        if failed_embed_queue:
            logger.info("Retrying %d failed embedding writes…", len(failed_embed_queue))
            for idx, result, ph in failed_embed_queue:
                try:
                    text = _build_embedding_text(result)
                    if not text:
                        continue
                    embedding = await generate_embeddings(text)
                    if not embedding:
                        continue
                    content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
                    meta = result.get("_meta", {}) or {}
                    metadata = {
                        "slide_type": result.get("slide_type"),
                        "engine": meta.get("engine"),
                        "has_math": meta.get("has_math", False),
                        "title": result.get("title"),
                    }
                    await store_slide_embedding(
                        lecture_id=None,
                        slide_index=idx,
                        embedding=embedding,
                        metadata=metadata,
                        content_hash=content_hash,
                        pdf_hash=ph,
                        pipeline_version=PIPELINE_VERSION,
                    )
                except Exception as e:
                    logger.error("Final embedding retry failed for slide %d: %s", idx, e)
            failed_embed_queue.clear()
