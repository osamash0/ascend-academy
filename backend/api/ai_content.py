from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from backend.services.ai_service import generate_summary, generate_quiz, generate_analytics_insights, chat_with_lecture
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


class ChatRequest(BaseModel):
    slide_text: str
    user_message: str
    chat_history: Optional[List[Dict[str, Any]]] = None


@router.post("/generate-summary")
async def generate_summary_endpoint(body: SlideTextRequest, user=Depends(verify_token)):
    """Generate a concise summary for the given slide text using Ollama."""
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")
    try:
        summary = generate_summary(body.slide_text)
        return {"summary": summary}
    except Exception as e:
        print(f"DEBUG ai_content generate-summary error: {e}")
        raise HTTPException(status_code=500, detail="AI summary generation failed. Please try again.")


@router.post("/generate-quiz")
async def generate_quiz_endpoint(body: SlideTextRequest, user=Depends(verify_token)):
    """Generate a multiple-choice quiz question for the given slide text using Ollama."""
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")
    try:
        quiz = generate_quiz(body.slide_text)
        return quiz
    except Exception as e:
        print(f"DEBUG ai_content generate-quiz error: {e}")
        raise HTTPException(status_code=500, detail="AI quiz generation failed. Please try again.")


@router.post("/analytics-insights")
async def analytics_insights_endpoint(body: AnalyticsStatsRequest, user=Depends(verify_token)):
    """Return AI-generated friendly summary and suggestions for the professor based on analytics data."""
    try:
        result = generate_analytics_insights(body.dict())
        return result
    except Exception as e:
        print(f"DEBUG ai_content analytics-insights error: {e}")
        raise HTTPException(status_code=500, detail="AI insights generation failed. Please try again.")

@router.post("/chat")
async def chat_with_tutor_endpoint(body: ChatRequest, user=Depends(verify_token)):
    """Acts as a RAG AI tutor, answering a student's question based on the slide's text."""
    if not body.user_message.strip():
        raise HTTPException(status_code=400, detail="user_message cannot be empty.")
    try:
        reply = chat_with_lecture(
            slide_text=body.slide_text,
            user_message=body.user_message,
            chat_history=body.chat_history
        )
        return {"reply": reply}
    except Exception as e:
        print(f"DEBUG ai_content chat error: {e}")
        raise HTTPException(status_code=500, detail="AI tutor failed to respond. Please try again.")

