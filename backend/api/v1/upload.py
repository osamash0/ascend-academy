import logging
import json
import asyncio
from typing import Any, List, Dict, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Form, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.services import upload_service
from backend.services import diagnostics_service
from backend.services.slide_synth_service import synthesize_slide
from backend.services.parser import repos as parser_repos
from backend.domain.parse_models import RunStatus
from backend.core.auth_middleware import require_creator, _app_metadata
from backend.core.rate_limit import limiter
from backend.core.file_validation import sanitize_filename
from starlette.concurrency import run_in_threadpool
from backend.services.cache import (
    compute_pdf_hash,
    get_cached_parse,
    purge_expired_slide_checkpoints,
)
from backend.core.database import supabase_admin, run_sync  # ADMIN: cross-tenant authorization lookup for diagnostics and lectures
from backend.core.config import settings

logger = logging.getLogger(__name__)

# Single source of truth for the upload size limit (backend/core/config.py).
MAX_FILE_MB = settings.max_upload_mb

# Extensions the upload pipeline accepts (served to the frontend for parity).
ACCEPTED_UPLOAD_EXTENSIONS = [".pdf", ".pptx"]

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

router = APIRouter(prefix="/upload", tags=["upload"])

@router.get("/config")
async def upload_config_endpoint():
    """Upload constraints for the client so it enforces the same limits.

    Public (no auth): exposes only non-sensitive limits, and the client needs
    them before the user picks a file.
    """
    return {
        "maxUploadMb": MAX_FILE_MB,
        "acceptedExtensions": ACCEPTED_UPLOAD_EXTENSIONS,
        "maxBatchFiles": settings.max_batch_files,
    }

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
    course_id: Optional[str] = Form(None),
    user: Any = Depends(require_creator),
):
    user_id = user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)
    meta_role = _app_metadata(user).get("role", "")
    if not meta_role and user_id:
        from backend.core.auth_middleware import _lookup_role_from_db
        db_roles = await run_in_threadpool(_lookup_role_from_db, str(user_id))
        if db_roles and "student" in db_roles:
            meta_role = "student"
    visibility = "course" if course_id else ("private_student" if meta_role == "student" else "course")
    if lecture_id:
        res = await run_sync(
            lambda: supabase_admin.table("lectures").select("professor_id").eq("id", lecture_id).execute()
        )
        if not res.data or res.data[0].get("professor_id") != user_id:
            raise HTTPException(status_code=403, detail="You do not own this lecture.")

    try:
        content = await upload_service.read_upload_capped(file, MAX_FILE_MB)
    except ValueError as e:
        raise HTTPException(status_code=413, detail=str(e))

    try:
        page_count = await upload_service.validate_upload(file.filename, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    filename = sanitize_filename(file.filename)
    pdf_hash = compute_pdf_hash(content)
    parsing_mode = parsing_mode if parsing_mode in {"ai", "on_demand"} else "ai"

    cached = None if force_reparse else await get_cached_parse(pdf_hash, parsing_mode=parsing_mode)
    
    if cached:
        # The unified (v5) pipeline is the only parse path. Drop any cache that
        # wasn't produced by it (e.g. legacy v4-shaped slides) so we never replay
        # content in a shape the current pipeline no longer emits (PDF-10).
        cached_parser = cached.get("parser") or "pymupdf"
        if cached_parser not in ("unified", "llamaparse", "mineru", "opendataloader-pdf", "markitdown"):
            cached = None

    if cached:
        async def cached_stream():
            slides = cached.get("slides", [])
            total = len(slides)
            cached_parser = cached.get("parser") or "pymupdf"
            yield f"data: {json.dumps({'type': 'info', 'parser': cached_parser})}\n\n"
            yield f"data: {json.dumps({'type': 'phase', 'phase': 'extract'})}\n\n"
            yield f"data: {json.dumps({'type': 'meta', 'pdf_hash': pdf_hash})}\n\n"
            yield f"data: {json.dumps({'type': 'progress', 'current': 0, 'total': total, 'message': 'Loading from cache...'})}\n\n"
            if parsing_mode != "on_demand":
                yield f"data: {json.dumps({'type': 'phase', 'phase': 'enhance'})}\n\n"
            
            from backend.services.file_parse_service import _safe_embedding_task
            _embed_failed_queue = []
            _embed_sem = asyncio.Semaphore(3)
            for i, s in enumerate(slides):
                if not (s.get("is_metadata") or s.get("slide_type") == "metadata"):
                    asyncio.create_task(_safe_embedding_task(i, s, pdf_hash, _embed_failed_queue, _embed_sem))
                yield f"data: {json.dumps({'type': 'slide', 'index': i, 'slide': s})}\n\n"

            yield f"data: {json.dumps({'type': 'phase', 'phase': 'finalize'})}\n\n"
            # Cache payloads come in two shapes: the v2/sync writers nest the
            # deck fields under "deck"; the v4 Arq orchestrator stores
            # deck_summary/deck_quiz at the top level. Tolerate both so a v4
            # cache hit doesn't silently drop the deck summary and quiz.
            deck = cached.get("deck")
            if not deck:
                deck = {
                    "deck_summary": cached.get("deck_summary", ""),
                    "deck_quiz": cached.get("deck_quiz", []),
                }
            yield f"data: {json.dumps({'type': 'deck_complete', **deck, 'total_slides': total})}\n\n"
            yield f"data: {json.dumps({'type': 'complete', 'total': total})}\n\n"

        return StreamingResponse(cached_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # Backpressure: a cache miss means we're about to enqueue a real parse job.
    # Reject up front when the queue is already saturated so the client gets an
    # honest 429 instead of joining an unbounded backlog.
    _max_depth = settings.arq_max_queue_depth
    if _max_depth and await upload_service.queue_depth() >= _max_depth:
        raise HTTPException(
            status_code=429,
            detail="The processing queue is busy right now. Please retry in a few minutes.",
        )

    return StreamingResponse(
        upload_service.process_pdf_stream(
            content=content, filename=filename, pdf_hash=pdf_hash, page_count=page_count,
            ai_model=ai_model, use_blueprint=use_blueprint, parsing_mode=parsing_mode,
            parser=parser, lecture_id=lecture_id, user_id=user_id, force_reparse=force_reparse,
            course_id=course_id,
            visibility=visibility,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )

@router.post("/import-pdf-lazy")
@limiter.limit("10/minute")
async def import_pdf_lazy_endpoint(
    request: Request,
    file: UploadFile = File(...),
    ai_model: str = Form("cerebras"),
    user: Any = Depends(require_creator),
):
    try:
        content = await upload_service.read_upload_capped(file, MAX_FILE_MB)
    except ValueError as e:
        raise HTTPException(status_code=413, detail=str(e))

    try:
        await upload_service.validate_upload(file.filename, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    filename = sanitize_filename(file.filename)
    return StreamingResponse(
        upload_service.process_pdf_lazy(content, filename, ai_model),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )

@router.get("/lazy-slides/{pdf_hash}/{idx}")
@limiter.limit("60/minute")
async def get_lazy_slide_endpoint(
    request: Request,
    pdf_hash: str,
    idx: int,
    ai_model: str = "cerebras",
    user: Any = Depends(require_creator),
):
    if not pdf_hash or len(pdf_hash) != 64: raise HTTPException(status_code=400, detail="invalid pdf_hash")
    if idx < 0: raise HTTPException(status_code=400, detail="idx must be >= 0")

    slide = await synthesize_slide(pdf_hash, idx, ai_model=ai_model)
    if slide is None:
        raise HTTPException(status_code=404, detail="No cached layouts for this PDF. Run /import-pdf-lazy first.")
    return slide

class LazyDeckQuizRequest(BaseModel):
    pdf_hash: str
    ai_model: str = "cerebras"

@router.post("/lazy-deck-quiz")
@limiter.limit("20/minute")
async def lazy_deck_quiz_endpoint(
    request: Request,
    body: LazyDeckQuizRequest,
    user: Any = Depends(require_creator),
):
    from backend.services.layout_analyzer import PageLayout
    from backend.services.ai_service import generate_deck_summary, generate_deck_quiz

    pdf_hash = (body.pdf_hash or "").strip()
    if not pdf_hash or len(pdf_hash) != 64: raise HTTPException(status_code=400, detail="invalid pdf_hash")

    pdf_cache = await get_cached_parse(pdf_hash)
    if not pdf_cache or "layouts" not in pdf_cache:
        raise HTTPException(status_code=404, detail="No cached layouts. Run /import-pdf-lazy first.")

    layouts = [PageLayout(**l) for l in pdf_cache["layouts"]]
    joined = "\n".join(f"[Slide {i + 1}] {l.raw_text[:300].strip()}" for i, l in enumerate(layouts) if l.raw_text.strip())
    if not joined: return {"deck_summary": "", "deck_quiz": []}

    summary = await generate_deck_summary(joined, body.ai_model)
    quiz = await generate_deck_quiz(summary, body.ai_model, blueprint=None)
    return {"deck_summary": summary, "deck_quiz": quiz}

class CheckDuplicateRequest(BaseModel):
    pdf_hash: str

@router.post("/check-duplicate")
@limiter.limit("30/minute")
async def check_duplicate_endpoint(
    request: Request,
    body: CheckDuplicateRequest,
    user: Any = Depends(require_creator),
):
    pdf_hash = (body.pdf_hash or "").strip()
    if not pdf_hash or len(pdf_hash) != 64 or any(c not in "0123456789abcdef" for c in pdf_hash):
        raise HTTPException(status_code=400, detail="pdf_hash must be a valid SHA-256 hex digest.")

    user_id = user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)
    if not user_id: raise HTTPException(status_code=401, detail="Invalid user context.")

    try:
        matches = await diagnostics_service.check_duplicate_pdf(user_id, pdf_hash)
        return {"duplicates": matches}
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))

class CheckParseCacheRequest(BaseModel):
    pdf_hash: str

@router.post("/check-parse-cache")
@limiter.limit("30/minute")
async def check_parse_cache_endpoint(
    request: Request,
    body: CheckParseCacheRequest,
    user: Any = Depends(require_creator),
):
    pdf_hash = (body.pdf_hash or "").strip()
    if not pdf_hash or len(pdf_hash) != 64 or any(c not in "0123456789abcdef" for c in pdf_hash):
        raise HTTPException(status_code=400, detail="pdf_hash must be a valid SHA-256 hex digest.")

    try:
        return await diagnostics_service.check_parse_cache(pdf_hash)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))

