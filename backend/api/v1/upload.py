import logging
import json
import asyncio
from typing import Any, List, Dict, Optional

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Form, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.services import upload_service
from backend.services import diagnostics_service
from backend.services.slide_synth_service import synthesize_slide
from backend.core.auth_middleware import require_professor
from backend.core.rate_limit import limiter
from backend.core.file_validation import sanitize_filename
from backend.services.cache import (
    compute_pdf_hash,
    get_cached_parse,
    purge_expired_slide_checkpoints,
)
from backend.core.database import supabase_admin  # ADMIN: cross-tenant authorization lookup for diagnostics and lectures

logger = logging.getLogger(__name__)

MAX_FILE_MB = 25

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
    user_id = user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)
    if lecture_id:
        res = supabase_admin.table("lectures").select("professor_id").eq("id", lecture_id).execute()
        if not res.data or res.data[0].get("professor_id") != user_id:
            raise HTTPException(status_code=403, detail="You do not own this lecture.")

    max_bytes = MAX_FILE_MB * 1024 * 1024
    chunks = []
    bytes_read = 0
    while True:
        chunk = await file.read(65536)
        if not chunk:
            break
        bytes_read += len(chunk)
        if bytes_read > max_bytes:
            raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_FILE_MB}MB limit.")
        chunks.append(chunk)
    content = b"".join(chunks)

    try:
        page_count = await upload_service.validate_upload(file.filename, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    filename = sanitize_filename(file.filename)
    pdf_hash = compute_pdf_hash(content)
    parsing_mode = parsing_mode if parsing_mode in {"ai", "on_demand"} else "ai"

    cached = None if force_reparse else await get_cached_parse(pdf_hash, parsing_mode=parsing_mode)
    
    if cached:
        from backend.core.config import settings as _cfg
        cached_parser = cached.get("parser") or "pymupdf"
        requested_parser = parser
        if parser == "auto":
            if str(_cfg.parser_version) == "4": requested_parser = "v4"
            elif str(_cfg.parser_version) == "3": requested_parser = "v3"
            else: requested_parser = "auto"
        if requested_parser in ("v4", "v3") and cached_parser != requested_parser:
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

    return StreamingResponse(
        upload_service.process_pdf_stream(
            content=content, filename=filename, pdf_hash=pdf_hash, page_count=page_count,
            ai_model=ai_model, use_blueprint=use_blueprint, parsing_mode=parsing_mode,
            parser=parser, lecture_id=lecture_id, user_id=user_id
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
    user: Any = Depends(require_professor),
):
    max_bytes = MAX_FILE_MB * 1024 * 1024
    chunks = []
    bytes_read = 0
    while True:
        chunk = await file.read(65536)
        if not chunk: break
        bytes_read += len(chunk)
        if bytes_read > max_bytes:
            raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_FILE_MB}MB limit.")
        chunks.append(chunk)
    content = b"".join(chunks)
    
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
    user: Any = Depends(require_professor),
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
    user: Any = Depends(require_professor),
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
    user: Any = Depends(require_professor),
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
    user: Any = Depends(require_professor),
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
    user: Any = Depends(require_professor),
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

@router.post("/parse-raw")
@limiter.limit("10/minute")
async def parse_raw_endpoint(
    request: Request,
    file: UploadFile = File(...),
    parser: str = Form("auto"),
    user: Any = Depends(require_professor),
):
    max_bytes = MAX_FILE_MB * 1024 * 1024
    chunks = []
    bytes_read = 0
    while True:
        chunk = await file.read(65536)
        if not chunk: break
        bytes_read += len(chunk)
        if bytes_read > max_bytes:
            raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_FILE_MB}MB limit.")
        chunks.append(chunk)
    content = b"".join(chunks)

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
    user: Any = Depends(require_professor),
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
    user: Any = Depends(require_professor),
):
    deleted = await purge_expired_slide_checkpoints()
    return {"deleted": deleted, "message": f"Purged {deleted} expired checkpoint rows."}
