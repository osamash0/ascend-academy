"""Parser v4 orchestrator — Production-hardened version.

Pipeline: extract → meta analysis → parallel-batched slide analysis → quiz → finalize.

Key design decisions
--------------------
- Slides are processed in chunks of QUIZ_BATCH_SIZE (default 8).  Within each
  chunk LLM calls are concurrent (asyncio.gather); between chunks the last
  slide's aiInsight is forwarded as narrative context so the professor-voice
  stays coherent across chunk boundaries.  This gives ~4–6× speedup vs. pure
  sequential while preserving cross-slide flow.

- Results are cached in pdf_parse_cache after completion so subsequent uploads
  of the same PDF serve from cache (no LLM cost).

- A `meta` SSE event carrying pdf_hash is emitted right after extraction so the
  frontend can call /attach-lecture with the correct hash once the lecture is
  saved.

- run_id is accepted as a parameter for API compatibility but is NOT persisted
  to parse_runs — v4 uses a fire-and-forget Arq job rather than the DB-tracked
  stage model of v3.
"""
from __future__ import annotations

import json
import logging
import asyncio
import os
import time
from typing import Optional, List, Dict, Any
from uuid import UUID

import redis.asyncio as aioredis

from backend.core.config import settings
from backend.services.ai.orchestrator import (
    generate_text_bulk,
    generate_text,
    parse_json_response,
    QUIZ_BATCH_CONFIG,
)
from backend.services.cache import store_cached_parse
from backend.services.file_parse_service import _safe_embedding_task

logger = logging.getLogger(__name__)

REDIS_CHANNEL_PREFIX = "parse:"

# ---------------------------------------------------------------------------
# LLM helpers
# ---------------------------------------------------------------------------

async def analyze_lecture_meta(slides: List[str], ai_model: str) -> Dict[str, Any]:
    """One LLM call on the first 15 slides to extract lecture-level metadata."""
    combined_text = "\n\n".join(
        f"[Slide {i + 1}]: {text[:400]}" for i, text in enumerate(slides[:15])
    )
    prompt = f"""You are an expert at understanding university lecture slides. Analyze the provided slide texts and return a JSON object.

Return ONLY valid JSON, no markdown. Keys:
- title: string (the lecture title)
- lectureType: one of "introduction", "exam-prep", "theory", "lab", "review", "case-study", "overview", "workshop"
- subject: string (academic subject, e.g. "Computer Science", "Mathematics", "Biology")
- courseCode: string (course code if visible, else "")
- summary: string (3-4 sentence summary of what this entire lecture covers)
- keyTopics: array of strings (5-8 key topics/concepts covered)

Analyze these lecture slides:

{combined_text}"""
    raw = await generate_text(prompt, ai_model=ai_model)
    return parse_json_response(raw)


async def analyze_slide(
    slide_number: int,
    text: str,
    lecture_context: str,
    ai_model: str,
) -> Dict[str, Any]:
    """Analyze a single slide; returns the LLM result dict."""
    prompt = f"""You are an expert at analyzing university lecture slides. Given raw text extracted from a PDF slide, analyze it and return a JSON object.

Return ONLY valid JSON, no markdown, no code blocks. Keys:
- title: string (short descriptive title for this slide, max 60 chars)
- slideType: one of "text", "image-only", "math-diagram", "graph", "mixed", "title-slide", "table-of-contents"
- aiInsight: string (A concise narrative explanation (1-3 sentences) of this slide as if you are a professor teaching a class. If this slide covers the same topic as the previous slide, DO NOT repeat the explanation; focus ONLY on what is new or briefly summarize the continuation. Maintain a logical flow and avoid giving the impression that each slide is being explained in isolation. Do NOT use phrases like "This slide", "In this slide", or "This image". Connect it to the previous slide if mentioned in the context.)
- contextNote: string (1 sentence about where this slide fits in the lecture narrative)

Lecture context: {lecture_context[:1000]}

Slide {slide_number} raw text:
{text[:1500]}

If the text is nearly empty or only has symbols/numbers, classify as "image-only" or "math-diagram"."""
    raw = await generate_text_bulk(prompt, ai_model=ai_model)
    res = parse_json_response(raw)
    if not isinstance(res, dict):
        res = {}
    res["slide_index"] = slide_number - 1
    res["content"] = text if text.strip() else res.get("aiInsight") or res.get("title") or "No extractable text."
    return res