class AttachLectureRequest(BaseModel):
    pdf_hash: str
    lecture_id: str

@router.post("/attach-lecture")
async def attach_lecture_endpoint(
    body: AttachLectureRequest,
    user: Any = Depends(require_creator),
):
    if not body.pdf_hash or not body.lecture_id:
        raise HTTPException(status_code=400, detail="pdf_hash and lecture_id are required.")

    user_id = user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)
    try:
        res = supabase_admin.table("lectures").select("id, professor_id, pdf_hash").eq("id", body.lecture_id).limit(1).execute()
        rows = res.data or []
        if not rows: raise HTTPException(status_code=404, detail="Lecture not found.")
        row = rows[0]
        if row.get("professor_id") != user_id: raise HTTPException(status_code=403, detail="Not your lecture.")
        if row.get("pdf_hash") and row["pdf_hash"] != body.pdf_hash:
            raise HTTPException(status_code=409, detail="pdf_hash does not match this lecture.")
        
        from backend.services.cache import attach_lecture_id_to_embeddings
        updated = await attach_lecture_id_to_embeddings(body.pdf_hash, body.lecture_id)

        if row.get("pdf_hash") != body.pdf_hash:
            supabase_admin.table("lectures").update({"pdf_hash": body.pdf_hash}).eq("id", body.lecture_id).execute()
        return {"updated": updated}
    except HTTPException: raise
    except Exception as e:
        logger.error("attach-lecture failed: %s", e)
        raise HTTPException(status_code=500, detail="Authorization check failed.")

