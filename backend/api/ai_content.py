from fastapi import APIRouter, HTTPException, Depends
import logging

logger = logging.getLogger(__name__)
from fastapi.responses import StreamingResponse
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from typing import Annotated, Literal, Optional, List, Dict, Any
from backend.services.ai_service import generate_summary, generate_quiz, generate_analytics_insights, chat_with_lecture, generate_speech, generate_metric_feedback, analyze_slide_vision
from backend.services.file_parse_service import _page_to_base64, _extract_text_page, _build_slide_from_vision
from backend.core.database import supabase as _db, url as _url, key as _key
import io
import urllib.request
from backend.services.content_filter import is_metadata_slide
from backend.core.auth_middleware import verify_token
from supabase import create_client as _create_client

router = APIRouter(prefix="/api/ai", tags=["ai"])

_AiModel = Annotated[
    Literal["groq", "gemini-2.5-flash", "llama3"],
    Field("groq", description="Which LLM backend to use"),
]


class SlideTextRequest(BaseModel):
    slide_text: str = Field(..., min_length=1, max_length=10_000)
    ai_model: _AiModel = "groq"


class AnalyticsStatsRequest(BaseModel):
    total_students: int = Field(0, ge=0)
    average_score: float = Field(0, ge=0, le=100)
    total_attempts: int = Field(0, ge=0)
    total_correct: int = Field(0, ge=0)
    hard_slides: Optional[str] = None
    engaging_slides: Optional[str] = None
    weekly_trend: Optional[str] = None
    confidence_summary: Optional[str] = None
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


# ── Response models ──────────────────────────────────────────────────────────

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


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/generate-summary", response_model=SummaryResponse)
def generate_summary_endpoint(body: SlideTextRequest, user=Depends(verify_token)):
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")

    filter_result = is_metadata_slide(body.slide_text, ai_model=body.ai_model or "groq")
    if filter_result["is_metadata"]:
        return SummaryResponse(summary="This slide contains administrative information and is not suitable for summarization.")

    try:
        summary = generate_summary(body.slide_text, ai_model=body.ai_model)
        return SummaryResponse(summary=summary)
    except Exception as e:
        logger.error("AI summary generation failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="AI summary generation failed. Please try again.")


@router.post("/generate-quiz", response_model=QuizResponse)
def generate_quiz_endpoint(body: SlideTextRequest, user=Depends(verify_token)):
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")

    filter_result = is_metadata_slide(body.slide_text, ai_model=body.ai_model or "groq")
    if filter_result["is_metadata"]:
        return QuizResponse(
            question="This slide contains administrative information and is not suitable for quiz generation.",
            options=["N/A", "N/A", "N/A", "N/A"],
            correctAnswer=0,
        )

    try:
        quiz = generate_quiz(body.slide_text, ai_model=body.ai_model)
        return QuizResponse(**quiz)
    except Exception as e:
        logger.error("AI quiz generation failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="AI quiz generation failed. Please try again.")


@router.post("/analytics-insights", response_model=InsightsResponse)
def analytics_insights_endpoint(body: AnalyticsStatsRequest, user=Depends(verify_token)):
    try:
        data = body.dict()
        model_choice = data.pop("ai_model", "groq")
        result = generate_analytics_insights(data, ai_model=model_choice)
        return InsightsResponse(**result)
    except Exception as e:
        logger.error("AI insights generation failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="AI insights generation failed. Please try again.")


@router.post("/metric-feedback")
def metric_feedback_endpoint(body: MetricInsightRequest, user=Depends(verify_token)):
    try:
        feedback = generate_metric_feedback(
            metric_name=body.metric_name,
            metric_value=body.metric_value,
            context_stats=body.context_stats,
            ai_model=body.ai_model
        )
        return {"feedback": feedback}
    except Exception as e:
        logger.error("AI metric feedback failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="AI metric feedback failed.")


@router.post("/chat", response_model=ChatResponse)
def chat_with_tutor_endpoint(body: ChatRequest, user=Depends(verify_token)):
    try:
        reply = chat_with_lecture(
            slide_text=body.slide_text,
            user_message=body.user_message,
            chat_history=body.chat_history,
            ai_model=body.ai_model,
        )
        return ChatResponse(reply=reply)
    except Exception as e:
        logger.error("Endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="AI tutor failed to respond. Please try again.")


@router.post("/tts")
async def text_to_speech_endpoint(body: TTSRequest, user=Depends(verify_token)):
    try:
        audio_content = await generate_speech(body.text, voice=body.voice)
        return StreamingResponse(io.BytesIO(audio_content), media_type="audio/mpeg")
    except Exception as e:
        logger.error("Endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate AI voice.")


# ── Slide content regeneration ────────────────────────────────────────────────

class RegenerateSlideRequest(BaseModel):
    ai_model: _AiModel = "groq"


@router.post("/slides/{slide_id}/regenerate-content")
async def regenerate_slide_content(
    slide_id: str,
    body: RegenerateSlideRequest,
    user=Depends(verify_token),
):
    """
    Re-analyze a single slide using the vision pipeline and update the database.
    Only the professor who owns the lecture may call this.
    """
    client = _create_client(_url, _key)
    client.postgrest.auth(user["token"])

    # Fetch slide + lecture in one query
    res = client.table("slides") \
        .select("slide_number, lecture_id, lectures(pdf_url, professor_id)") \
        .eq("id", slide_id) \
        .maybe_single() \
        .execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Slide not found.")

    lecture_info = res.data.get("lectures", {}) or {}
    professor_id = lecture_info.get("professor_id")
    pdf_url = lecture_info.get("pdf_url")

    if professor_id != user["id"]:
        raise HTTPException(status_code=403, detail="Only the lecture's professor can regenerate slide content.")
    if not pdf_url:
        raise HTTPException(status_code=400, detail="No PDF attached to this lecture.")

    slide_number: int = res.data["slide_number"]

    # Download PDF from Supabase Storage public URL
    try:
        with urllib.request.urlopen(pdf_url) as resp:
            pdf_bytes = resp.read()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not download lecture PDF: {e}")

    # Convert page to image + extract text (blocking — run in thread)
    b64 = await run_in_threadpool(_page_to_base64, pdf_bytes, slide_number)
    raw_text = await run_in_threadpool(_extract_text_page, pdf_bytes, slide_number - 1)

    if not b64:
        raise HTTPException(status_code=500, detail="Could not render slide as image. Ensure poppler is installed.")

    # Vision analysis
    analysis = await run_in_threadpool(analyze_slide_vision, b64, raw_text, body.ai_model)
    slide_data = _build_slide_from_vision(analysis, slide_number, raw_text)

    # Update slide record
    client.table("slides").update({
        "title": slide_data["title"],
        "content_text": slide_data["content"],
        "summary": slide_data["summary"],
    }).eq("id", slide_id).execute()

    # Replace quiz questions
    client.table("quiz_questions").delete().eq("slide_id", slide_id).execute()
    for q in slide_data.get("questions", []):
        if q.get("question", "").strip():
            client.table("quiz_questions").insert({
                "slide_id": slide_id,
                "question_text": q["question"],
                "options": q["options"],
                "correct_answer": q["correctAnswer"],
            }).execute()

    return {
        "success": True,
        "slide": {
            "title": slide_data["title"],
            "content_text": slide_data["content"],
            "summary": slide_data["summary"],
            "slide_type": slide_data.get("slide_type", "content_slide"),
            "questions": slide_data.get("questions", []),
        },
    }
