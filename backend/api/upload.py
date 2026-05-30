import logging
import json
import asyncio
from typing import Any, List, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Form, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from backend.services.file_parse_service import (
    PIPELINE_VERSION,
    parse_pdf_stream,
    import_pdf_lazy,
    _safe_embedding_task,
)
from backend.services.slide_synth_service import (
    PIPELINE_VERSION as LAZY_PIPELINE_VERSION,
    synthesize_slide,
)
from backend.core.database import supabase_admin, get_client
from backend.services.cache import (
    attach_lecture_id_to_embeddings,
    compute_pdf_hash,
    get_cached_parse,
    get_cached_parse_meta,
    get_cached_slide_results,
    get_pipeline_run,
    purge_expired_slide_checkpoints,
    store_cached_parse,
)
from backend.services.diagnostics import flag_suspicious
from backend.core.auth_middleware import verify_token, require_professor
from backend.core.rate_limit import limiter
from backend.repositories.lecture_repo import list_lectures_by_pdf_hash

# ── v3 pipeline ───────────────────────────────────────────────────────────────
_arq_pool = None


async def _get_arq_pool():
    global _arq_pool
    if _arq_pool is None:
        from arq.connections import create_pool, RedisSettings
        from backend.core.config import settings
        _arq_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    return _arq_pool


async def _upload_pdf_to_storage(pdf_hash: str, content: bytes) -> None:
    """Upload PDF bytes to Supabase Storage keyed by sha256 (idempotent)."""
    path = f"{pdf_hash}.pdf"
    try:
        sb = get_client(use_admin=True)
        sb.storage.from_("pdf-uploads").upload(
            path,
            content,
            file_options={"content-type": "application/pdf", "upsert": "true"},
        )
    except Exception as e:
        if "Bucket not found" in str(e):
            try:
                sb = get_client(use_admin=True)
                sb.storage.create_bucket("pdf-uploads", options={"public": False})
                sb.storage.from_("pdf-uploads").upload(
                    path,
                    content,
                    file_options={"content-type": "application/pdf", "upsert": "true"},
                )
                return
            except Exception as create_e:
                logger.warning("Failed to create pdf-uploads bucket: %s", create_e)
        logger.warning("PDF storage upload failed for %s: %s — worker will retry", pdf_hash, e)


async def _v3_sse_stream(pdf_hash: str, run_id: str):
    """Async generator that subscribes to Redis pub/sub and forwards SSE events.

    Replays already-completed slides first (handles client reconnect), then
    listens for new events until the pipeline completes or errors.
    """
    import redis.asyncio as aioredis
    from backend.core.config import settings
    from backend.services.parser import repos
    from backend.domain.parse_models import RunStatus, PIPELINE_VERSION

    redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    channel = f"parse:{pdf_hash}"

    try:
        async with redis_client.pubsub() as pubsub:
            await pubsub.subscribe(channel)

            # Replay already-analyzed slides before listening for new ones
            try:
                from uuid import UUID
                run = await repos.get_run_by_id(UUID(run_id))
                if run:
                    completed = await repos.get_completed_pages(run.run_id)
                    for slide in completed:
                        yield f"data: {json.dumps({'type': 'slide_ready', 'data': slide.model_dump()})}\n\n"
                    if run.status == RunStatus.COMPLETED:
                        yield f"data: {json.dumps({'type': 'complete', 'data': {'run_id': run_id}})}\n\n"
                        return
            except Exception as e:
                logger.warning("v3 SSE replay failed: %s", e)

            # Listen for new events from the worker
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    event = json.loads(message["data"])
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("type") in ("complete", "error", "deck_complete"):
                        if event.get("type") in ("complete", "error"):
                            break
                except Exception:
                    continue
    finally:
        await redis_client.aclose()

logger = logging.getLogger(__name__)

# Constants
MAX_FILE_MB = 25
MAX_PAGES = 300

# --- Pydantic Models for Input/Output Validation ---

class SlideMetadata(BaseModel):
    filename: str
    page: int
    type: str
    tokens: int
    parse_time_ms: int

class SlideResponse(BaseModel):
    title: str
    content: str
    summary: str
    questions: List[Dict[str, Any]]
    slide_index: int
    _meta: SlideMetadata

class ParsedSlideBatchResponse(BaseModel):
    slides: List[SlideResponse]
    total: int

# --- Helper Functions ---

