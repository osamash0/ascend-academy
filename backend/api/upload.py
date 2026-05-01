import logging
import hashlib
import json
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Form
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Any, List
from backend.services.file_parse_service import parse_pdf, parse_pdf_stream
from backend.services.cache import compute_pdf_hash, get_cached_parse, store_cached_parse
from backend.core.auth_middleware import verify_token

logger = logging.getLogger(__name__)

MAX_FILE_MB = 25
MAX_PAGES = 80


class ParsedSlideResponse(BaseModel):
    slides: List[Any]
    total: int


router = APIRouter(prefix="/api/upload", tags=["upload"])


async def validate_upload(file: UploadFile, content: bytes) -> None:
    """Raise HTTPException on any validation failure before processing starts."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    if file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=400, detail="Invalid content type. Expected application/pdf.")

    if len(content) > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_FILE_MB}MB limit.")

    if len(content) < 8:
        raise HTTPException(status_code=400, detail="File is too small to be a valid PDF.")

    try:
        import fitz
        doc = fitz.open(stream=content, filetype="pdf")
        page_count = len(doc)
        doc.close()
    except Exception:
        raise HTTPException(status_code=400, detail="File appears to be corrupted or password-protected.")

    if page_count == 0:
        raise HTTPException(status_code=400, detail="PDF has no pages.")

    if page_count > MAX_PAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Max {MAX_PAGES} slides supported. This file has {page_count}.",
        )


@router.post("/parse-pdf", response_model=ParsedSlideResponse)
async def parse_pdf_endpoint(
    file: UploadFile = File(...),
    ai_model: str = Form("groq"),
    use_blueprint: bool = Form(True),
    user=Depends(verify_token),
):
    content = await file.read()
    await validate_upload(file, content)

    try:
        # For blocking endpoint, we'll pass use_blueprint though it might need refactoring too
        slides = await run_in_threadpool(parse_pdf, content, ai_model)
        return ParsedSlideResponse(slides=slides, total=len(slides))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("PDF parse failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to parse PDF. Please try again.")


@router.post("/parse-pdf-stream")
async def parse_pdf_stream_endpoint(
    file: UploadFile = File(...),
    ai_model: str = Form("groq"),
    use_blueprint: bool = Form(True),
    user=Depends(verify_token),
):
    content = await file.read()
    await validate_upload(file, content)

    filename = file.filename or "upload.pdf"
    pdf_hash = compute_pdf_hash(content)

    # Check content-hash cache — return instantly for re-uploaded PDFs
    cached = await get_cached_parse(pdf_hash)
    if cached:
        logger.info("Cache hit for %s (%s)", filename, pdf_hash[:12])

        async def cached_stream():
            slides_list = cached.get("slides", [])
            total = len(slides_list)
            # Send initial progress so uploadTotal gets set on the frontend
            yield f"data: {json.dumps({'type': 'progress', 'current': 0, 'total': total, 'message': 'Loading from cache...'})}\n\n"
            for idx, slide_dict in enumerate(slides_list):
                if "_meta" in slide_dict:
                    slide_dict["_meta"]["cached"] = True
                yield f"data: {json.dumps({'type': 'progress', 'current': idx + 1, 'total': total, 'message': f'Slide {idx + 1} of {total} (cached)'})}\n\n"
                yield f"data: {json.dumps({'type': 'slide', 'index': idx, 'slide': slide_dict})}\n\n"
            deck = cached.get("deck", {})
            yield f"data: {json.dumps({'type': 'deck_complete', 'deck_summary': deck.get('deck_summary', ''), 'deck_quiz': deck.get('deck_quiz', []), 'total_slides': total})}\n\n"
            yield f"data: {json.dumps({'type': 'complete', 'total': total})}\n\n"

        return StreamingResponse(
            cached_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Full parse — collect results as they stream so we can cache afterwards
    collected_slides: list[dict] = []
    collected_deck: dict = {}

    async def event_generator():
        nonlocal collected_deck
        try:
            async for update in parse_pdf_stream(content, filename=filename, ai_model=ai_model, use_blueprint=use_blueprint):
                if update.get("type") == "slide":
                    collected_slides.append(update["slide"])
                elif update.get("type") == "deck_complete":
                    collected_deck = {
                        "deck_summary": update.get("deck_summary", ""),
                        "deck_quiz": update.get("deck_quiz", []),
                    }
                yield f"data: {json.dumps(update)}\n\n"
        except Exception as e:
            logger.error("Stream failed: %s", e, exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            # Persist to cache after stream completes (best-effort)
            if collected_slides:
                try:
                    await store_cached_parse(pdf_hash, {"slides": collected_slides, "deck": collected_deck})
                except Exception as ce:
                    logger.warning("Cache store failed: %s", ce)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