@router.post("/enhance-slide/{slide_id}")
@limiter.limit("60/minute")
async def enhance_slide_endpoint(
    request: Request,
    slide_id: str,
    ai_model: str = "auto",
    user: Any = Depends(require_creator),
):
    """Run the unified per-slide synthesis on a single slide that was imported
    with 'Skip AI' (ai_enhanced=false), then flip the flag.

    Reuses ``unified_orchestrator._synthesize_slide`` so an enhanced slide is
    identical to one produced by a full AI parse. Idempotent: an already-enhanced
    slide is returned unchanged.
    """
    user_id = user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)
    try:
        srow = (
            supabase_admin.table("slides")
            .select("id, lecture_id, slide_number, content_text, title, summary, ai_enhanced")
            .eq("id", slide_id).limit(1).execute()
        )
        rows = srow.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Slide not found.")
        slide = rows[0]

        lrow = (
            supabase_admin.table("lectures")
            .select("id, professor_id, title, description, pdf_hash")
            .eq("id", slide["lecture_id"]).limit(1).execute()
        )
        lecture = (lrow.data or [None])[0]
        if not lecture:
            raise HTTPException(status_code=404, detail="Lecture not found.")
        if lecture.get("professor_id") != user_id:
            raise HTTPException(status_code=403, detail="You do not own this slide.")

        # Idempotent: don't re-spend LLM on an already-enhanced slide.
        if slide.get("ai_enhanced"):
            return {"slide_id": slide_id, "title": slide.get("title"),
                    "summary": slide.get("summary"), "ai_enhanced": True, "already_enhanced": True}

        from backend.core.config import settings as _cfg
        from backend.services.parser import unified_orchestrator as _uo
        from backend.services.parser.storage import _fetch_pdf_bytes

        resolved_model = ai_model if (ai_model and ai_model.lower() != "auto") else (_cfg.parser_llm_model or "cerebras")
        lecture_context = f"{lecture.get('title') or ''}: {lecture.get('description') or ''}".strip(": ")
        idx0 = int(slide.get("slide_number") or 1) - 1
        content_text = slide.get("content_text") or ""

        pdf_bytes = b""
        if lecture.get("pdf_hash"):
            pdf_bytes = await _fetch_pdf_bytes(lecture["pdf_hash"]) or b""

        res = await _uo._synthesize_slide(idx0, content_text, lecture_context, resolved_model, pdf_bytes)
        new_title = (res.get("title") or "").strip() or slide.get("title") or f"Slide {idx0 + 1}"
        new_summary = (res.get("summary") or "").strip()
        new_content = (res.get("content") or "").strip() or content_text

        supabase_admin.table("slides").update({
            "title": new_title,
            "summary": new_summary,
            "content_text": new_content,
            "ai_enhanced": True,
            "parser_engine": "unified",
        }).eq("id", slide_id).execute()

        # Refresh this slide's embedding (best-effort; keyed by pdf_hash+index).
        if lecture.get("pdf_hash"):
            try:
                import asyncio as _asyncio
                from backend.services.file_parse_service import _safe_embedding_task
                ui_slide = {"title": new_title, "content": new_content, "summary": new_summary}
                await _safe_embedding_task(idx0, ui_slide, lecture["pdf_hash"], [], _asyncio.Semaphore(1))
            except Exception as exc:
                logger.warning("enhance-slide embedding refresh failed (non-fatal): %s", exc)

        return {"slide_id": slide_id, "title": new_title, "summary": new_summary, "ai_enhanced": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("enhance-slide failed for %s: %s", slide_id, e)
        raise HTTPException(status_code=500, detail="Slide enhancement failed.")

@router.post("/parse-raw")
@limiter.limit("10/minute")
async def parse_raw_endpoint(
    request: Request,
    file: UploadFile = File(...),
    parser: str = Form("auto"),
    user: Any = Depends(require_creator),
):
    try:
        content = await upload_service.read_upload_capped(file, MAX_FILE_MB)
    except ValueError as e:
        raise HTTPException(status_code=413, detail=str(e))

    try:
        await upload_service.validate_upload(file.filename, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    filename = sanitize_filename(file.filename)

    try:
        return await upload_service.extract_raw_pages(content, filename, parser)
    except Exception as e:
        logger.error("parse-raw failed: %s", e)
        raise HTTPException(status_code=422, detail=str(e))

@router.get("/diagnostics/{pdf_hash}")
@limiter.limit("30/minute")
async def diagnostics_endpoint(
    request: Request,
    pdf_hash: str,
    user: Any = Depends(require_creator),
):
    if not pdf_hash: raise HTTPException(status_code=400, detail="pdf_hash is required.")
    user_id = user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)

    try:
        from backend.services.file_parse_service import PIPELINE_VERSION
        return await diagnostics_service.get_pdf_diagnostics(user_id, pdf_hash, PIPELINE_VERSION)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/cleanup-cache")
@limiter.limit("5/minute")
async def cleanup_cache_endpoint(
    request: Request,
    user: Any = Depends(require_creator),
):
    deleted = await purge_expired_slide_checkpoints()
    return {"deleted": deleted, "message": f"Purged {deleted} expired checkpoint rows."}


# ── Phase 1: course-at-once ingestion (multi-file batch upload) ─────────────

def _user_id(user: Any) -> Optional[str]:
    return user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)


