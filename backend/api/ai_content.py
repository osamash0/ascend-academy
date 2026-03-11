from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from backend.services.ai_service import generate_summary, generate_quiz, generate_analytics_insights
from backend.core.auth_middleware import verify_token

router = APIRouter(prefix="/api/ai", tags=["ai"])


class SlideTextRequest(BaseModel):
    slide_text: str


class AnalyticsStatsRequest(BaseModel):
    total_students: int = 0
    average_score: float = 0
    total_attempts: int = 0
    total_correct: int = 0
    hard_slides: Optional[str] = None
    engaging_slides: Optional[str] = None
    weekly_trend: Optional[str] = None
    confidence_summary: Optional[str] = None


@router.post("/generate-summary")
async def generate_summary_endpoint(body: SlideTextRequest, user=Depends(verify_token)):
    """Generate a concise summary for the given slide text using Ollama."""
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")
    try:
        summary = generate_summary(body.slide_text)
        return {"summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI summary failed: {str(e)}")


@router.post("/generate-quiz")
async def generate_quiz_endpoint(body: SlideTextRequest, user=Depends(verify_token)):
    """Generate a multiple-choice quiz question for the given slide text using Ollama."""
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")
    try:
        quiz = generate_quiz(body.slide_text)
        return quiz
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI quiz generation failed: {str(e)}")


@router.post("/analytics-insights")
async def analytics_insights_endpoint(body: AnalyticsStatsRequest, user=Depends(verify_token)):
    """Return AI-generated friendly summary and suggestions for the professor based on analytics data."""
    try:
        result = generate_analytics_insights(body.dict())
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI insights failed: {str(e)}")

