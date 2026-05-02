import logging
import io
import urllib.request
import urllib.parse
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

_PDF_MAX_BYTES = 50 * 1024 * 1024  # 50 MB cap on PDF downloads


_STORAGE_PATH_PREFIX = "/storage/v1/object/"


def _validate_supabase_storage_url(url: str) -> None:
    """Raise HTTPException if the URL is not a trusted Supabase Storage HTTPS URL.

    Enforces:
    - https scheme only (no file://, http://, etc.)
    - hostname must exactly match the project's Supabase host
    - path must be under /storage/v1/object/ (the Storage API namespace)
    This prevents SSRF via arbitrary hosts, internal addresses, or non-storage paths.
    """
    if not url:
        raise HTTPException(status_code=400, detail="No PDF attached.")
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid PDF URL.")

    if parsed.scheme != "https":
        raise HTTPException(status_code=400, detail="PDF URL must use HTTPS.")

    # Derive the trusted storage host from the configured Supabase URL.
    # SUPABASE_URL is like https://<project>.supabase.co
    try:
        project_host = urllib.parse.urlparse(SUPABASE_URL).hostname or ""
    except Exception:
        project_host = ""

    allowed_host = project_host.lower()
    request_host = (parsed.hostname or "").lower()

    if not allowed_host or request_host != allowed_host:
        raise HTTPException(
            status_code=400,
            detail="PDF URL does not point to the project's Supabase Storage.",
        )

    # Require the path to be under the Supabase Storage object namespace.
    # This prevents the same project host being used to reach non-storage
    # endpoints (e.g. metadata APIs, internal REST routes).
    if not parsed.path.startswith(_STORAGE_PATH_PREFIX):
        raise HTTPException(
            status_code=400,
            detail="PDF URL must point to a Supabase Storage object.",
        )


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
    # Grounding scope.  Either lecture_id or pdf_hash narrows retrieval to
    # the slides of *this* deck; without one of them the tutor falls back
    # to single-slide grounding using `slide_text`.
    lecture_id: Optional[str] = Field(default=None, max_length=64)
    pdf_hash: Optional[str] = Field(default=None, max_length=128)
    current_slide_index: Optional[int] = Field(default=None, ge=0)

class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5_000)
    voice: Optional[str] = "en-US-AvaNeural"

class SummaryResponse(BaseModel):
    summary: str

class QuizResponse(BaseModel):
    question: str
    options: List[str] = Field(..., min_length=4, max_length=4)
    correctAnswer: int = Field(..., ge=0, le=3)
    # Per-slide concept-testing fields. Optional so older callers / cached
    # responses without these fields don't break the response model.
    explanation: Optional[str] = None
    concept: Optional[str] = None
    cognitive_level: Optional[Literal["recall", "apply", "analyse"]] = None


class CrossSlideQuizQuestion(BaseModel):
    """Documentary schema for an item on the ``deck_complete`` SSE event.

    The LLM prompt emits letter-style ``answer: "A"|"B"|"C"|"D"`` payloads
    (matching ``BATCH_SLIDE_PROMPT``); this model normalises to the integer
    ``correctAnswer`` shape used by ``QuizResponse``, the frontend
    ``QuizCard``, and the ``quiz_questions.correct_answer`` column. The
    SSE serializer coerces letters to indices before this schema applies.
    The ``min_length=2`` invariant on ``linked_slides`` is enforced at
    generation time by ``validate_cross_slide_question``.
    """
    question: str
    options: List[str] = Field(..., min_length=4, max_length=4)
    correctAnswer: int = Field(..., ge=0, le=3)
    explanation: Optional[str] = None
    concept: Optional[str] = None
    linked_slides: List[int] = Field(default_factory=list, min_length=2)

class InsightsResponse(BaseModel):
    summary: str
    suggestions: List[str]

class CitationModel(BaseModel):
    slide_index: int = Field(..., ge=0)
    similarity: float

