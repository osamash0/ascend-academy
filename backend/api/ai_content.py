import logging
import io
import urllib.request
import asyncio
from typing import Annotated, Literal, Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from supabase import create_client, Client

from backend.core.database import SUPABASE_URL, ANON_KEY, supabase_admin
from backend.core.auth_middleware import verify_token, require_professor
from backend.core.rate_limit import limiter
from backend.services.ai_service import (
    generate_summary, generate_quiz, generate_analytics_insights, 
    chat_with_lecture, generate_speech, generate_metric_feedback, 
    analyze_slide_vision, generate_slide_title, enhance_slide_content
)
from backend.services.content_filter import is_metadata_slide

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai", tags=["ai"])
_security = HTTPBearer()

_AiModel = Annotated[
    Literal["groq", "gemini-2.0-flash", "llama3", "cerebras"],
    Field("groq", description="Which LLM backend to use"),
]

# --- Pydantic Models ---

class SlideTextRequest(BaseModel):
    slide_text: str = Field(..., min_length=1, max_length=10_000)
    ai_model: _AiModel = "groq"

class AnalyticsStatsRequest(BaseModel):
    total_students: int = Field(0, ge=0)
    average_score: float = Field(0, ge=0, le=100)
    total_attempts: int = Field(0, ge=0)
    total_correct: int = Field(0, ge=0)
    ai_model: _AiModel = "groq"

class MetricInsightRequest(BaseModel):
    metric_name: str
    metric_value: Any
    context_stats: Dict[str, Any]
    ai_model: _AiModel = "groq"

class ChatRequest(BaseModel):
    slide_text: str = Field(..., min_length=0, max_length=10_000)
    user_message: str = Field(..., min_length=1, max_length=2_000)
    chat_history: Optional[List[Dict[str, Any]]] = None
    ai_model: _AiModel = "groq"

class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5_000)
    voice: Optional[str] = "en-US-AvaNeural"

class SummaryResponse(BaseModel):
    summary: str

class QuizResponse(BaseModel):
    question: str
    options: List[str] = Field(..., min_length=4, max_length=4)
    correctAnswer: int = Field(..., ge=0, le=3)

class InsightsResponse(BaseModel):
    summary: str
    suggestions: List[str]

class ChatResponse(BaseModel):
    reply: str

# --- Endpoints ---

