"""Parser v3 orchestrator — Arq job target.

This is the single function Arq workers execute. It wires all five stages
together and publishes SSE-compatible events to a Redis pub/sub channel so
the FastAPI SSE endpoint can forward them to the client in real-time.

Idempotency / resume contract:
  - Stage 1 (extract): re-runs for any page still in PENDING status.
  - Stage 2 (outline): skipped if parse_runs.outline IS NOT NULL.
  - Stage 3 (generate): re-runs for any page not yet ANALYZED.
  - Stage 4 (embed): upserts, so safe to re-run.
  - Stage 5 (finalize): re-runs only if run is not yet COMPLETED.

Enqueueing the same (pdf_hash, lecture_id) twice is safe — the second job will
either find the run already COMPLETED and replay from DB, or resume from the
lowest incomplete stage.
"""
from __future__ import annotations

import gc
import json
import logging
from hashlib import sha256
from typing import Optional
from uuid import UUID

import redis.asyncio as aioredis

from backend.core.config import settings
from backend.core.database import get_client
from backend.domain.parse_models import PIPELINE_VERSION, RunStatus
from backend.services.parser import repos
from backend.services.parser.stage1_ingest import ingest
from backend.services.parser.stage2_synthesize import synthesize
from backend.services.parser.stage3_generate import generate
from backend.services.parser.stage4_embed import embed
from backend.services.parser.stage5_finalize import finalize
from backend.services.pdf_reader import PDFReader

logger = logging.getLogger(__name__)

REDIS_CHANNEL_PREFIX = "parse:"


# ── Entry point (Arq job) ─────────────────────────────────────────────────────


async def parse_pdf(
    ctx: dict,
    *,
    pdf_hash: str,
    lecture_id: str,
    run_id: Optional[str] = None,
) -> str:
    """Main pipeline Arq job.

    Args:
        ctx: Arq context dict (contains ctx["redis"] for the Arq Redis conn).
        pdf_hash: SHA-256 of the PDF bytes.
        lecture_id: UUID string of the associated lecture row.
        run_id: Optional pre-created run UUID (passed from upload.py).

    Returns:
        The run_id UUID string.
    """
    lecture_uuid = UUID(lecture_id)

    # Set up Redis pub/sub for SSE broadcasting
    redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    channel = f"{REDIS_CHANNEL_PREFIX}{pdf_hash}"

    async def emit(event_type: str, data: dict) -> None:
        try:
            await redis_client.publish(channel, json.dumps({"type": event_type, "data": data}))
        except Exception as e:
            logger.debug("SSE emit failed (non-fatal): %s", e)

    try:
        # ── Stage 0+1: register / get run ─────────────────────────────────────
        run = await repos.get_or_create_run(pdf_hash, lecture_uuid, PIPELINE_VERSION)
        current_run_id = run.run_id

        if run.status == RunStatus.COMPLETED:
            await emit("already_complete", {"run_id": str(current_run_id)})
            return str(current_run_id)

        await emit("run_started", {"run_id": str(current_run_id), "pipeline_version": PIPELINE_VERSION})

        # Fetch PDF bytes from Supabase Storage
        pdf_bytes = await _fetch_pdf_bytes(pdf_hash)
        if not pdf_bytes:
            await repos.set_error(current_run_id, f"PDF not found in storage: {pdf_hash}")
            await emit("error", {"message": "PDF not found in storage"})
            return str(current_run_id)

        reader = PDFReader(pdf_bytes)

        # ── Stage 1: Extract + classify ────────────────────────────────────────
        await repos.set_status(current_run_id, RunStatus.EXTRACTING)
        await emit("phase", {"phase": "extract"})

        # Only process pending pages (idempotent resume)
        pending_count = len(await repos.list_pending_pages(current_run_id))
        page_count = await reader.get_page_count()

        if pending_count > 0 or (await repos.get_run_by_id(current_run_id)).page_count is None:
            extracted = await ingest(pdf_bytes, current_run_id, reader, emit=emit)
        else:
            extracted = await repos.get_extracted_pages(current_run_id)

        gc.collect()

        # ── Stage 2: Outline ───────────────────────────────────────────────────
        await repos.set_status(current_run_id, RunStatus.OUTLINING)
        await emit("phase", {"phase": "outline"})

        outline = await synthesize(extracted, current_run_id, emit=emit)

        # ── Stage 3: Per-slide AI generation ──────────────────────────────────
        await repos.set_status(current_run_id, RunStatus.ANALYZING)
        await emit("phase", {"phase": "analyze"})

        # Skip pages already analyzed (resume support)
        analyzed_count = page_count - len(await repos.list_unanalyzed_pages(current_run_id))
        if analyzed_count < page_count:
            unanalyzed_indices = set(await repos.list_unanalyzed_pages(current_run_id))
            pages_to_analyze = [p for p in extracted if p.page_index in unanalyzed_indices]
            slides = await generate(pages_to_analyze, outline, current_run_id, lecture_uuid, emit=emit)
            # Merge with already-analyzed slides for stages 4+5
            completed_pages = await repos.get_completed_pages(current_run_id)
            slides_by_idx = {s.page_index: s for s in completed_pages}
            slides = [slides_by_idx[i] for i in sorted(slides_by_idx)]
        else:
            slides = await repos.get_completed_pages(current_run_id)

        # ── Stage 4: Embed ─────────────────────────────────────────────────────
        await repos.set_status(current_run_id, RunStatus.EMBEDDING)
        await emit("phase", {"phase": "embed"})
        await embed(lecture_uuid, current_run_id, slides, emit=emit)

        # ── Stage 5: Finalize ──────────────────────────────────────────────────
        await repos.set_status(current_run_id, RunStatus.FINALIZING)
        await emit("phase", {"phase": "finalize"})
        await finalize(lecture_uuid, current_run_id, outline, slides, emit=emit)

        await emit("complete", {"run_id": str(current_run_id), "total": len(slides)})
        return str(current_run_id)

    except Exception as e:
        logger.exception("Pipeline failed for pdf_hash=%s: %s", pdf_hash, e)
        try:
            run = await repos.get_or_create_run(pdf_hash, lecture_uuid, PIPELINE_VERSION)
            await repos.set_error(run.run_id, str(e))
            await emit("error", {"message": str(e)})
        except Exception:
            pass
        raise
    finally:
        await redis_client.aclose()


# ── Storage helper ────────────────────────────────────────────────────────────
# Relocated to backend/services/parser/storage.py; re-exported here for the
# legacy v3/v4 orchestrators until they are archived.
from backend.services.parser.storage import _fetch_pdf_bytes  # noqa: E402,F401