@router.post("/batch")
@limiter.limit("5/minute")
async def upload_batch_endpoint(
    request: Request,
    files: List[UploadFile] = File(...),
    course_id: Optional[str] = Form(None),
    parsing_mode: str = Form("ai"),
    ai_model: str = Form("cerebras"),
    user: Any = Depends(require_creator),
):
    """Multi-file upload: enqueues one parse_pdf_unified job per file sharing
    a batch_id, and returns immediately (no SSE — poll GET /upload/jobs or
    GET /upload/batches/{id} instead; N held-open SSE streams don't scale and
    can't survive the tab closing, which this flow is explicitly meant to
    support). A bad file is isolated — recorded failed with run_id=null,
    never aborting the rest of the batch.

    PowerPoint (.pptx) isn't supported here yet — the markitdown+LibreOffice
    conversion path used by /parse-pdf-stream isn't wired into this loop;
    a .pptx file is rejected per-file with a clear message rather than
    silently mishandled.
    """
    from backend.services.parser.unified_orchestrator import PIPELINE_VERSION_UNIFIED

    user_id = _user_id(user)
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")
    if len(files) > settings.max_batch_files:
        raise HTTPException(
            status_code=400,
            detail=f"Batch exceeds the {settings.max_batch_files}-file limit.",
        )

    if course_id:
        res = await run_sync(
            lambda: supabase_admin.table("courses").select("professor_id").eq("id", course_id).execute()
        )
        if not res.data or res.data[0].get("professor_id") != user_id:
            raise HTTPException(status_code=403, detail="You do not own this course.")

    # Backpressure: a batch enqueues up to one job per file. Reject the whole
    # batch up front when the queue is already saturated rather than piling
    # dozens more jobs onto an unbounded backlog.
    _max_depth = settings.arq_max_queue_depth
    if _max_depth and await upload_service.queue_depth() >= _max_depth:
        raise HTTPException(
            status_code=429,
            detail="The processing queue is busy right now. Please retry in a few minutes.",
        )

    parsing_mode = parsing_mode if parsing_mode in {"ai", "on_demand"} else "ai"
    resolved_model = ai_model if (ai_model and ai_model.lower() != "auto") else (settings.parser_llm_model or "cerebras")
    batch_id = uuid4()
    course_uuid = UUID(course_id) if course_id else None
    user_uuid = UUID(user_id) if user_id else None
    meta_role = _app_metadata(user).get("role", "")
    if not meta_role and user_id:
        from backend.core.auth_middleware import _lookup_role_from_db
        db_roles = await run_in_threadpool(_lookup_role_from_db, str(user_id))
        if db_roles and "student" in db_roles:
            meta_role = "student"
    visibility = "course" if course_id else ("private_student" if meta_role == "student" else "course")

    results: List[Dict[str, Any]] = []
    for file in files:
        raw_name = file.filename or "upload.pdf"
        if raw_name.lower().endswith(".pptx"):
            results.append({
                "filename": raw_name, "pdf_hash": None, "run_id": None, "status": "failed",
                "error": "PowerPoint isn't supported in batch upload yet — upload it individually.",
            })
            continue

        try:
            content = await upload_service.read_upload_capped(file, MAX_FILE_MB)
            await upload_service.validate_upload(raw_name, content)
        except ValueError as e:
            results.append({"filename": raw_name, "pdf_hash": None, "run_id": None,
                             "status": "failed", "error": str(e)})
            continue

        filename = sanitize_filename(raw_name)
        pdf_hash = compute_pdf_hash(content)
        try:
            await upload_service.upload_pdf_to_storage(pdf_hash, content)
            run = await parser_repos.get_or_create_run(
                pdf_hash, None, PIPELINE_VERSION_UNIFIED,
                batch_id=batch_id, user_id=user_uuid, course_id=course_uuid,
                filename=filename, parsing_mode=parsing_mode,
            )
            pool = await upload_service.get_arq_pool()
            await pool.enqueue_job(
                "parse_pdf_unified",
                pdf_hash=pdf_hash,
                lecture_id="",
                run_id=str(run.run_id),
                ai_model=resolved_model,
                user_id=str(user_id),
                filename=filename,
                parser_used="unified",
                force_reparse=False,
                parsing_mode=parsing_mode,
                batch_id=str(batch_id),
                course_id=course_id,
                visibility=visibility,
            )
            results.append({"filename": filename, "pdf_hash": pdf_hash,
                             "run_id": str(run.run_id), "status": "queued"})
        except Exception as e:
            logger.error("batch upload enqueue failed for %s: %s", filename, e)
            results.append({"filename": filename, "pdf_hash": pdf_hash, "run_id": None,
                             "status": "failed", "error": "Failed to queue this file for parsing."})

    return {"batch_id": str(batch_id), "files": results}


