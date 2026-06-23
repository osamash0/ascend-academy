import logging
from typing import Annotated, Literal, Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from backend.core.auth_middleware import verify_token, require_professor
from backend.core.rate_limit import limiter
from backend.services import chat_memory
from backend.services.ai import chat_service, tutor_service
from backend.core.database import supabase_admin  # ADMIN: direct access needed for session retrieval and lecture metadata

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["ai"])

_security = HTTPBearer()

_AiModelLiteral = Literal[
    "cerebras", "groq", "groq_fast", "openrouter", "cloudflare", "gemini",
    "gemini-2.0-flash", "gemini-2.5-flash", "gemma", "mistral", "llama3", "openai"
]
_AiModel = Annotated[_AiModelLiteral, Field("cerebras", description="Preferred LLM backend")]

class SlideTextRequest(BaseModel):
    slide_text: str = Field(..., min_length=1, max_length=10_000)
    ai_model: _AiModel = "cerebras"

class AnalyticsStatsRequest(BaseModel):
    total_students: int = Field(0, ge=0)
    average_score: float = Field(0, ge=0, le=100)
    total_attempts: int = Field(0, ge=0)
    total_correct: int = Field(0, ge=0)
    ai_model: _AiModel = "cerebras"

class MetricInsightRequest(BaseModel):
    metric_name: str
    metric_value: Any
    context_stats: Dict[str, Any]
    ai_model: _AiModel = "cerebras"

class ChatMessage(BaseModel):
    role: str = Field(..., max_length=32)
    content: str = Field(..., max_length=10_000)

class ChatRequest(BaseModel):
    slide_text: str = Field(..., min_length=0, max_length=10_000)
    user_message: str = Field(..., min_length=1, max_length=2_000)
    chat_history: Optional[List[ChatMessage]] = Field(default=None, max_length=100)
    ai_model: _AiModel = "cerebras"
    lecture_id: Optional[str] = Field(default=None, max_length=64)
    pdf_hash: Optional[str] = Field(default=None, max_length=128)
    current_slide_index: Optional[int] = Field(default=None, ge=0)
    session_id: Optional[str] = Field(default=None, max_length=64)

class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5_000)
    voice: Optional[str] = "en-US-AvaNeural"

class SummaryResponse(BaseModel):
    summary: str

class QuizResponse(BaseModel):
    question: str
    options: List[str] = Field(..., min_length=4, max_length=4)
    correctAnswer: int = Field(..., ge=0, le=3)
    explanation: Optional[str] = None
    concept: Optional[str] = None
    cognitive_level: Optional[Literal["recall", "apply", "analyse"]] = None

class InsightsResponse(BaseModel):
    summary: str
    suggestions: List[str]

class CitationModel(BaseModel):
    slide_index: int = Field(..., ge=0)
    similarity: float

class ChatResponse(BaseModel):
    reply: str
    citations: List[CitationModel] = Field(default_factory=list)
    session_id: Optional[str] = None

class CreateSessionRequest(BaseModel):
    lecture_id: Optional[str] = Field(default=None, max_length=64)
    title: Optional[str] = Field(default=None, max_length=100)

class SessionResponse(BaseModel):
    id: str
    user_id: str
    lecture_id: Optional[str] = None
    title: str
    created_at: str
    updated_at: str

class MessageResponse(BaseModel):
    role: str
    content: str

@router.post("/generate-summary", response_model=SummaryResponse)
@limiter.limit("30/minute")
async def generate_summary_endpoint(request: Request, body: SlideTextRequest, user: Any = Depends(verify_token)):
    if not body.slide_text.strip(): raise HTTPException(status_code=400, detail="slide_text cannot be empty.")
    try:
        summary = await tutor_service.generate_summary(body.slide_text, ai_model=body.ai_model)
        return SummaryResponse(summary=summary)
    except Exception as e:
        logger.error("AI summary failed: %s", e)
        raise HTTPException(status_code=502, detail="AI service unavailable.")

@router.post("/generate-quiz", response_model=QuizResponse)
@limiter.limit("30/minute")
async def generate_quiz_endpoint(request: Request, body: SlideTextRequest, user: Any = Depends(verify_token)):
    if not body.slide_text.strip(): raise HTTPException(status_code=400, detail="slide_text cannot be empty.")
    try:
        quiz = await tutor_service.generate_quiz(body.slide_text, ai_model=body.ai_model)
        return QuizResponse(**quiz)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("AI quiz failed: %s", e)
        raise HTTPException(status_code=502, detail="AI service unavailable.")

@router.post("/suggest-title")
@limiter.limit("30/minute")
async def suggest_title_endpoint(request: Request, body: SlideTextRequest, user: Any = Depends(verify_token)):
    try:
        title = await tutor_service.generate_slide_title(body.slide_text)
        return {"title": title}
    except Exception as e:
        logger.error("AI title failed: %s", e)
        raise HTTPException(status_code=500, detail="AI title suggestion failed.")

