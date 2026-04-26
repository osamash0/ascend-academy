from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from backend.services.ai_service import generate_summary, generate_quiz, generate_analytics_insights, chat_with_lecture, generate_speech
import io
from backend.services.content_filter import is_metadata_slide
from backend.core.auth_middleware import verify_token

router = APIRouter(prefix="/api/ai", tags=["ai"])

class SlideTextRequest(BaseModel):
    slide_text: str
    ai_model: Optional[str] = "groq"

class AnalyticsStatsRequest(BaseModel):
    total_students: int = 0
    average_score: float = 0
    total_attempts: int = 0
    total_correct: int = 0
    hard_slides: Optional[str] = None
    engaging_slides: Optional[str] = None
    weekly_trend: Optional[str] = None
    confidence_summary: Optional[str] = None
    ai_model: Optional[str] = "groq"

class ChatRequest(BaseModel):
    slide_text: str
    user_message: str
    chat_history: Optional[List[Dict[str, Any]]] = None
    ai_model: Optional[str] = "groq"

class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "en-US-AvaNeural"

@router.post("/generate-summary")
def generate_summary_endpoint(body: SlideTextRequest, user=Depends(verify_token)):
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")

    # Content filter: skip metadata slides
    filter_result = is_metadata_slide(body.slide_text, ai_model=body.ai_model or "groq")
    if filter_result["is_metadata"]:
        return {"summary": "This slide contains administrative information (e.g. instructor details, dates, logistics) and is not suitable for summarization."}

    try:
        summary = generate_summary(body.slide_text, ai_model=body.ai_model)
        return {"summary": summary}
    except Exception as e:
        print(f"DEBUG ai_content generate-summary error: {e}")
        raise HTTPException(status_code=500, detail="AI summary generation failed. Please try again.")

@router.post("/generate-quiz")
def generate_quiz_endpoint(body: SlideTextRequest, user=Depends(verify_token)):
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")

    # Content filter: skip metadata slides
    filter_result = is_metadata_slide(body.slide_text, ai_model=body.ai_model or "groq")
    if filter_result["is_metadata"]:
        return {
            "question": "This slide contains administrative information and is not suitable for quiz generation.",
            "options": ["N/A", "N/A", "N/A", "N/A"],
            "correctAnswer": 0
        }

    try:
        quiz = generate_quiz(body.slide_text, ai_model=body.ai_model)
        return quiz
    except Exception as e:
        print(f"DEBUG ai_content generate-quiz error: {e}")
        raise HTTPException(status_code=500, detail="AI quiz generation failed. Please try again.")

@router.post("/analytics-insights")
def analytics_insights_endpoint(body: AnalyticsStatsRequest, user=Depends(verify_token)):
    try:
        # Pydantic dict() includes all fields
        data = body.dict()
        model_choice = data.pop('ai_model', 'groq')
        result = generate_analytics_insights(data, ai_model=model_choice)
        return result
    except Exception as e:
        print(f"DEBUG ai_content analytics-insights error: {e}")
        raise HTTPException(status_code=500, detail="AI insights generation failed. Please try again.")

@router.post("/chat")
def chat_with_tutor_endpoint(body: ChatRequest, user=Depends(verify_token)):
    if not body.user_message.strip():
        raise HTTPException(status_code=400, detail="user_message cannot be empty.")
    try:
        reply = chat_with_lecture(
            slide_text=body.slide_text,
            user_message=body.user_message,
            chat_history=body.chat_history,
            ai_model=body.ai_model
        )
        return {"reply": reply}
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"DEBUG ai_content chat error: {e}")
        raise HTTPException(status_code=500, detail="AI tutor failed to respond. Please try again.")

@router.post("/tts")
async def text_to_speech_endpoint(body: TTSRequest, user=Depends(verify_token)):
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")
    
    try:
        audio_content = await generate_speech(body.text, voice=body.voice)
        return StreamingResponse(io.BytesIO(audio_content), media_type="audio/mpeg")
    except Exception as e:
        print(f"DEBUG ai_content tts error: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate AI voice.")