@router.post("/generate-summary", response_model=SummaryResponse)
async def generate_summary_endpoint(body: SlideTextRequest, user: Any = Depends(verify_token)):
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")

    filter_result = is_metadata_slide(body.slide_text, ai_model=body.ai_model)
    if filter_result.get("is_metadata"):
        return SummaryResponse(summary="This slide contains administrative information and is not suitable for summarization.")

    try:
        summary = await generate_summary(body.slide_text, ai_model=body.ai_model)
        return SummaryResponse(summary=summary)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="AI summary timed out. Please retry.")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("AI summary failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="AI service unavailable. Please try a different model or retry shortly.")

@router.post("/generate-quiz", response_model=QuizResponse)
async def generate_quiz_endpoint(body: SlideTextRequest, user: Any = Depends(verify_token)):
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")

    filter_result = is_metadata_slide(body.slide_text, ai_model=body.ai_model)
    if filter_result.get("is_metadata"):
        return QuizResponse(
            question="This slide contains administrative information.",
            options=["N/A", "N/A", "N/A", "N/A"],
            correctAnswer=0
        )

    try:
        quiz = await generate_quiz(body.slide_text, ai_model=body.ai_model)
        # Ensure correct return format
        if isinstance(quiz, list) and quiz:
            quiz = quiz[0]
        return QuizResponse(**quiz)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="AI quiz timed out. Please retry.")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"AI returned invalid quiz format: {e}")
    except Exception as e:
        logger.error("AI quiz failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="AI service unavailable. Please try a different model or retry shortly.")

@router.post("/suggest-title")
async def suggest_title_endpoint(body: SlideTextRequest, user: Any = Depends(verify_token)):
    try:
        title = await generate_slide_title(body.slide_text)
        return {"title": title}
    except Exception as e:
        logger.error("AI title failed: %s", e)
        raise HTTPException(status_code=500, detail="AI title suggestion failed.")

@router.post("/suggest-content")
async def suggest_content_endpoint(body: SlideTextRequest, user: Any = Depends(verify_token)):
    try:
        enhanced = await enhance_slide_content(body.slide_text, ai_model=body.ai_model)
        return {"content": enhanced.get("content", body.slide_text)}
    except Exception as e:
        logger.error("AI content enhancement failed: %s", e)
        raise HTTPException(status_code=500, detail="AI content enhancement failed.")

@router.post("/analytics-insights", response_model=InsightsResponse)
async def analytics_insights_endpoint(body: AnalyticsStatsRequest, user: Any = Depends(verify_token)):
    try:
        result = await generate_analytics_insights(body.dict(), ai_model=body.ai_model)
        return InsightsResponse(**result)
    except Exception as e:
        logger.error("AI insights failed: %s", e)
        raise HTTPException(status_code=500, detail="AI insights generation failed.")

@router.post("/metric-feedback")
async def metric_feedback_endpoint(body: MetricInsightRequest, user: Any = Depends(verify_token)):
    try:
        feedback = await generate_metric_feedback(
            metric_name=body.metric_name,
            metric_value=body.metric_value,
            context_stats=body.context_stats,
            ai_model=body.ai_model
        )
        return {"feedback": feedback}
    except Exception as e:
        logger.error("AI metric feedback failed: %s", e)
        raise HTTPException(status_code=500, detail="AI metric feedback failed.")

@router.post("/chat", response_model=ChatResponse)
@limiter.limit("30/minute")
async def chat_with_tutor_endpoint(request: Request, body: ChatRequest, user: Any = Depends(verify_token)):
    try:
        reply = await chat_with_lecture(
            slide_text=body.slide_text,
            user_message=body.user_message,
            chat_history=body.chat_history,
            ai_model=body.ai_model,
        )
        return ChatResponse(reply=reply)
    except Exception as e:
        logger.error("AI tutor failed: %s", e)
        raise HTTPException(status_code=500, detail="AI tutor failed to respond.")

@router.post("/tts")
@limiter.limit("20/minute")
async def text_to_speech_endpoint(request: Request, body: TTSRequest, user: Any = Depends(verify_token)):
    try:
        audio_content = await generate_speech(body.text, voice=body.voice)
        return StreamingResponse(io.BytesIO(audio_content), media_type="audio/mpeg")
    except Exception as e:
        logger.error("TTS failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to generate AI voice.")

# --- Single Slide Regeneration ---

class RegenerateSlideRequest(BaseModel):
    ai_model: _AiModel = "groq"

@router.post("/slides/{slide_id}/regenerate-content")
@limiter.limit("10/minute")
async def regenerate_slide_content(
    request: Request,
    slide_id: str,
    body: RegenerateSlideRequest,
    user: Any = Depends(require_professor),
    creds: HTTPAuthorizationCredentials = Depends(_security),
):
    """Re-analyzes a single slide and updates the database."""
    # Use user-authenticated client for RLS check
    client: Client = create_client(SUPABASE_URL, ANON_KEY)
    client.postgrest.auth(creds.credentials)

    # 1. Fetch slide + lecture
    res = client.table("slides") \
        .select("slide_number, lecture_id, lectures(pdf_url, professor_id)") \
        .eq("id", slide_id) \
        .maybe_single() \
        .execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Slide not found.")

    lecture_info = res.data.get("lectures", {}) or {}
    user_id = user.id if hasattr(user, "id") else user.get("id")
    if lecture_info.get("professor_id") != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized.")
    
    pdf_url = lecture_info.get("pdf_url")
    if not pdf_url:
        raise HTTPException(status_code=400, detail="No PDF attached.")

    slide_num: int = res.data["slide_number"]

    # 2. Download PDF
    try:
        def _download():
            with urllib.request.urlopen(pdf_url) as resp:
                return resp.read()
        pdf_bytes = await asyncio.to_thread(_download)
    except Exception as e:
        logger.error("PDF download failed: %s", e)
        raise HTTPException(status_code=502, detail="Could not download PDF.")

    # 3. Analyze Slide (Vision)
    from backend.services.file_parse_service import _render_page_to_jpeg, safe_truncate_text
    import fitz

    def _extract():
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            page = doc[slide_num - 1]
            img = _render_page_to_jpeg(page)
            text = page.get_text("text")
            return img, text

    img_bytes, raw_text = await asyncio.to_thread(_extract)
    
    # Run vision analysis
    import base64
    b64 = base64.b64encode(img_bytes).decode("utf-8")
    analysis = await analyze_slide_vision(b64, raw_text, ai_model=body.ai_model)
    
    # 4. Update Database
    from backend.services.ai.vision import format_slide_content
    content = format_slide_content(analysis.get("content_extraction", {}))
    
    client.table("slides").update({
        "title": analysis.get("metadata", {}).get("lecture_title") or f"Slide {slide_num}",
        "content_text": content,
        "summary": analysis.get("content_extraction", {}).get("summary", ""),
    }).eq("id", slide_id).execute()

    # Replace quiz
    quiz = analysis.get("quiz")
    if quiz:
        client.table("quiz_questions").delete().eq("slide_id", slide_id).execute()
        client.table("quiz_questions").insert({
            "slide_id": slide_id,
            "question_text": quiz["question"],
            "options": quiz["options"],
            "correct_answer": quiz["correctAnswer"],
        }).execute()

    return {"success": True, "analysis": analysis}
