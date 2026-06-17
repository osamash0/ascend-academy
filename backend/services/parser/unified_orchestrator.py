"""Unified PDF ingestion pipeline (PARSER_VERSION=5).

Design
------
This orchestrator does NOT reimplement extraction. It *composes* the tested v2
engine (`file_parse_service.parse_pdf_stream` — layout routing, OCR fallback,
VLM vision, overlapping-window text batching, blueprint coherence, preflight
quota guard) and adds the two things v4 fundamentally lacked:

  1. Server-authoritative persistence — the pipeline writes `lectures`,
     `slides`, `quiz_questions` itself (via `persist`), so the database is the
     single source of truth. The frontend no longer persists parse output.
  2. Real-world PDF handling — it runs the engine with a vision-capable model
     (`settings.vision_model`) so image/scanned/PowerPoint slides actually
     route to vision/OCR and get real content instead of hallucinated text.

It re-emits the engine's events over Redis (or an inline `emit_fn`) in the
FLAT shape the frontend already speaks: `info / phase(extract|enhance|finalize)
/ meta / progress / slide / deck_complete / complete / error`.

Run lifecycle / idempotency
---------------------------
`parse_runs` tracks the run (deduped on `(pdf_hash, "5")`). A re-enqueued run
that is already COMPLETED replays from the DB instead of creating a duplicate
lecture. Per-page resume is inherited from v2's `slide_parse_cache` checkpoint.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Awaitable, Callable, Dict, List, Optional
from uuid import UUID

import redis.asyncio as aioredis

from backend.core.config import settings
from backend.domain.parse_models import RunStatus
from backend.services.parser import repos, persist
from backend.services.parser.orchestrator import _fetch_pdf_bytes

logger = logging.getLogger(__name__)

REDIS_CHANNEL_PREFIX = "parse:"
PIPELINE_VERSION_UNIFIED = "5"


def _clean_title(filename: str) -> str:
    base = os.path.basename(filename or "")
    if base.lower().endswith(".pdf"):
        base = base[:-4]
    return base.strip() or "Untitled Lecture"


async def _store_lecture_pdf(lecture_id: UUID, filename: str, pdf_bytes: bytes) -> Optional[str]:
    """Upload the source PDF to the lecture-pdfs bucket at the path the lecture
    viewer resolves (``lectures/{id}/{name}``) and return that storage path.

    Non-fatal: on failure the lecture simply has no source PDF (pdf_url stays
    NULL → viewer shows "No source PDF" rather than a broken render).
    """
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
) -> str:
    """Unified parse pipeline entry point (Arq job or inline).

    Args:
        ctx:         Arq worker context (signature compat).
        pdf_hash:    SHA-256 of the PDF bytes (storage lookup + run key).
        lecture_id:  Ignored for new parses (the pipeline creates the lecture);
                     accepted for API compatibility with the v4 job.
        run_id:      Optional run identifier (not required — the run is keyed by
                     (pdf_hash, pipeline_version)).
        ai_model:    Bulk text model hint (the vision model is resolved
                     separately from settings.vision_model).
        user_id:     Authenticated uploader — becomes lectures.professor_id.
        emit_fn:     Optional async callable(event_type, data) for inline/test
                     runs. When None, events are published to the Redis channel.
        odl_pages:   Pre-extracted page dict (LlamaParse/MinerU/ODL), 1-based.
        filename:    Original filename (seeds the lecture title).
        parser_used: Label reported in the `info` SSE event.
    """
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

        run = await repos.get_or_create_run(pdf_hash, None, PIPELINE_VERSION_UNIFIED)
        run_uuid = run.run_id
        existing_lecture_id = run.lecture_id  # set by a prior (partial) attempt

        # ── Idempotent replay: a completed run never re-parses ───────────────
        if run.status == RunStatus.COMPLETED and existing_lecture_id:
            await _replay_from_db(existing_lecture_id, pdf_hash, emit)
            return str(run_uuid)

        await repos.set_status(run_uuid, RunStatus.EXTRACTING)

        pdf_bytes = await _fetch_pdf_bytes(pdf_hash)
        if not pdf_bytes:
            raise ValueError("PDF not found in storage")

        owner = UUID(user_id) if user_id else None
        if owner is None:
            raise ValueError("parse_pdf_unified requires user_id (lectures.professor_id is NOT NULL)")

        deck_quiz: List[dict] = []
        total = 0

        # Imported here to keep worker cold-start cheap (fitz/PIL/LLM clients).
        from backend.services.file_parse_service import parse_pdf_stream

        # Decouple models: the fast bulk model handles text slides + deck
        # summary/quiz, while the vision-capable model handles only image/
        # diagram slides — so images get real content (not the v4 empty-text
        # hallucination) without paying the vision model's cost on every slide.
        async for event in parse_pdf_stream(
            pdf_bytes,
            filename=filename,
            ai_model=ai_model,
            vision_model=settings.vision_model,
            use_blueprint=True,
            odl_pages=odl_pages,
            parsing_mode="ai",
        ):
            etype = event.get("type")
            payload = {k: v for k, v in event.items() if k != "type"}

            if etype == "meta":
                if existing_lecture_id:
                    # Resuming a prior (failed/partial) run — reuse its lecture
                    # and clear stale slides so the re-parse is idempotent
                    # (exactly one lecture row per PDF, no duplicates).
                    created_lecture_id = existing_lecture_id
                    await persist.clear_lecture_content(created_lecture_id)
                else:
                    created_lecture_id = await persist.create_lecture(
                        title=_clean_title(filename),
                        professor_id=owner,
                        pdf_hash=pdf_hash,
                    )
                    await persist.set_run_lecture(run_uuid, created_lecture_id)
                # Store the source PDF in the bucket the lecture viewer reads
                # (lecture-pdfs) so "Original Source Material" renders. Non-fatal.
                pdf_path = await _store_lecture_pdf(created_lecture_id, filename, pdf_bytes)
                if pdf_path:
                    await persist.set_lecture_pdf_url(created_lecture_id, pdf_path)
                await emit("meta", {"pdf_hash": pdf_hash, "lecture_id": str(created_lecture_id)})

            elif etype == "slide":
                idx = event.get("index")
                slide = event.get("slide", {}) or {}
                if created_lecture_id is not None and isinstance(idx, int):
                    try:
                        sid = await persist.insert_slide(created_lecture_id, idx, slide)
                        slide_db_ids[idx] = sid
                        await persist.insert_slide_quizzes(sid, slide.get("questions", []))
                    except Exception as exc:
                        logger.error("Failed to persist slide %s: %s", idx, exc)
                await emit("slide", {"index": idx, "slide": slide})

            elif etype == "deck_complete":
                deck_summary = event.get("deck_summary", "") or ""
                deck_quiz = event.get("deck_quiz", []) or []
                total = len(slide_db_ids)
                if created_lecture_id is not None:
                    try:
                        await persist.insert_deck_quizzes(created_lecture_id, slide_db_ids, deck_quiz)
                        await persist.finalize_lecture(created_lecture_id, deck_summary, total)
                    except Exception as exc:
                        logger.error("Failed to persist deck/finalize lecture: %s", exc)
                await emit("deck_complete", {
                    "deck_summary": deck_summary,
                    "deck_quiz": deck_quiz,
                    "total_slides": total,
                })

            elif etype == "complete":
                total = event.get("total", total) or total
                # Embeddings were written by the engine with lecture_id=None;
                # attach the created lecture so the tutor can scope retrieval.
                if created_lecture_id is not None:
                    try:
                        from backend.services.cache import attach_lecture_id_to_embeddings
                        await attach_lecture_id_to_embeddings(pdf_hash, str(created_lecture_id))
                    except Exception as exc:
                        logger.warning("attach embeddings failed (non-fatal): %s", exc)
                await repos.set_status(run_uuid, RunStatus.COMPLETED)
                await emit("complete", {"total": total})

            elif etype == "error":
                # Slides persisted before the failure are still usable — record
                # the count so the lecture isn't left with total_slides=0.
                if created_lecture_id is not None and slide_db_ids:
                    await persist.finalize_lecture(created_lecture_id, deck_summary, len(slide_db_ids))
                await repos.set_error(run_uuid, event.get("message", "parse error"))
                await emit("error", payload)
                return str(run_uuid)

            elif etype == "partial_complete":
                # Frontend ignores this; log for observability only.
                logger.warning("Unified parse partial_complete: %s", payload)

            else:
                # phase / progress / anything else — forward verbatim (flat).
                await emit(etype, payload)

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
