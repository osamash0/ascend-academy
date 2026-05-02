import logging
import json
import asyncio
from typing import Any, List, Dict, Optional
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Form, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from backend.services.file_parse_service import (
    PIPELINE_VERSION,
    parse_pdf_stream,
    _safe_embedding_task,
)
from backend.core.database import supabase_admin
from backend.services.cache import (
    attach_lecture_id_to_embeddings,
    compute_pdf_hash,
    get_cached_parse,
    get_cached_slide_results,
    get_pipeline_run,
    store_cached_parse,
)
from backend.services.diagnostics import flag_suspicious
from backend.core.auth_middleware import verify_token, require_professor
from backend.core.rate_limit import limiter
from backend.repositories.lecture_repo import list_lectures_by_pdf_hash

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

    # 1. Check cache (skipped when the user explicitly opts to re-parse a
    #    PDF they've already uploaded — the duplicate dialog uses this to
    #    guarantee a genuinely fresh parse for the "Upload as new" choice).
    cached = None if force_reparse else await get_cached_parse(pdf_hash)
    if cached:
        logger.info("Cache hit for %s", filename)
        async def cached_stream():
            slides = cached.get("slides", [])
            total = len(slides)
            # Emit pdf_hash up front so the frontend can call /attach-lecture
            # after the lecture row is created — matches the non-cache path.
            yield f"data: {json.dumps({'type': 'meta', 'pdf_hash': pdf_hash})}\n\n"
            yield f"data: {json.dumps({'type': 'progress', 'current': 0, 'total': total, 'message': 'Loading from cache...'})}\n\n"
            # Best-effort: schedule embedding jobs for the cached slides so
            # the grounded tutor still has vectors to retrieve from for PDFs
            # whose parse was cached before embeddings existed (or whose
            # earlier embed attempts failed). store_slide_embedding is
            # idempotent on (pdf_hash, slide_index, pipeline_version), so
            # re-running on already-embedded slides is safe.
            _embed_failed_queue: List[Any] = []
            for i, s in enumerate(slides):
                if not (s.get("is_metadata") or s.get("slide_type") == "metadata"):
                    asyncio.create_task(
                        _safe_embedding_task(i, s, pdf_hash, _embed_failed_queue)
                    )
                yield f"data: {json.dumps({'type': 'slide', 'index': i, 'slide': s})}\n\n"
            
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

    # Attempt ODL extraction before streaming; fall back to PyMuPDF on failure
    odl_pages = None
    try:
        from backend.services.odl_service import extract_pages
        odl_pages = await extract_pages(content, filename)
        logger.info("ODL extraction successful for %s", filename)
    except Exception as e:
        logger.warning("ODL failed, falling back to PyMuPDF: %s", e)

    async def event_generator():
        nonlocal collected_deck
        try:
            async for update in parse_pdf_stream(content, filename=filename, ai_model=ai_model, use_blueprint=use_blueprint, odl_pages=odl_pages):
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
            # Save to cache if we got results
            if collected_slides:
                await store_cached_parse(pdf_hash, {"slides": collected_slides, "deck": collected_deck})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


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
