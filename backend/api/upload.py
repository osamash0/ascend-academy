from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from backend.services.file_parse_service import parse_pdf
from backend.core.auth_middleware import verify_token

router = APIRouter(prefix="/api/upload", tags=["upload"])


@router.post("/parse-pdf")
async def parse_pdf_endpoint(file: UploadFile = File(...), user=Depends(verify_token)):
    """
    Upload a PDF lecture file and receive extracted slide content.
    """
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    try:
        content = await file.read()
        slides = parse_pdf(content)
        return {"slides": slides, "total": len(slides)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse PDF: {str(e)}")
