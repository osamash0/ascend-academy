"""Unified PDF ingestion pipeline (PARSER_VERSION=5).

Design
------
Simple, per-slide synthesis — the approach that produces the best learning
content (one focused LLM call per slide → real title + a rich "professor"
explanation), wrapped in a server-authoritative architecture:

  - PER-SLIDE synthesis: each slide is analyzed on its own (v4-style
    analyze_slide). A slide with extractable text is synthesized from text; a
    slide with (almost) no text is image-only and goes to the vision model.
    No batching — one slide failing never blanks the others.
  - Server-authoritative persistence: the pipeline writes lectures / slides /
    quiz_questions itself (via `persist`); the DB is the single source of truth.
  - Lecture-level: a title + summary (analyze_lecture_meta) and a deck-level
    quiz (generate_quiz_questions, answer-index validated via _map_deck_quiz).
  - Embeddings for the tutor; flat SSE the frontend already speaks
    (info / phase(extract|enhance|finalize) / meta / progress / slide /
    deck_complete / complete / error).

Run lifecycle / idempotency
---------------------------
`parse_runs` tracks the run (deduped on `(pdf_hash, "5")`). A re-enqueued run
that is already COMPLETED replays from the DB instead of creating a duplicate
lecture; a failed/partial run reuses its lecture and replaces its slides.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Awaitable, Callable, Dict, List, Optional
from uuid import UUID

import redis.asyncio as aioredis

from backend.core.config import settings
from backend.domain.parse_models import RunStatus
from backend.services.parser import repos, persist
from backend.services.parser.storage import _fetch_pdf_bytes

logger = logging.getLogger(__name__)

REDIS_CHANNEL_PREFIX = "parse:"
PIPELINE_VERSION_UNIFIED = "5"

# Below this many chars of extractable text, a slide is treated as image-only
# and routed to the vision model instead of text synthesis.
_MIN_TEXT_FOR_SYNTH = 25


def _clean_title(filename: str) -> str:
    base = os.path.basename(filename or "")
    if base.lower().endswith(".pdf"):
        base = base[:-4]
    return base.strip() or "Untitled Lecture"


def _first_line(text: str) -> str:
    for ln in (text or "").splitlines():
        s = ln.strip()
        if s:
            return s[:80]
    return ""


def _extract_pages(pdf_bytes: bytes, odl_pages: Optional[Dict[int, dict]] = None) -> List[str]:
    """Per-page text via PyMuPDF (or pre-extracted odl_pages when provided)."""
    import fitz
    pages: List[str] = []
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        for i, page in enumerate(doc):
            if odl_pages and (i + 1) in odl_pages:
                pages.append((odl_pages[i + 1] or {}).get("text", "") or "")
            else:
                pages.append(page.get_text("text") or "")
    return pages


def _render_page_jpeg(pdf_bytes: bytes, idx: int) -> bytes:
    import fitz
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        pix = doc[idx].get_pixmap(matrix=fitz.Matrix(2, 2))
        return pix.tobytes("jpeg")


async def _synthesize_slide(
    idx: int, text: str, lecture_context: str, ai_model: str, pdf_bytes: bytes
) -> Dict[str, str]:
    """One slide → {title, content, summary, slide_type}. Text-based synthesis
    when the slide has text; vision when it's image-only. Never raises."""
    text = text or ""
    if len(text.strip()) >= _MIN_TEXT_FOR_SYNTH:
        from backend.services.parser.synthesis import analyze_slide
        res = await analyze_slide(idx + 1, text, lecture_context, ai_model)
        if not isinstance(res, dict):
            res = {}
        return {
            "title": (res.get("title") or "").strip(),
            "content": text,
            "summary": (res.get("aiInsight") or "").strip(),
            "slide_type": res.get("slideType") or "text",
        }
    # Image-only slide → render + vision.
    try:
        import base64
        from backend.services.ai.vision import analyze_slide_vision, format_slide_content
        img = await asyncio.to_thread(_render_page_jpeg, pdf_bytes, idx)
        vres = await analyze_slide_vision(
            base64.b64encode(img).decode(), text, settings.vision_model, lecture_context
        )
        ce = (vres.get("content_extraction") or {}) if isinstance(vres, dict) else {}
        content = format_slide_content(ce) or text
        summary = (ce.get("summary") or "").strip()
        if not summary:
            kps = ce.get("key_points") or []
            summary = " ".join(str(k) for k in kps) if kps else content
        return {
            "title": ((vres.get("metadata") or {}).get("lecture_title") or ce.get("main_topic") or "").strip(),
            "content": content,
            "summary": summary,
            "slide_type": vres.get("slide_type") or "image-only",
        }
    except Exception as exc:
        logger.warning("vision synth slide %d failed: %s", idx, exc)
        return {"title": "", "content": text, "summary": "", "slide_type": "image-only"}