@router.post("/suggest-content")
@limiter.limit("30/minute")
async def suggest_content_endpoint(request: Request, body: SlideTextRequest, user: Any = Depends(verify_token)):
    try:
        enhanced = await tutor_service.enhance_slide_content(body.slide_text, ai_model=body.ai_model)
        return {"content": enhanced}
    except Exception as e:
        logger.error("AI content enhancement failed: %s", e)
        raise HTTPException(status_code=500, detail="AI content enhancement failed.")

@router.post("/analytics-insights", response_model=InsightsResponse)
@limiter.limit("30/minute")
async def analytics_insights_endpoint(request: Request, body: AnalyticsStatsRequest, user: Any = Depends(verify_token)):
    try:
        result = await tutor_service.generate_analytics_insights(body.dict(), ai_model=body.ai_model)
        return InsightsResponse(**result)
    except Exception as e:
        logger.error("AI insights failed: %s", e)
        raise HTTPException(status_code=500, detail="AI insights generation failed.")

class SlideSuggestionRequest(BaseModel):
    ai_model: _AiModel = "cerebras"

class SlideSuggestionResponse(BaseModel):
    suggestion: str
    label: str
    reasons: List[str]
    cached: bool

@router.post("/slides/{slide_id}/recommendation", response_model=SlideSuggestionResponse)
@limiter.limit("20/minute")
async def slide_recommendation_endpoint(
    request: Request,
    slide_id: str,
    body: SlideSuggestionRequest,
    user: Any = Depends(require_professor),
    creds: HTTPAuthorizationCredentials = Depends(_security),
):
    user_id = user.id if hasattr(user, "id") else user.get("id")
    try:
        res = await tutor_service.get_slide_recommendation(slide_id, user_id, body.ai_model, creds.credentials)
        return SlideSuggestionResponse(**res)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail="AI suggestion failed. Please retry.")

@router.post("/metric-feedback")
@limiter.limit("30/minute")
async def metric_feedback_endpoint(request: Request, body: MetricInsightRequest, user: Any = Depends(verify_token)):
    try:
        feedback = await tutor_service.generate_metric_feedback(body.metric_name, body.metric_value, body.context_stats, body.ai_model)
        return {"feedback": feedback}
    except Exception as e:
        logger.error("AI metric feedback failed: %s", e)
        raise HTTPException(status_code=500, detail="AI metric feedback failed.")

@router.post("/chat", response_model=ChatResponse)
@limiter.limit("30/minute")
async def chat_with_tutor_endpoint(request: Request, body: ChatRequest, user: Any = Depends(verify_token)):
    user_id = user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)
    user_role = (
        (user.app_metadata or {}).get("role") if hasattr(user, "app_metadata")
        else (user.get("app_metadata", {}) or {}).get("role") if isinstance(user, dict) else None
    )
    history = [m.model_dump() for m in body.chat_history] if body.chat_history else None
    try:
        res = await chat_service.process_chat_request(
            user_id=user_id,
            user_role=user_role,
            slide_text=body.slide_text,
            user_message=body.user_message,
            chat_history=history,
            ai_model=body.ai_model,
            lecture_id=body.lecture_id,
            pdf_hash=body.pdf_hash,
            current_slide_index=body.current_slide_index,
            session_id=body.session_id,
        )
        return ChatResponse(**res)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error("Chat failed: %s", e)
        raise HTTPException(status_code=500, detail="AI tutor failed to respond.")

@router.post("/tts")
@limiter.limit("20/minute")
async def text_to_speech_endpoint(request: Request, body: TTSRequest, user: Any = Depends(verify_token)):
    try:
        import io
        audio_content = await tutor_service.generate_speech(body.text, body.voice)
        return StreamingResponse(io.BytesIO(audio_content), media_type="audio/mpeg")
    except Exception as e:
        logger.error("TTS failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to generate AI voice.")

@router.post("/sessions", response_model=SessionResponse)
@limiter.limit("20/minute")
async def create_chat_session_endpoint(
    request: Request,
    body: CreateSessionRequest,
    user: Any = Depends(verify_token)
):
    user_id = user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)
    if not user_id: raise HTTPException(status_code=401, detail="Authentication credentials not found.")
    
    if body.lecture_id:
        try:
            res = supabase_admin.table("lectures").select("id").eq("id", body.lecture_id).limit(1).execute()
            if not res.data: raise HTTPException(status_code=404, detail="Lecture not found.")
        except HTTPException: raise
        except Exception: raise HTTPException(status_code=500, detail="Database lookup failed.")

    session_id = await chat_memory.create_session(user_id=user_id, lecture_id=body.lecture_id, title=body.title)
    meta = await chat_memory.get_session_metadata(session_id)
    if not meta: raise HTTPException(status_code=500, detail="Failed to retrieve created session.")
    if meta.get("lecture_id") == "": meta["lecture_id"] = None
    return SessionResponse(**meta)

