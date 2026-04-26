from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Form
from fastapi.concurrency import run_in_threadpool
from backend.services.file_parse_service import parse_pdf
from backend.core.auth_middleware import verify_token

router = APIRouter(prefix="/api/upload", tags=["upload"])


@router.post("/parse-pdf")
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

    try:
        content = await file.read()
        slides = await run_in_threadpool(parse_pdf, content, ai_model)
        return {"slides": slides, "total": len(slides)}
    except Exception as e:
        print(f"DEBUG upload parse-pdf error: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse PDF. Please try again.")
