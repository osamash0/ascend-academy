from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.services.ai_service import generate_summary, generate_quiz

router = APIRouter(prefix="/api/ai", tags=["ai"])


class SlideTextRequest(BaseModel):
    slide_text: str


@router.post("/generate-summary")
async def generate_summary_endpoint(body: SlideTextRequest):
    """
    Generate a concise summary for the given slide text using Ollama.
    """
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")
    try:
        summary = generate_summary(body.slide_text)
        return {"summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI summary failed: {str(e)}")


@router.post("/generate-quiz")
async def generate_quiz_endpoint(body: SlideTextRequest):
    """
    Generate a multiple-choice quiz question for the given slide text using Ollama.
    """
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")
    try:
        quiz = generate_quiz(body.slide_text)
        return quiz
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI quiz generation failed: {str(e)}")