@router.get("/sessions", response_model=List[SessionResponse])
@limiter.limit("30/minute")
async def list_chat_sessions_endpoint(request: Request, user: Any = Depends(verify_token)):
    user_id = user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)
    if not user_id: raise HTTPException(status_code=401, detail="Authentication credentials not found.")
    sessions = await chat_memory.get_user_sessions(user_id)
    return [SessionResponse(**s) for s in sessions]

@router.get("/sessions/{session_id}/messages", response_model=List[MessageResponse])
@limiter.limit("30/minute")
async def get_session_messages_endpoint(request: Request, session_id: str, limit: int = 50, user: Any = Depends(verify_token)):
    user_id = user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)
    if not user_id: raise HTTPException(status_code=401, detail="Authentication credentials not found.")
    
    meta = await chat_memory.get_session_metadata(session_id)
    if not meta: raise HTTPException(status_code=404, detail="Session not found.")
    if meta.get("user_id") != user_id: raise HTTPException(status_code=403, detail="Unauthorized to access this session.")
    
    history = await chat_memory.get_history(session_id, limit=limit)
    return [MessageResponse(**m) for m in history]

@router.delete("/sessions/{session_id}")
@limiter.limit("20/minute")
async def delete_chat_session_endpoint(request: Request, session_id: str, user: Any = Depends(verify_token)):
    user_id = user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)
    if not user_id: raise HTTPException(status_code=401, detail="Authentication credentials not found.")
    
    deleted = await chat_memory.delete_session(session_id, user_id)
    if not deleted:
        meta = await chat_memory.get_session_metadata(session_id)
        if not meta: raise HTTPException(status_code=404, detail="Session not found.")
        else: raise HTTPException(status_code=403, detail="Unauthorized to delete this session.")
    return {"success": True}

class RegenerateSlideRequest(BaseModel):
    ai_model: _AiModel = "cerebras"

@router.post("/slides/{slide_id}/regenerate-content")
@limiter.limit("10/minute")
async def regenerate_slide_content(
    request: Request, slide_id: str, body: RegenerateSlideRequest,
    user: Any = Depends(require_professor), creds: HTTPAuthorizationCredentials = Depends(_security)
):
    user_id = user.id if hasattr(user, "id") else user.get("id")
    try:
        analysis = await tutor_service.regenerate_slide(slide_id, user_id, body.ai_model, creds.credentials)
        return {"success": True, "analysis": analysis}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail="Failed to regenerate slide content.")

class LectureDescriptionRequest(BaseModel):
    lecture_title: str = Field(..., min_length=1)
    course_name: Optional[str] = None
    slide_summaries: List[str] = Field(default_factory=list)
    ai_model: Optional[_AiModelLiteral] = None

class LectureDescriptionResponse(BaseModel):
    description: str

@router.post("/lecture-description", response_model=LectureDescriptionResponse)
@limiter.limit("30/minute")
async def lecture_description_endpoint(request: Request, body: LectureDescriptionRequest, user: Any = Depends(verify_token)):
    summaries = [s.strip() for s in body.slide_summaries if s.strip()]
    if not summaries: raise HTTPException(status_code=400, detail="No slide summaries provided.")
    try:
        desc = await tutor_service.generate_lecture_description(body.lecture_title, body.course_name, summaries, body.ai_model or "cerebras")
        return LectureDescriptionResponse(description=desc)
    except Exception as e:
        raise HTTPException(status_code=502, detail="AI service unavailable.")

class CourseDescriptionRequest(BaseModel):
    course_id: str = Field(..., min_length=1)
    ai_model: Optional[_AiModelLiteral] = None

class CourseDescriptionResponse(BaseModel):
    description: str

@router.post("/course-description", response_model=CourseDescriptionResponse)
@limiter.limit("30/minute")
async def course_description_endpoint(
    request: Request, body: CourseDescriptionRequest,
    user: Any = Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(_security)
):
    try:
        desc = await tutor_service.generate_course_description(body.course_id, creds.credentials, body.ai_model or "cerebras")
        return CourseDescriptionResponse(description=desc)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail="AI service unavailable.")

class LectureTaglineRequest(BaseModel):
    lecture_id: str = Field(..., min_length=1)
    ai_model: Optional[_AiModelLiteral] = None

class LectureTaglineResponse(BaseModel):
    tagline: str
    cached: bool

@router.post("/lecture-tagline", response_model=LectureTaglineResponse)
@limiter.limit("30/minute")
async def lecture_tagline_endpoint(
    request: Request, body: LectureTaglineRequest,
    user: Any = Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(_security)
):
    try:
        res = await tutor_service.generate_lecture_tagline(body.lecture_id, creds.credentials, body.ai_model or "cerebras")
        return LectureTaglineResponse(**res)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail="AI service unavailable.")