class ChatResponse(BaseModel):
    reply: str
    citations: List[CitationModel] = Field(default_factory=list)

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
    # Authorization: the client tells us which lecture/pdf to ground in, but
    # the *server* must verify the caller is allowed to read that lecture
    # before we hand any of its content to the LLM.  Without this, anyone
    # with a valid token could supply another lecture's id/hash and ask the
    # tutor to read it back to them (cross-tenant data exposure).
    user_id = user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)
    user_role = (
        (user.app_metadata or {}).get("role")
        if hasattr(user, "app_metadata")
        else (user.get("app_metadata", {}) or {}).get("role") if isinstance(user, dict) else None
    )
    safe_lecture_id: Optional[str] = None
    safe_pdf_hash: Optional[str] = None
    if body.lecture_id or body.pdf_hash:
        try:
            q = supabase_admin.table("lectures").select("id, professor_id, pdf_hash")
            if body.lecture_id:
                q = q.eq("id", body.lecture_id)
            else:
                q = q.eq("pdf_hash", body.pdf_hash)
            res = q.limit(1).execute()
            rows = res.data or []
            if not rows:
                raise HTTPException(status_code=404, detail="Lecture not found.")
            row = rows[0]
            # Professors may only ground in lectures they own.  Students may
            # ground in any lecture (the platform exposes lectures to all
            # authenticated students; refine here once enrollments exist).
            if user_role == "professor" and row.get("professor_id") != user_id:
                raise HTTPException(status_code=403, detail="Not your lecture.")
            safe_lecture_id = row.get("id")
            safe_pdf_hash = row.get("pdf_hash")
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Lecture authorization check failed: %s", e)
            raise HTTPException(status_code=500, detail="Authorization check failed.")
    try:
        result = await chat_with_lecture(
            slide_text=body.slide_text,
            user_message=body.user_message,
            chat_history=body.chat_history,
            ai_model=body.ai_model,
            lecture_id=safe_lecture_id,
            pdf_hash=safe_pdf_hash,
            current_slide_index=body.current_slide_index,
        )
        # Back-compat: if a stub still returns a bare string, wrap it.
        if isinstance(result, str):
            return ChatResponse(reply=result, citations=[])
        return ChatResponse(
            reply=result.get("reply", ""),
            citations=result.get("citations", []),
        )
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
    _validate_supabase_storage_url(pdf_url)

    slide_num: int = res.data["slide_number"]

    # 2. Download PDF — constrained to trusted Supabase Storage host,
    #    with an explicit timeout, redirect blocking, and a response-size cap.
    try:
        def _download():
            class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, req, fp, code, msg, headers, newurl):
                    raise ValueError(f"Redirect not allowed (HTTP {code} → {newurl})")

            opener = urllib.request.build_opener(_NoRedirectHandler)
            req = urllib.request.Request(
                pdf_url,
                headers={"User-Agent": "LectureApp/1.0"},
            )
            with opener.open(req, timeout=30) as resp:
                chunks = []
                total = 0
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > _PDF_MAX_BYTES:
                        raise ValueError(
                            f"PDF response exceeds {_PDF_MAX_BYTES // (1024*1024)} MB limit."
                        )
                    chunks.append(chunk)
                return b"".join(chunks)
        pdf_bytes = await asyncio.to_thread(_download)
    except ValueError as e:
        logger.warning("PDF download rejected (size): %s", e)
        raise HTTPException(status_code=400, detail=str(e))
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
        # Capture concept-testing fields in the quiz_questions.metadata jsonb
        # column so the player can render the explanation chip and analytics
        # can group questions by concept / cognitive level. Stored only when
        # present; older models that don't emit these fields just leave the
        # column at its default ``{}``.
        metadata = {
            k: v for k, v in {
                "explanation": quiz.get("explanation"),
                "concept": quiz.get("concept"),
                "cognitive_level": quiz.get("cognitive_level"),
            }.items() if v
        }
        client.table("quiz_questions").delete().eq("slide_id", slide_id).execute()
        client.table("quiz_questions").insert({
            "slide_id": slide_id,
            "question_text": quiz["question"],
            "options": quiz["options"],
            "correct_answer": quiz["correctAnswer"],
            "metadata": metadata,
        }).execute()

    return {"success": True, "analysis": analysis}