@router.post("/jobs/{run_id}/retry")
@limiter.limit("10/minute")
async def retry_run_endpoint(
    request: Request,
    run_id: str,
    user: Any = Depends(require_creator),
):
    """Retry a FAILED parse run without re-uploading bytes — the original PDF
    is already in permanent storage, keyed by pdf_hash."""
    user_id = _user_id(user)
    meta_role = _app_metadata(user).get("role", "")
    visibility = "private_student" if meta_role == "student" else "course"
    try:
        run_uuid = UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid run_id.")

    run = await parser_repos.get_run_by_id(run_uuid)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    if run.user_id is None or str(run.user_id) != str(user_id):
        raise HTTPException(status_code=403, detail="You do not own this run.")
    if run.status != RunStatus.FAILED:
        raise HTTPException(status_code=409, detail="Only failed runs can be retried.")

    await parser_repos.set_status(run_uuid, RunStatus.QUEUED)
    pool = await upload_service.get_arq_pool()
    await pool.enqueue_job(
        "parse_pdf_unified",
        pdf_hash=run.pdf_hash,
        lecture_id="",
        run_id=str(run.run_id),
        ai_model=settings.parser_llm_model or "cerebras",
        user_id=str(run.user_id),
        filename=run.filename or "upload.pdf",
        parser_used="unified",
        force_reparse=True,
        parsing_mode=run.parsing_mode or "ai",
        batch_id=str(run.batch_id) if run.batch_id else None,
        course_id=str(run.course_id) if run.course_id else None,
        visibility=visibility,
    )
    return {"run_id": str(run.run_id), "status": "queued"}