async def generate_quiz_questions(
    slides: List[str],
    lecture_title: str,
    ai_model: str,
) -> List[Dict[str, Any]]:
    """Generate 5–8 deck-level MCQs from content-rich slides."""
    content_slides = [s for s in slides if len(s) > 50][:10]
    if not content_slides:
        return []

    slide_summary = "\n\n".join(
        f"[Slide {i + 1}]: {text[:500]}" for i, text in enumerate(content_slides)
    )
    prompt = f"""Generate quiz questions for a university lecture. Return ONLY a valid JSON array of question objects, no markdown.

Each object has:
- question: string
- options: array of 4 strings (A, B, C, D options — do NOT include "A)", "B)" prefixes, just the text)
- correctAnswer: string (must match one of the options exactly)
- explanation: string (brief explanation of why the answer is correct)
- difficulty: "easy" | "medium" | "hard"
- slideId: number (1-based slide number the question is drawn from)

Lecture: "{lecture_title}"

Slides:
{slide_summary}

Generate 5-8 diverse, well-formed multiple choice questions covering key concepts. Mix difficulties."""
    raw = await generate_text_bulk(prompt, ai_model=ai_model)
    res = parse_json_response(raw)
    return res if isinstance(res, list) else []


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

async def parse_pdf_v4(
    ctx: dict,
    *,
    pdf_hash: str,
    lecture_id: str,
    run_id: Optional[str] = None,
    ai_model: str = "cerebras",
    emit_fn: Optional[callable] = None,
    odl_pages: Optional[Dict[int, dict]] = None,
    parser_used: str = "v4",
) -> str:
    """V4 parse pipeline entry point (Arq job or inline).

    Args:
        ctx:         Arq worker context (unused beyond signature compat).
        pdf_hash:    SHA-256 of the PDF bytes (used for storage lookup + cache key).
        lecture_id:  UUID string of the lecture row (may be empty string).
        run_id:      Optional run identifier echoed in SSE events (NOT persisted to DB).
        ai_model:    Provider hint forwarded to the LLM orchestrator.
        emit_fn:     Optional async callable(event_type, data) for inline/test runs.
                     When None, events are published to the Redis channel for the SSE relay.
        odl_pages:   Pre-extracted page dict from LlamaParse/MinerU/ODL, keyed by
                     1-based page number.  When provided, PyMuPDF extraction is skipped
                     for those pages.
        parser_used: Label reported in the `info` SSE event.
    """
    started_at = time.monotonic()

    redis_client = None
    if not emit_fn:
        redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    channel = f"{REDIS_CHANNEL_PREFIX}{pdf_hash}"

    async def emit(event_type: str, data: dict) -> None:
        if emit_fn:
            await emit_fn(event_type, data)
            return
        if redis_client:
            try:
                await redis_client.publish(channel, json.dumps({"type": event_type, **data}))
            except Exception as exc:
                logger.debug("SSE emit failed: %s", exc)

    try:
        await emit("info", {"parser": parser_used})
        await emit("run_started", {"run_id": str(run_id), "pipeline_version": "v4"})
        await emit("phase", {"phase": "extract"})

        # ── 1. Fetch PDF from Supabase Storage ────────────────────────────────
        from backend.services.parser.orchestrator import _fetch_pdf_bytes
        pdf_bytes = await _fetch_pdf_bytes(pdf_hash)
        if not pdf_bytes:
            raise ValueError("PDF not found in storage")

        # ── 2. Extract text (PyMuPDF, overridden per-page by odl_pages) ───────
        import fitz
        raw_slides: List[str] = []
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            for i, page in enumerate(doc):
                if odl_pages and (i + 1) in odl_pages:
                    raw_slides.append(odl_pages[i + 1].get("text", ""))
                else:
                    raw_slides.append(page.get_text("text") or "")

        total = len(raw_slides)
        logger.info("V4 pipeline: %d slides extracted for pdf_hash=%s", total, pdf_hash)

        # Emit pdf_hash so the frontend can call /attach-lecture after save
        await emit("meta", {"pdf_hash": pdf_hash})
        await emit("progress", {"current": total, "total": total, "message": f"Extracted {total} slides"})

        # ── 3. Lecture meta analysis ───────────────────────────────────────────
        await emit("phase", {"phase": "enhance"})
        await emit("progress", {"current": 0, "total": total, "message": "Analyzing lecture metadata..."})

        meta = await analyze_lecture_meta(raw_slides, ai_model)
        lecture_title = meta.get("title", "Untitled Lecture")
        lecture_summary = meta.get("summary", "")
        lecture_context = f"{lecture_title}: {lecture_summary}"

        # ── 4. Slide analysis — chunked parallel ───────────────────────────────
        # Chunks of QUIZ_BATCH_SIZE processed concurrently.
        # Between chunks, the last slide's aiInsight is passed as narrative
        # context so the professor-voice stays coherent.
        chunk_size = QUIZ_BATCH_CONFIG.batch_size  # default 8, env-configurable
        final_slides: List[Dict[str, Any]] = []
        ui_slides: List[Dict[str, Any]] = []        # for cache storage
        _embed_failed_queue: list = []
        _embed_sem = asyncio.Semaphore(3)
        previous_narrative = ""

        for chunk_start in range(0, total, chunk_size):
            chunk_end = min(chunk_start + chunk_size, total)
            chunk_indices = list(range(chunk_start, chunk_end))

            # Build context string for this chunk (carries last chunk's narrative)
            context_for_chunk = lecture_context
            if previous_narrative:
                context_for_chunk += f"\n\nIn the previous slide, you explained: {previous_narrative}"

            await emit("progress", {
                "current": chunk_start,
                "total": total,
                "message": f"Analyzing slides {chunk_start + 1}–{chunk_end}/{total}...",
            })

            # Fire all slides in this chunk concurrently
            tasks = [
                analyze_slide(i + 1, raw_slides[i], context_for_chunk, ai_model)
                for i in chunk_indices
            ]
            chunk_results = await asyncio.gather(*tasks, return_exceptions=True)

            for rel_idx, result in enumerate(chunk_results):
                i = chunk_indices[rel_idx]
                slide_num = i + 1

                if isinstance(result, Exception):
                    logger.error("Failed to analyze slide %d: %s", slide_num, result)
                    slide_data: Dict[str, Any] = {
                        "title": f"Slide {slide_num}",
                        "slideType": "text",
                        "aiInsight": "",
                        "contextNote": "",
                        "content": raw_slides[i],
                        "slide_index": i,
                    }
                else:
                    slide_data = result

                final_slides.append(slide_data)

                ui_slide = {
                    "title": slide_data.get("title", f"Slide {slide_num}"),
                    "content": slide_data.get("content", ""),
                    "summary": slide_data.get("aiInsight", ""),
                    "slide_type": slide_data.get("slideType", "text"),
                    "questions": [],
                }
                ui_slides.append(ui_slide)

                await emit("slide", {"index": i, "slide": ui_slide})
                await emit("progress", {
                    "current": i + 1,
                    "total": total,
                    "message": f"Analyzed {i + 1}/{total} slides",
                })

                # Fire-and-forget embedding for RAG/tutor
                asyncio.create_task(
                    _safe_embedding_task(i, ui_slide, pdf_hash, _embed_failed_queue, _embed_sem)
                )

            # Pass last slide's narrative to the next chunk
            last_result = chunk_results[-1]
            if isinstance(last_result, dict):
                previous_narrative = last_result.get("aiInsight", "")
            else:
                previous_narrative = ""

        # ── 5. Quiz generation ─────────────────────────────────────────────────
        await emit("progress", {"current": total, "total": total, "message": "Generating quiz questions..."})
        quiz_questions = await generate_quiz_questions(raw_slides, lecture_title, ai_model)

        await emit("phase", {"phase": "finalize"})

        deck_quiz_mapped: List[Dict[str, Any]] = []
        for q in quiz_questions:
            options = q.get("options", ["", "", "", ""])
            ans_str = q.get("correctAnswer", "")
            ans_idx = options.index(ans_str) if ans_str in options else 0
            # slideId is 1-based from LLM; frontend/embeddings use 0-based index
            slide_id_0 = max(0, int(q.get("slideId", 1)) - 1)
            deck_quiz_mapped.append({
                "question": q.get("question", ""),
                "options": options,
                "correctAnswer": ans_idx,
                "explanation": q.get("explanation", ""),
                "concept": q.get("difficulty", ""),
                "linked_slides": [slide_id_0],
            })

        await emit("deck_complete", {
            "deck_summary": lecture_summary,
            "deck_quiz": deck_quiz_mapped,
            "total_slides": total,
        })

        await emit("complete", {"total": total})

        # ── 6. Store result in parse cache ─────────────────────────────────────
        elapsed_ms = int((time.monotonic() - started_at) * 1000)
        cache_payload = {
            "slides": ui_slides,
            "deck_summary": lecture_summary,
            "deck_quiz": deck_quiz_mapped,
            "total": total,
            "parser": "v4",
            "ai_model": ai_model,
            "elapsed_ms": elapsed_ms,
        }
        try:
            await store_cached_parse(pdf_hash, cache_payload, parsing_mode="ai")
            logger.info(
                "V4 pipeline: cached result for pdf_hash=%s (%d slides, %dms)",
                pdf_hash, total, elapsed_ms,
            )
        except Exception as cache_exc:
            logger.warning("V4 pipeline: cache store failed (non-fatal): %s", cache_exc)

        return str(run_id)

    except Exception as exc:
        logger.exception("V4 pipeline failed for pdf_hash=%s: %s", pdf_hash, exc)
        await emit("error", {"message": str(exc)})
        raise
    finally:
        if redis_client:
            await redis_client.aclose()
