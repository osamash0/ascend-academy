from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from backend.services.ai_service import generate_summary, generate_quiz, generate_analytics_insights, generate_real_world_relevance

router = APIRouter(prefix="/api/ai", tags=["ai"])


class SlideTextRequest(BaseModel):
    slide_text: str

class SlideRelevanceRequest(BaseModel):
    slide_text: str
    previous_examples: List[str] = []


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
async def generate_summary_endpoint(body: SlideTextRequest):
    """Generate a concise summary for the given slide text using Ollama."""
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")
    try:
        summary = generate_summary(body.slide_text)
        return {"summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI summary failed: {str(e)}")


@router.post("/generate-quiz")
async def generate_quiz_endpoint(body: SlideTextRequest):
    """Generate a multiple-choice quiz question for the given slide text using Ollama."""
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")
    try:
        quiz = generate_quiz(body.slide_text)
        return quiz
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI quiz generation failed: {str(e)}")


@router.post("/analytics-insights")
async def analytics_insights_endpoint(body: AnalyticsStatsRequest):
    """Return AI-generated friendly summary and suggestions for the professor based on analytics data."""
    try:
        result = generate_analytics_insights(body.dict())
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI insights failed: {str(e)}")


@router.post("/generate-relevance")
async def generate_relevance_endpoint(body: SlideRelevanceRequest):
    """Generate a highly specific, realistic industry application for the concept in a slide."""
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")
    try:
        relevance_data = generate_real_world_relevance(body.slide_text, body.previous_examples)
        return relevance_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI relevance generation failed: {str(e)}")