@router.get("/jobs")
@limiter.limit("60/minute")
async def list_upload_jobs_endpoint(
    request: Request,
    batch_id: Optional[str] = None,
    user: Any = Depends(require_creator),
):
    """In-flight + recently-finished parse runs for the authenticated
    professor — powers the persistent "Uploads" nav indicator (no batch_id)
    and per-batch queue polling (with batch_id)."""
    user_id = _user_id(user)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    runs = await parser_repos.list_runs_by_user(
        UUID(user_id), UUID(batch_id) if batch_id else None,
    )
    return {"jobs": [
        {
            "run_id": str(r.run_id),
            "batch_id": str(r.batch_id) if r.batch_id else None,
            "filename": r.filename,
            "pdf_hash": r.pdf_hash,
            "status": r.status.value,
            "lecture_id": str(r.lecture_id) if r.lecture_id else None,
            "course_id": str(r.course_id) if r.course_id else None,
            "error": r.error,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        }
        for r in runs
    ]}


@router.get("/batches/{batch_id}")
@limiter.limit("60/minute")
async def get_batch_endpoint(
    request: Request,
    batch_id: str,
    user: Any = Depends(require_creator),
):
    """Batch review summary: per-lecture slide/quiz/flagged counts + deck
    summary for the Phase-1 batch review screen."""
    user_id = _user_id(user)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    try:
        batch_uuid = UUID(batch_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid batch_id.")

    rows = await parser_repos.get_batch_summary(batch_uuid, UUID(user_id))
    if not rows:
        raise HTTPException(status_code=404, detail="Batch not found.")

    return {"batch_id": batch_id, "lectures": [
        {
            "run_id": str(r["run_id"]),
            "status": r["status"],
            "error": r["error"],
            "filename": r["filename"],
            "lecture_id": str(r["lecture_id"]) if r["lecture_id"] else None,
            "title": r["title"],
            "deck_summary": r["deck_summary"],
            "slide_count": r["slide_count"],
            "quiz_count": r["quiz_count"],
            "flagged_count": r["flagged_count"],
        }
        for r in rows
    ]}