async def validate_upload(file: UploadFile, content: bytes) -> int:
    """
    Validates the uploaded PDF file.
    Returns the page count if valid, otherwise raises HTTPException.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    if len(content) > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_FILE_MB}MB limit.")

    if len(content) < 8:
        raise HTTPException(status_code=400, detail="File is too small to be a valid PDF.")

    def _get_info():
        try:
            import fitz
            with fitz.open(stream=content, filetype="pdf") as doc:
                return len(doc)
        except Exception:
            return -1

    page_count = await asyncio.wait_for(asyncio.to_thread(_get_info), timeout=30.0)
    
    if page_count == -1:
        raise HTTPException(status_code=400, detail="File appears to be corrupted or password-protected.")
    if page_count == 0:
        raise HTTPException(status_code=400, detail="PDF has no pages.")
    if page_count > MAX_PAGES:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_PAGES} pages supported. This file has {page_count}.")
        
    return page_count

# --- API Router ---

router = APIRouter(prefix="/api/upload", tags=["upload"])

@router.post("/parse-pdf-stream")
@limiter.limit("5/minute")
async def parse_pdf_stream_endpoint(
    request: Request,
    file: UploadFile = File(...),
    ai_model: str = Form("cerebras"),
    use_blueprint: bool = Form(True),
    force_reparse: bool = Form(False),
    parsing_mode: str = Form("ai"),
    parser: str = Form("auto"),
    lecture_id: Optional[str] = Form(None),
    user: Any = Depends(require_professor),
):
    """
    Streamed PDF parsing endpoint.
    1. Validates upload.
    2. Checks semantic cache.
    3. Streams real-time progress and slide objects via SSE.
    """
    max_bytes = MAX_FILE_MB * 1024 * 1024
    chunks: List[bytes] = []
    bytes_read = 0
    while True:
        chunk = await file.read(65536)
        if not chunk:
            break
        bytes_read += len(chunk)
        if bytes_read > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds the {MAX_FILE_MB}MB limit.",
            )
        chunks.append(chunk)
    content = b"".join(chunks)
    page_count = await validate_upload(file, content)

    filename = file.filename or "upload.pdf"
    pdf_hash = compute_pdf_hash(content)

    # Sanitize parsing_mode early so an unrecognized value can't bypass
    # the cache namespace. Anything other than "on_demand" falls back to
    # the default AI pipeline.
    parsing_mode = parsing_mode if parsing_mode in {"ai", "on_demand"} else "ai"

    # 1. Check cache (skipped when the user explicitly opts to re-parse a
    #    PDF they've already uploaded — the duplicate dialog uses this to
    #    guarantee a genuinely fresh parse for the "Upload as new" choice).
    cached = None if force_reparse else await get_cached_parse(pdf_hash, parsing_mode=parsing_mode)
    
    if cached:
        from backend.core.config import settings as _cfg
        cached_parser = cached.get("parser") or "pymupdf"
        
        # Determine requested parser family
        requested_parser = parser
        if parser == "auto":
            if str(_cfg.parser_version) == "4":
                requested_parser = "v4"
            elif str(_cfg.parser_version) == "3":
                requested_parser = "v3"
            else:
                requested_parser = "auto"
                
        # Bypass cache if we want v4 or v3 but the cache is from an older/different parser
        if requested_parser in ("v4", "v3") and cached_parser != requested_parser:
            logger.info("Cache hit for %s ignored due to parser mismatch (cached=%s, requested=%s)", filename, cached_parser, requested_parser)
            cached = None
    if cached:
        logger.info("Cache hit for %s", filename)
        async def cached_stream():
            slides = cached.get("slides", [])
            total = len(slides)
            # Emit parser identity first so the overlay's "Extraction engine"
            # pill resolves immediately even on cache hits. Older cache rows
            # pre-date the field — default to "pymupdf" in that case.
            cached_parser = cached.get("parser") or "pymupdf"
            yield f"data: {json.dumps({'type': 'info', 'parser': cached_parser})}\n\n"
            yield f"data: {json.dumps({'type': 'phase', 'phase': 'extract'})}\n\n"
            # Emit pdf_hash up front so the frontend can call /attach-lecture
            # after the lecture row is created — matches the non-cache path.
            yield f"data: {json.dumps({'type': 'meta', 'pdf_hash': pdf_hash})}\n\n"
            yield f"data: {json.dumps({'type': 'progress', 'current': 0, 'total': total, 'message': 'Loading from cache...'})}\n\n"
            # On-demand replays jump straight to finalize — no LLM ran
            # during the original parse so there is no "AI Enhance"
            # phase to mirror (Task #58). Default cache replays keep
            # the original three-phase shape.
            if parsing_mode != "on_demand":
                yield f"data: {json.dumps({'type': 'phase', 'phase': 'enhance'})}\n\n"
            # Best-effort: schedule embedding jobs for the cached slides so
            # the grounded tutor still has vectors to retrieve from for PDFs
            # whose parse was cached before embeddings existed (or whose
            # earlier embed attempts failed). store_slide_embedding is
            # idempotent on (pdf_hash, slide_index, pipeline_version), so
            # re-running on already-embedded slides is safe.
            _embed_failed_queue: List[Any] = []
            _embed_sem = asyncio.Semaphore(3)
            for i, s in enumerate(slides):
                if not (s.get("is_metadata") or s.get("slide_type") == "metadata"):
                    asyncio.create_task(
                        _safe_embedding_task(i, s, pdf_hash, _embed_failed_queue, _embed_sem)
                    )
                yield f"data: {json.dumps({'type': 'slide', 'index': i, 'slide': s})}\n\n"

            yield f"data: {json.dumps({'type': 'phase', 'phase': 'finalize'})}\n\n"
            deck = cached.get("deck", {})
            yield f"data: {json.dumps({'type': 'deck_complete', **deck, 'total_slides': total})}\n\n"
            yield f"data: {json.dumps({'type': 'complete', 'total': total})}\n\n"

        return StreamingResponse(
            cached_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )

    # 2. Full Parse Stream
    collected_slides: List[Dict[str, Any]] = []
    collected_deck: Dict[str, Any] = {}

    odl_pages = None
    odl_succeeded = False
    parser_used = "pymupdf"

    # ── Extract pages via external parser (before v4 branch) ──────────────────
    # When the user explicitly picks LlamaParse / MinerU / ODL, we call the
    # service here so the extracted pages are available for whichever pipeline
    # (v4 or v2) runs next.  For "auto" mode we skip this — the v2 fallback
    # path handles its own ODL attempt later.
    if parser == "llamaparse":
        try:
            from backend.services import llamaparse_service
            odl_pages = await llamaparse_service.extract_pages(content, filename)
            odl_succeeded = True
            parser_used = "llamaparse"
            logger.info("LlamaParse extracted %d pages for %s", len(odl_pages), filename)
        except RuntimeError as e:
            raise HTTPException(503, detail=str(e))
        except Exception as e:
            raise HTTPException(422, detail=f"LlamaParse extraction failed: {e}")
    elif parser == "mineru":
        try:
            from backend.services import mineru_service
            odl_pages = await mineru_service.extract_pages(content, filename)
            odl_succeeded = True
            parser_used = "mineru"
            logger.info("MinerU extracted %d pages for %s", len(odl_pages), filename)
        except RuntimeError as e:
            raise HTTPException(503, detail=str(e))
        except Exception as e:
            raise HTTPException(422, detail=f"MinerU extraction failed: {e}")
    elif parser == "opendataloader":
        try:
            from backend.services.odl_service import extract_pages as _odl
            odl_pages = await _odl(content, filename)
            odl_succeeded = True
            parser_used = "opendataloader-pdf"
            logger.info("ODL extracted %d pages for %s", len(odl_pages), filename)
        except Exception as e:
            logger.error("ODL extraction failed (explicit): %s", e)
            raise HTTPException(422, detail=f"OpenDataLoader extraction failed: {e}. Try 'auto' or 'pymupdf'.")

    # ── v4 pipeline branch ────────────────────────────────────────────────────
    from backend.core.config import settings as _cfg
    if parser in ("v4", "llamaparse", "mineru", "opendataloader") or (parser == "auto" and str(_cfg.parser_version) == "4"):
        import uuid
        run_id = str(uuid.uuid4())
        await _upload_pdf_to_storage(pdf_hash, content)
        
        lecture_uuid = UUID(lecture_id) if lecture_id else None

        use_arq = True
        try:
            pool = await _get_arq_pool()
            await pool.enqueue_job(
                "parse_pdf_v4",
                pdf_hash=pdf_hash,
                lecture_id=str(lecture_uuid) if lecture_uuid else "",
                run_id=run_id,
                ai_model=ai_model,
                odl_pages=odl_pages,
                parser_used=parser_used,
            )
        except Exception as e:
            logger.warning("Redis connection failed, running v4 synchronously: %s", e)
            use_arq = False

        if use_arq:
            async def _v4_sse_stream():
                import redis.asyncio as aioredis
                redis_client = aioredis.from_url(_cfg.redis_url, decode_responses=True)
                channel = f"parse:{pdf_hash}"
                try:
                    async with redis_client.pubsub() as pubsub:
                        await pubsub.subscribe(channel)
                        async for message in pubsub.listen():
                            if message.get("type") != "message":
                                continue
                            try:
                                event = json.loads(message["data"])
                                yield f"data: {json.dumps(event)}\n\n"
                                if event.get("type") in ("complete", "error"):
                                    break
                            except Exception:
                                continue
                finally:
                    await redis_client.aclose()

            return StreamingResponse(
                _v4_sse_stream(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
        else:
            async def _sync_v4_stream():
                q = asyncio.Queue()
                
                async def emit_fn(event_type: str, data: dict):
                    await q.put({"type": event_type, **data})
                
                from backend.services.parser.v4_orchestrator import parse_pdf_v4
                
                task = asyncio.create_task(parse_pdf_v4(
                    ctx={},
                    pdf_hash=pdf_hash,
                    lecture_id=str(lecture_uuid) if lecture_uuid else "",
                    run_id=run_id,
                    ai_model=ai_model,
                    emit_fn=emit_fn,
                    odl_pages=odl_pages,
                    parser_used=parser_used,
                ))
                
                while True:
                    try:
                        event = await asyncio.wait_for(q.get(), timeout=1.0)
                        
                        # Cache the result locally so future uploads hit the cache
                        if event.get("type") == "slide":
                            collected_slides.append(event["slide"])
                        elif event.get("type") == "deck_complete":
                            collected_deck.update({
                                "deck_summary": event.get("deck_summary", ""),
                                "deck_quiz": event.get("deck_quiz", []),
                            })
                            
                        yield f"data: {json.dumps(event)}\n\n"
                        
                        if event.get("type") in ("complete", "error"):
                            if collected_slides:
                                await store_cached_parse(
                                    pdf_hash,
                                    {"slides": collected_slides, "deck": collected_deck, "parser": "v4"}
                                )
                            break
                    except asyncio.TimeoutError:
                        if task.done():
                            if task.exception():
                                logger.error("Sync v4 parser failed: %s", task.exception())
                                yield f"data: {json.dumps({'type': 'error', 'message': str(task.exception())})}\n\n"
                            break
                        continue

            return StreamingResponse(
                _sync_v4_stream(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
    # ─────────────────────────────────────────────────────────────────────────

    # ── v3 pipeline branch ────────────────────────────────────────────────────
    if parser == "v3" or (parser == "auto" and str(_cfg.parser_version) == "3"):
        # Upload PDF to storage (idempotent by sha256)
        await _upload_pdf_to_storage(pdf_hash, content)

        # Create/get parse run and enqueue Arq job
        from backend.services.parser import repos as _repos
        from backend.domain.parse_models import PIPELINE_VERSION as _PV
        lecture_uuid = UUID(lecture_id) if lecture_id else None
        run = await _repos.get_or_create_run(pdf_hash, lecture_uuid, _PV)

        pool = await _get_arq_pool()
        await pool.enqueue_job(
            "parse_pdf",
            pdf_hash=pdf_hash,
            lecture_id=str(lecture_uuid) if lecture_uuid else "",
            run_id=str(run.run_id),
        )

        return StreamingResponse(
            _v3_sse_stream(pdf_hash, str(run.run_id)),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    # ─────────────────────────────────────────────────────────────────────────

    if parser == "pymupdf":
        pass  # PyMuPDF is the downstream default — skip alternatives

    # llamaparse / mineru / opendataloader are handled above (routed to v4).
    # This "auto" branch only runs for parser_version != 4 (v2 pipeline).

    elif parser == "auto":
        try:
            from backend.services.odl_service import extract_pages as _odl
            odl_pages = await _odl(content, filename)
            odl_succeeded = True
            logger.info("ODL extraction successful for %s", filename)
        except Exception as e:
            logger.warning("ODL failed, falling back to PyMuPDF: %s", e)
        parser_used = "opendataloader-pdf" if odl_succeeded else "pymupdf"

    async def event_generator():
        nonlocal collected_deck
        # Surface parser identity as the very first SSE event so the
        # overlay's "Extraction engine" pill resolves immediately.
        yield f"data: {json.dumps({'type': 'info', 'parser': parser_used})}\n\n"
        try:
            async for update in parse_pdf_stream(content, filename=filename, ai_model=ai_model, use_blueprint=use_blueprint, odl_pages=odl_pages, parsing_mode=parsing_mode):
                if update.get("type") == "slide":
                    collected_slides.append(update["slide"])
                elif update.get("type") == "deck_complete":
                    collected_deck = {
                        "deck_summary": update.get("deck_summary", ""),
                        "deck_quiz": update.get("deck_quiz", []),
                    }
                yield f"data: {json.dumps(update)}\n\n"
        except Exception as e:
            logger.error("Streaming parse failed after %d slides: %s", len(collected_slides), e, exc_info=True)
            if collected_slides:
                yield f"data: {json.dumps({'type': 'partial_complete', 'slides_processed': len(collected_slides), 'total_expected': page_count})}\n\n"
            yield f"data: {json.dumps({'type': 'error', 'message': str(e), 'recoverable': len(collected_slides) > 0})}\n\n"
        finally:
            # Save to cache if we got results — include parser identity so
            # cache-hit replays can resolve the overlay's pill correctly.
            if collected_slides:
                await store_cached_parse(
                    pdf_hash,
                    {"slides": collected_slides, "deck": collected_deck, "parser": parser_used, "parsing_mode": parsing_mode},
                    parsing_mode=parsing_mode,
                )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


# --- Lazy generation pipeline (parallel to parse-pdf-stream) -------------

@router.post("/import-pdf-lazy")
@limiter.limit("10/minute")
async def import_pdf_lazy_endpoint(
    request: Request,
    file: UploadFile = File(...),
    ai_model: str = Form("cerebras"),
    user: Any = Depends(require_professor),
):
    """Lazy import: extract + embed only. Per-slide AI is deferred to
    the lazy slide endpoint (synthesized on first view).

    Emits the same SSE event types as /parse-pdf-stream so the existing
    frontend SSE consumer works unchanged. Slide events carry stub
    placeholders (raw-text-derived title, no AI yet).
    """
    max_bytes = MAX_FILE_MB * 1024 * 1024
    chunks: List[bytes] = []
    bytes_read = 0
    while True:
        chunk = await file.read(65536)
        if not chunk:
            break
        bytes_read += len(chunk)
        if bytes_read > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds the {MAX_FILE_MB}MB limit.",
            )
        chunks.append(chunk)
    content = b"".join(chunks)
    await validate_upload(file, content)

    filename = file.filename or "upload.pdf"

    async def event_generator():
        yield f"data: {json.dumps({'type': 'info', 'parser': 'pymupdf-lazy'})}\n\n"
        try:
            async for update in import_pdf_lazy(content, filename=filename, ai_model=ai_model):
                yield f"data: {json.dumps(update)}\n\n"
        except Exception as e:
            logger.error("Lazy import failed: %s", e, exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e), 'recoverable': False})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/lazy-slides/{pdf_hash}/{idx}")
@limiter.limit("60/minute")
async def get_lazy_slide_endpoint(
    request: Request,
    pdf_hash: str,
    idx: int,
    ai_model: str = "cerebras",
    user: Any = Depends(require_professor),
):
    """Cache-first lazy synth for a single slide.

    Returns the same dict shape as a /parse-pdf-stream slide event's
    `slide` field. Caller must have first run /import-pdf-lazy so the
    layouts are cached.
    """
    if not pdf_hash or len(pdf_hash) != 64:
        raise HTTPException(status_code=400, detail="invalid pdf_hash")
    if idx < 0:
        raise HTTPException(status_code=400, detail="idx must be >= 0")

    slide = await synthesize_slide(pdf_hash, idx, ai_model=ai_model)
    if slide is None:
        raise HTTPException(
            status_code=404,
            detail="No cached layouts for this PDF. Run /import-pdf-lazy first.",
        )
    return slide


class LazyDeckQuizRequest(BaseModel):
    pdf_hash: str
    ai_model: str = "cerebras"


@router.post("/lazy-deck-quiz")
@limiter.limit("20/minute")
async def lazy_deck_quiz_endpoint(
    request: Request,
    body: LazyDeckQuizRequest,
    user: Any = Depends(require_professor),
):
    """Generate the cross-slide deck quiz on demand.

    Reads cached layouts + recomputes a deck summary from raw text, then
    calls generate_deck_quiz. Result not cached server-side in this v1
    (frontend can persist if it wants stickiness).
    """
    from backend.services.layout_analyzer import PageLayout
    from backend.services.ai_service import generate_deck_summary, generate_deck_quiz

    pdf_hash = (body.pdf_hash or "").strip()
    if not pdf_hash or len(pdf_hash) != 64:
        raise HTTPException(status_code=400, detail="invalid pdf_hash")

    pdf_cache = await get_cached_parse(pdf_hash)
    if not pdf_cache or "layouts" not in pdf_cache:
        raise HTTPException(
            status_code=404,
            detail="No cached layouts. Run /import-pdf-lazy first.",
        )

    layouts = [PageLayout(**l) for l in pdf_cache["layouts"]]
    joined = "\n".join(
        f"[Slide {i + 1}] {l.raw_text[:300].strip()}"
        for i, l in enumerate(layouts)
        if l.raw_text.strip()
    )
    if not joined:
        return {"deck_summary": "", "deck_quiz": []}

    summary = await generate_deck_summary(joined, body.ai_model)
    quiz = await generate_deck_quiz(summary, body.ai_model, blueprint=None)
    return {"deck_summary": summary, "deck_quiz": quiz}


# --- Duplicate PDF lookup -------------------------------------------------

class CheckDuplicateRequest(BaseModel):
    pdf_hash: str


@router.post("/check-duplicate")
@limiter.limit("30/minute")
async def check_duplicate_endpoint(
    request: Request,
    body: CheckDuplicateRequest,
    user: Any = Depends(require_professor),
):
    """Return the current professor's lectures that already use this PDF.

    The frontend computes a SHA-256 of the picked PDF in the browser and
    calls this endpoint before kicking off the streaming parser.  If any
    matches come back, the UI shows a "open existing vs upload as new"
    dialog instead of silently re-parsing.

    Scoped to the authenticated professor; another user uploading the
    same PDF is not surfaced as a duplicate.
    """
    pdf_hash = (body.pdf_hash or "").strip()
    if not pdf_hash:
        raise HTTPException(status_code=400, detail="pdf_hash is required.")
    # SHA-256 hex strings are exactly 64 lowercase hex chars.  Reject
    # anything else so we don't pay a database query for malformed input.
    if len(pdf_hash) != 64 or any(c not in "0123456789abcdef" for c in pdf_hash):
        raise HTTPException(status_code=400, detail="pdf_hash must be a SHA-256 hex digest.")

    user_id = user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    try:
        # Re-resolve via the database module so monkeypatched test fixtures
        # take effect — `from ... import supabase_admin` captures the
        # original reference at import time.
        from backend.core import database as _db
        matches = list_lectures_by_pdf_hash(_db.supabase_admin, user_id, pdf_hash)
    except Exception as e:
        logger.error("check-duplicate lookup failed: %s", e)
        raise HTTPException(status_code=500, detail="Duplicate lookup failed.")

    return {"duplicates": matches}


# --- Parse-cache existence check -----------------------------------------

class CheckParseCacheRequest(BaseModel):
    pdf_hash: str


@router.post("/check-parse-cache")
@limiter.limit("30/minute")
async def check_parse_cache_endpoint(
    request: Request,
    body: CheckParseCacheRequest,
    user: Any = Depends(require_professor),
):
    """Tell the frontend whether `pdf_parse_cache` already has a parse for
    this PDF.

    Distinct from `/check-duplicate`, which only looks at the current
    professor's `lectures` rows.  A user can re-upload a PDF whose parse
    was cached but whose lecture row was never persisted (they bailed on
    the upload wizard, the cache was warmed by another professor, etc.) —
    in that case the streaming endpoint would silently serve the stale
    parse.  This endpoint surfaces that fact so the UI can prompt
    "use saved parse vs. re-parse".

    Returns `{cached: bool, parsed_at: <iso-ts-or-null>}`. Same auth and
    pdf_hash validation rules as `/check-duplicate`.
    """
    pdf_hash = (body.pdf_hash or "").strip()
    if not pdf_hash:
        raise HTTPException(status_code=400, detail="pdf_hash is required.")
    if len(pdf_hash) != 64 or any(c not in "0123456789abcdef" for c in pdf_hash):
        raise HTTPException(status_code=400, detail="pdf_hash must be a SHA-256 hex digest.")

    try:
        meta = await get_cached_parse_meta(pdf_hash)
    except Exception as e:
        logger.error("check-parse-cache lookup failed: %s", e)
        raise HTTPException(status_code=500, detail="Cache lookup failed.")

    if meta is None:
        return {"cached": False, "parsed_at": None}
    return {"cached": True, "parsed_at": meta.get("parsed_at")}


# --- Attach lecture to previously-written embeddings ---------------------

class AttachLectureRequest(BaseModel):
    pdf_hash: str
    lecture_id: str


@router.post("/attach-lecture")
async def attach_lecture_endpoint(
    body: AttachLectureRequest,
    user: Any = Depends(require_professor),
):
    """Backfill `lecture_id` on slide_embeddings written during PDF parsing.

    Embeddings are persisted keyed by `pdf_hash` while the user is editing
    in the upload wizard.  Once they save the lecture (which mints the
    `lecture_id` client-side), the frontend calls this endpoint so retrieval
    can scope by lecture rather than scanning every PDF ever embedded.
    """
    if not body.pdf_hash or not body.lecture_id:
        raise HTTPException(status_code=400, detail="pdf_hash and lecture_id are required.")

    # Ownership check: only the professor who owns this lecture may attach
    # embeddings to it, and the lecture must already reference this pdf_hash.
    # Without this, any professor could relabel another tenant's embeddings
    # under one of their own lectures (cross-tenant poisoning / IDOR).
    user_id = user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)
    try:
        res = (
            supabase_admin.table("lectures")
            .select("id, professor_id, pdf_hash")
            .eq("id", body.lecture_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error("attach-lecture ownership lookup failed: %s", e)
        raise HTTPException(status_code=500, detail="Authorization check failed.")
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Lecture not found.")
    row = rows[0]
    if row.get("professor_id") != user_id:
        raise HTTPException(status_code=403, detail="Not your lecture.")
    if row.get("pdf_hash") and row["pdf_hash"] != body.pdf_hash:
        raise HTTPException(status_code=409, detail="pdf_hash does not match this lecture.")

    updated = await attach_lecture_id_to_embeddings(body.pdf_hash, body.lecture_id)

    # Persist the pdf_hash on the lecture row itself so future authorization
    # checks (chat endpoint) can verify the linkage without trawling
    # slide_embeddings.  We only write when missing/changed.
    if row.get("pdf_hash") != body.pdf_hash:
        try:
            (
                supabase_admin.table("lectures")
                .update({"pdf_hash": body.pdf_hash})
                .eq("id", body.lecture_id)
                .execute()
            )
        except Exception as e:
            # Non-fatal: embedding linkage already succeeded.  Log so we
            # know if backfill is needed.
            logger.warning(
                "Failed to persist pdf_hash on lecture %s: %s",
                body.lecture_id,
                e,
            )

    return {"updated": updated}


# --- Raw parser output (no AI) ---------------------------------------------


@router.post("/parse-raw")
@limiter.limit("10/minute")
async def parse_raw_endpoint(
    request: Request,
    file: UploadFile = File(...),
    parser: str = Form("auto"),
    user: Any = Depends(require_professor),
):
    """Run only the text-extraction stage for a PDF — no layout analysis,
    no AI, no caching.  Returns the raw per-page text exactly as the chosen
    parser sees it, so callers can evaluate extraction quality before
    committing to a full pipeline run.

    Response shape:
      {
        "parser_used": str,
        "total_pages": int,
        "pages": [{"page_num": int, "title": str|null, "text": str, "char_count": int, "word_count": int}]
      }
    """
    max_bytes = MAX_FILE_MB * 1024 * 1024
    chunks: List[bytes] = []
    bytes_read = 0
    while True:
        chunk = await file.read(65536)
        if not chunk:
            break
        bytes_read += len(chunk)
        if bytes_read > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds the {MAX_FILE_MB}MB limit.",
            )
        chunks.append(chunk)
    content = b"".join(chunks)
    await validate_upload(file, content)

    filename = file.filename or "upload.pdf"
    pages_raw: Dict[int, dict] = {}
    parser_used = "pymupdf"

    if parser == "llamaparse":
        try:
            from backend.services import llamaparse_service
            pages_raw = await llamaparse_service.extract_pages(content, filename)
            parser_used = "llamaparse"
        except RuntimeError as e:
            raise HTTPException(503, detail=str(e))
        except Exception as e:
            raise HTTPException(422, detail=f"LlamaParse extraction failed: {e}")

    elif parser == "mineru":
        try:
            from backend.services import mineru_service
            pages_raw = await mineru_service.extract_pages(content, filename)
            parser_used = "mineru"
        except RuntimeError as e:
            raise HTTPException(503, detail=str(e))
        except Exception as e:
            raise HTTPException(422, detail=f"MinerU extraction failed: {e}")

    elif parser == "opendataloader":
        try:
            from backend.services.odl_service import extract_pages as _odl
            pages_raw = await _odl(content, filename)
            parser_used = "opendataloader-pdf"
        except Exception as e:
            raise HTTPException(422, detail=f"OpenDataLoader extraction failed: {e}")

    elif parser == "pymupdf":
        def _pymupdf_extract() -> Dict[int, dict]:
            import fitz
            result: Dict[int, dict] = {}
            with fitz.open(stream=content, filetype="pdf") as doc:
                for i, page in enumerate(doc):
                    text = page.get_text("text") or ""
                    result[i + 1] = {"text": text, "title": None}
            return result

        try:
            pages_raw = await asyncio.wait_for(asyncio.to_thread(_pymupdf_extract), timeout=60.0)
            parser_used = "pymupdf"
        except Exception as e:
            raise HTTPException(422, detail=f"PyMuPDF extraction failed: {e}")

    else:  # auto — try ODL, fall back to PyMuPDF
        try:
            from backend.services.odl_service import extract_pages as _odl
            pages_raw = await _odl(content, filename)
            parser_used = "opendataloader-pdf"
        except Exception:
            def _pymupdf_extract_auto() -> Dict[int, dict]:
                import fitz
                result: Dict[int, dict] = {}
                with fitz.open(stream=content, filetype="pdf") as doc:
                    for i, page in enumerate(doc):
                        text = page.get_text("text") or ""
                        result[i + 1] = {"text": text, "title": None}
                return result

            try:
                pages_raw = await asyncio.wait_for(asyncio.to_thread(_pymupdf_extract_auto), timeout=60.0)
                parser_used = "pymupdf"
            except Exception as e:
                raise HTTPException(422, detail=f"Extraction failed: {e}")

    pages_out = []
    for page_num in sorted(pages_raw):
        entry = pages_raw[page_num]
        text = entry.get("text") or ""
        pages_out.append({
            "page_num": page_num,
            "title": entry.get("title"),
            "text": text,
            "char_count": len(text),
            "word_count": len(text.split()),
        })

    return {
        "parser_used": parser_used,
        "total_pages": len(pages_out),
        "pages": pages_out,
    }


# --- Routing diagnostics ---------------------------------------------------


@router.get("/diagnostics/{pdf_hash}")
@limiter.limit("30/minute")
async def diagnostics_endpoint(
    request: Request,
    pdf_hash: str,
    user: Any = Depends(require_professor),
):
    """Routing telemetry for a parsed PDF.

    Ownership is enforced by looking up a `lectures` row whose
    ``pdf_hash`` matches and verifying the caller is the professor on
    that row.  404 when no lecture references this hash so the endpoint
    cannot be used to enumerate which PDFs have been processed.
    """
    if not pdf_hash:
        raise HTTPException(status_code=400, detail="pdf_hash is required.")

    user_id = (
        user.id if hasattr(user, "id")
        else (user.get("id") if isinstance(user, dict) else None)
    )

    try:
        # Filter by BOTH pdf_hash and professor_id so a multi-tenant
        # collision (the same PDF uploaded by two professors) can never
        # let one professor's row authorize another professor's request.
        owned_res = (
            supabase_admin.table("lectures")
            .select("id, professor_id, pdf_hash")
            .eq("pdf_hash", pdf_hash)
            .eq("professor_id", user_id)
            .limit(1)
            .execute()
        )
        if owned_res.data:
            pass  # caller owns at least one lecture for this hash → authorized
        else:
            # Distinguish "no such hash" (404) from "hash exists but
            # belongs to someone else" (403) without leaking whether the
            # PDF has been parsed for an unrelated professor.
            any_res = (
                supabase_admin.table("lectures")
                .select("id")
                .eq("pdf_hash", pdf_hash)
                .limit(1)
                .execute()
            )
            if not (any_res.data or []):
                raise HTTPException(status_code=404, detail="No lecture found for this pdf_hash.")
            raise HTTPException(status_code=403, detail="Not your lecture.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("diagnostics ownership lookup failed: %s", e)
        raise HTTPException(status_code=500, detail="Authorization check failed.")

    cached = await get_cached_slide_results(pdf_hash, PIPELINE_VERSION)
    per_slide: List[Dict[str, Any]] = []
    for slide_index in sorted(cached):
        slide = cached[slide_index] or {}
        meta = slide.get("_meta") or {}
        per_slide.append({
            "slide_index": slide_index,
            "route": meta.get("route") or "",
            "route_reason": meta.get("route_reason") or "",
            "layout_features": meta.get("layout_features") or {},
            "has_parse_error": bool(slide.get("parse_error")),
        })

    run_metrics = await get_pipeline_run(pdf_hash, PIPELINE_VERSION)
    flags = flag_suspicious(per_slide)

    return {
        "pdf_hash": pdf_hash,
        "pipeline_version": PIPELINE_VERSION,
        "run_metrics": run_metrics,
        "per_slide": per_slide,
        "flags": flags,
    }


# --- Checkpoint cache cleanup (admin) ---------------------------------------


@router.post("/cleanup-cache")
@limiter.limit("5/minute")
async def cleanup_cache_endpoint(
    request: Request,
    user: Any = Depends(require_professor),
):
    """Purge expired rows from ``slide_parse_cache``.

    Calls the ``cleanup_slide_parse_cache`` PostgreSQL SECURITY DEFINER
    function which deletes every row whose ``expires_at`` is in the past.
    Checkpoint rows have a 7-day TTL set at write time, so after that
    window this endpoint frees up the storage.

    Requires professor auth (only professors trigger parses; restricting
    here prevents unauthenticated callers from hitting the DB). Rate-limited
    to 5/minute so it can't be used as a DB hammer.
    """
    deleted = await purge_expired_slide_checkpoints()
    return {"deleted": deleted, "message": f"Purged {deleted} expired checkpoint rows."}

