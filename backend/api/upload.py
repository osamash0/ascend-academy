import logging
import json
import asyncio
from typing import Any, List, Dict, Optional
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from backend.services.file_parse_service import parse_pdf_stream
from backend.services.cache import compute_pdf_hash, get_cached_parse, store_cached_parse
from backend.core.auth_middleware import verify_token

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
async def parse_pdf_stream_endpoint(
    file: UploadFile = File(...),
    ai_model: str = Form("groq"),
    use_blueprint: bool = Form(True),
    user: Any = Depends(verify_token),
):
    """
    Streamed PDF parsing endpoint.
    1. Validates upload.
    2. Checks semantic cache.
    3. Streams real-time progress and slide objects via SSE.
    """
    content = await file.read()
    await validate_upload(file, content)

    filename = file.filename or "upload.pdf"
    pdf_hash = compute_pdf_hash(content)

    # 1. Check cache
    cached = await get_cached_parse(pdf_hash)
    if cached:
        logger.info("Cache hit for %s", filename)
        async def cached_stream():
            slides = cached.get("slides", [])
            total = len(slides)
            yield f"data: {json.dumps({'type': 'progress', 'current': 0, 'total': total, 'message': 'Loading from cache...'})}\n\n"
            for i, s in enumerate(slides):
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
            logger.error("Streaming parse failed: %s", e, exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            # Save to cache if we got results
            if collected_slides:
                await store_cached_parse(pdf_hash, {"slides": collected_slides, "deck": collected_deck})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )
