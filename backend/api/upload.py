from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Form
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from typing import Any, List
from fastapi.responses import StreamingResponse
import json
from backend.services.file_parse_service import parse_pdf, parse_pdf_stream
from backend.core.auth_middleware import verify_token


class ParsedSlideResponse(BaseModel):
    slides: List[Any]
    total: int

router = APIRouter(prefix="/api/upload", tags=["upload"])


@router.post("/parse-pdf", response_model=ParsedSlideResponse)
async def parse_pdf_endpoint(
    file: UploadFile = File(...),
    ai_model: str = Form("groq"),
    user=Depends(verify_token)
):
    """
    Upload a PDF lecture file and receive extracted slide content.
    """
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    if file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=400, detail="Invalid file type. Expected a PDF.")

    MAX_PDF_BYTES = 50 * 1024 * 1024  # 50 MB
    try:
        content = await file.read()
        if len(content) > MAX_PDF_BYTES:
            raise HTTPException(status_code=413, detail="File too large. Maximum allowed size is 50 MB.")
        slides = await run_in_threadpool(parse_pdf, content, ai_model)
        return ParsedSlideResponse(slides=slides, total=len(slides))
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to parse PDF. Please try again.")


@router.post("/parse-pdf-stream")
async def parse_pdf_stream_endpoint(
    file: UploadFile = File(...),
    ai_model: str = Form("groq"),
    user=Depends(verify_token)
):
    """
    Upload a PDF and receive a stream of progress updates followed by the final results.
    """
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    
    content = await file.read()

    async def event_generator():
        try:
            async for update in parse_pdf_stream(content, ai_model):
                yield f"data: {json.dumps(update)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