async def _store_lecture_pdf(lecture_id: UUID, filename: str, pdf_bytes: bytes) -> Optional[str]:
    """Upload the source PDF to the lecture-pdfs bucket at the path the lecture
    viewer resolves (``lectures/{id}/{name}``). Non-fatal."""
    name = os.path.basename(filename or "lecture.pdf") or "lecture.pdf"
    path = f"lectures/{lecture_id}/{name}"

    def _upload() -> None:
        from backend.core.database import get_client
        sb = get_client(use_admin=True)
        sb.storage.from_("lecture-pdfs").upload(
            path, pdf_bytes,
            file_options={"content-type": "application/pdf", "upsert": "true"},
        )

    try:
        await asyncio.to_thread(_upload)
        return path
    except Exception as exc:
        logger.warning("lecture PDF storage upload failed (non-fatal): %s", exc)
        return None


async def parse_pdf_unified(
    ctx: dict,
    *,
    pdf_hash: str,
    lecture_id: str = "",
    run_id: Optional[str] = None,
    ai_model: str = "cerebras",
    user_id: Optional[str] = None,
    emit_fn: Optional[Callable[[str, dict], Awaitable[None]]] = None,
    odl_pages: Optional[Dict[int, dict]] = None,
    filename: str = "upload.pdf",
    parser_used: str = "unified",
    force_reparse: bool = False,
    parsing_mode: str = "ai",
    batch_id: Optional[str] = None,
    course_id: Optional[str] = None,
    visibility: str = "course",
    student_owner_id: Optional[str] = None,
) -> str:
    """Unified parse pipeline entry point (Arq job or inline).

    When ``force_reparse`` is True, a COMPLETED run is NOT replayed from the DB;
    the pipeline re-parses and reuses the existing lecture (same lecture_id, so
    student links/progress survive). This is the user's escape hatch for a stale
    parse — including switching parser or parsing_mode on the same PDF.

    ``batch_id``/``course_id`` (Phase 1, course-at-once ingestion) let a
    multi-file upload assign the course server-side at parse time, so a batch
    is fully detached — no client-side wizard step is required to finish it.

    ``visibility``/``student_owner_id`` (Roadmap 3.1, "My Materials") route a
    private student upload instead of a professor's lecture. Private uploads
    use a distinct ``pipeline_version`` namespace (see below) so they never
    collide with — or silently replay into — someone else's `parse_runs` row
    for the same `pdf_hash`. Known v1 scope cut: unlike the professor path,
    two different owners uploading byte-identical PDF content each pay their
    own full parse (no cross-owner sharing) — `slide_embeddings.lecture_id` is
    a single-column backfill keyed by pdf_hash (see `attach_lecture_id_to_
    embeddings`), so sharing one parse across owners would silently reassign
    embeddings to whichever owner parsed last. Fixing that is a prerequisite
    for cross-owner dedupe and is out of scope here.
    """
    pipeline_version = (
        f"{PIPELINE_VERSION_UNIFIED}-student" if visibility == "private_student" else PIPELINE_VERSION_UNIFIED
    )
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

    # Accumulators declared before `try` so the except path can finalize.
    run_uuid: Optional[UUID] = None
    created_lecture_id: Optional[UUID] = None
    slide_db_ids: Dict[int, UUID] = {}
    deck_summary = ""

    try:
        await emit("info", {"parser": parser_used})

        run = await repos.get_or_create_run(
            pdf_hash, None, pipeline_version,
            batch_id=UUID(batch_id) if batch_id else None,
            user_id=UUID(user_id) if user_id else None,
            course_id=UUID(course_id) if course_id else None,
            filename=filename,
        )
        run_uuid = run.run_id
        existing_lecture_id = run.lecture_id  # set by a prior (partial) attempt

        # ── Idempotent replay: a completed run never re-parses ───────────────
        # …unless the caller forced a re-parse, in which case we fall through and
        # rebuild the existing lecture in place (step 3 reuses existing_lecture_id).
        if run.status == RunStatus.COMPLETED and existing_lecture_id and not force_reparse:
            await _replay_from_db(existing_lecture_id, pdf_hash, emit)
            return str(run_uuid)

        await repos.set_status(run_uuid, RunStatus.EXTRACTING)

        pdf_bytes = await _fetch_pdf_bytes(pdf_hash)
        if not pdf_bytes:
            raise ValueError("PDF not found in storage")

        owner = UUID(user_id) if user_id else None
        if owner is None:
            raise ValueError("parse_pdf_unified requires user_id (lectures.professor_id/student_owner_id is required)")

        # ── 1. Extract text per page ─────────────────────────────────────────
        await emit("phase", {"phase": "extract"})
        raw_slides = await asyncio.to_thread(_extract_pages, pdf_bytes, odl_pages)
        total = len(raw_slides)
        await emit("progress", {"current": total, "total": total, "message": f"Extracted {total} slides"})

        # ``on_demand`` (Skip AI): persist raw extracted slides with no LLM
        # synthesis, quizzes, or deck summary; the editor enhances them later.
        ai_mode = parsing_mode != "on_demand"

        # ── 2. Lecture-level analysis (title + summary) ──────────────────────
        await emit("phase", {"phase": "enhance"})
        await emit("progress", {"current": 0, "total": total, "message": "Analyzing lecture…"})
        if ai_mode:
            from backend.services.parser.synthesis import analyze_lecture_meta
            try:
                meta = await analyze_lecture_meta(raw_slides, ai_model)
            except Exception as exc:
                logger.warning("lecture meta failed (non-fatal): %s", exc)
                meta = {}
        else:
            meta = {}
        lecture_title = (meta.get("title") or "").strip() or _clean_title(filename)
        deck_summary = (meta.get("summary") or "").strip()
        lecture_context = f"{lecture_title}: {deck_summary}"

        # ── 3. Create / reuse the lecture row (server-authoritative) ─────────
        course_uuid = UUID(course_id) if course_id else None
        if existing_lecture_id:
            created_lecture_id = existing_lecture_id
            await persist.clear_lecture_content(created_lecture_id)
            await persist.set_lecture_title(created_lecture_id, lecture_title)
            if course_uuid is not None:
                await persist.set_course_id(created_lecture_id, course_uuid)
        else:
            if visibility == "private_student":
                created_lecture_id = await persist.create_lecture(
                    title=lecture_title, pdf_hash=pdf_hash,
                    visibility=visibility, student_owner_id=owner,
                )
            else:
                created_lecture_id = await persist.create_lecture(
                    title=lecture_title, professor_id=owner, pdf_hash=pdf_hash,
                    course_id=course_uuid,
                )
            await persist.set_run_lecture(run_uuid, created_lecture_id)
        pdf_path = await _store_lecture_pdf(created_lecture_id, filename, pdf_bytes)
        if pdf_path:
            await persist.set_lecture_pdf_url(created_lecture_id, pdf_path)
        await emit("meta", {"pdf_hash": pdf_hash, "lecture_id": str(created_lecture_id)})

        # ── 4. Per-slide synthesis (chunked-parallel; narrative carries over) ─
        from backend.services.ai.orchestrator import QUIZ_BATCH_CONFIG
        from backend.services.file_parse_service import _safe_embedding_task
        chunk_size = max(1, QUIZ_BATCH_CONFIG.batch_size)
        embed_q: list = []
        embed_sem = asyncio.Semaphore(3)
        previous_narrative = ""

        for chunk_start in range(0, total, chunk_size):
            chunk_end = min(chunk_start + chunk_size, total)
            ctx_for_chunk = lecture_context
            if previous_narrative:
                ctx_for_chunk += f"\n\nIn the previous slide, you explained: {previous_narrative}"
            await emit("progress", {
                "current": chunk_start, "total": total,
                "message": (f"Analyzing slides {chunk_start + 1}–{chunk_end}/{total}…"
                            if ai_mode else f"Importing slides {chunk_start + 1}–{chunk_end}/{total}…"),
            })
            if ai_mode:
                results = await asyncio.gather(*[
                    _synthesize_slide(i, raw_slides[i], ctx_for_chunk, ai_model, pdf_bytes)
                    for i in range(chunk_start, chunk_end)
                ], return_exceptions=True)
            else:
                # Skip AI: raw text only, no LLM. Title = first line / fallback.
                results = [
                    {"title": _first_line(raw_slides[i]), "content": raw_slides[i],
                     "summary": "", "slide_type": "text"}
                    for i in range(chunk_start, chunk_end)
                ]

            for rel, res in enumerate(results):
                i = chunk_start + rel
                if isinstance(res, Exception) or not isinstance(res, dict):
                    logger.error("slide %d synthesis failed: %s", i, res)
                    res = {"content": raw_slides[i], "summary": "", "slide_type": "text"}
                title = (res.get("title") or "").strip() or _first_line(raw_slides[i]) or f"Slide {i + 1}"
                ui_slide = {
                    "title": title,
                    "content": res.get("content", raw_slides[i]) or "",
                    "summary": res.get("summary", "") or "",
                    "slide_type": res.get("slide_type", "text"),
                    "questions": [],
                    "ai_enhanced": ai_mode,
                }
                if created_lecture_id is not None:
                    try:
                        sid = await persist.insert_slide(
                            created_lecture_id, i, ui_slide,
                            ai_enhanced=ai_mode,
                            parser_engine="unified" if ai_mode else "heuristic-v1",
                        )
                        slide_db_ids[i] = sid
                    except Exception as exc:
                        logger.error("persist slide %d failed: %s", i, exc)
                asyncio.create_task(_safe_embedding_task(i, ui_slide, pdf_hash, embed_q, embed_sem))
                await emit("slide", {"index": i, "slide": ui_slide})
                await emit("progress", {"current": i + 1, "total": total, "message": f"Analyzed {i + 1}/{total}"})

            last = results[-1] if results else None
            previous_narrative = last.get("summary", "") if isinstance(last, dict) else ""

        # ── 5. Deck-level quiz (AI mode only) ────────────────────────────────
        deck_quiz = []
        if ai_mode:
            await emit("progress", {"current": total, "total": total, "message": "Generating quiz…"})
            from backend.services.parser.synthesis import generate_quiz_questions, _map_deck_quiz
            try:
                deck_quiz = _map_deck_quiz(await generate_quiz_questions(raw_slides, lecture_title, ai_model))
            except Exception as exc:
                logger.warning("deck quiz failed (non-fatal): %s", exc)
                deck_quiz = []

        # ── 6. Finalize + persist deck quiz ──────────────────────────────────
        await emit("phase", {"phase": "finalize"})
        total_persisted = len(slide_db_ids)
        if created_lecture_id is not None:
            try:
                await persist.insert_deck_quizzes(created_lecture_id, slide_db_ids, deck_quiz)
                await persist.finalize_lecture(created_lecture_id, deck_summary, total_persisted)
            except Exception as exc:
                logger.error("deck/finalize persist failed: %s", exc)
            # Roadmap Phase 1.1 (review engine): generate spaced-repetition
            # cards from this lecture's quiz questions. Best-effort — never
            # blocks parse completion. Off by default (FEATURE_REVIEW_ENGINE).
            if settings.feature_review_engine:
                try:
                    redis_pool = ctx.get("redis")
                    if redis_pool:
                        await redis_pool.enqueue_job("generate_review_cards", lecture_id=str(created_lecture_id))
                    else:
                        from backend.services.upload_service import get_arq_pool
                        pool = await get_arq_pool()
                        await pool.enqueue_job("generate_review_cards", lecture_id=str(created_lecture_id))
                except Exception as exc:
                    logger.warning("review card-factory enqueue failed (non-fatal): %s", exc)
            # Attach embeddings (written keyed by pdf_hash) to this lecture.
            try:
                from backend.services.cache import attach_lecture_id_to_embeddings
                await attach_lecture_id_to_embeddings(pdf_hash, str(created_lecture_id))
            except Exception as exc:
                logger.warning("attach embeddings failed (non-fatal): %s", exc)
        await emit("deck_complete", {
            "deck_summary": deck_summary, "deck_quiz": deck_quiz, "total_slides": total_persisted,
        })

        await repos.set_status(run_uuid, RunStatus.COMPLETED)
        await emit("complete", {"total": total_persisted})
        return str(run_uuid)

    except Exception as exc:
        logger.exception("Unified pipeline failed for pdf_hash=%s: %s", pdf_hash, exc)
        try:
            if run_uuid is not None:
                if created_lecture_id is not None and slide_db_ids:
                    await persist.finalize_lecture(created_lecture_id, deck_summary, len(slide_db_ids))
                await repos.set_error(run_uuid, str(exc))
        except Exception:
            pass
        try:
            await emit("error", {"message": str(exc)})
        except Exception:
            pass
        raise
    finally:
        if redis_client:
            await redis_client.aclose()


async def _replay_from_db(
    lecture_id: UUID,
    pdf_hash: str,
    emit: Callable[[str, dict], Awaitable[None]],
) -> None:
    """Replay a completed run's slides/deck from the DB (no re-parse)."""
    data = await persist.fetch_lecture_for_replay(lecture_id)
    slides = data["slides"]
    total = len(slides)
    await emit("phase", {"phase": "extract"})
    await emit("meta", {"pdf_hash": pdf_hash, "lecture_id": str(lecture_id)})
    await emit("progress", {"current": 0, "total": total, "message": "Loading from saved course…"})
    for s in slides:
        await emit("slide", {"index": s["index"], "slide": s})
    await emit("phase", {"phase": "finalize"})
    await emit("deck_complete", {"deck_summary": data["deck_summary"], "deck_quiz": [], "total_slides": total})
    await emit("complete", {"total": total})
