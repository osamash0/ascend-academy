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
from backend.services.llm_client import LLMTimeoutError
from backend.services.ai_service import (
    generate_summary, generate_quiz, generate_analytics_insights, 
    chat_with_lecture, generate_speech, generate_metric_feedback, 
    analyze_slide_vision, generate_slide_title, enhance_slide_content
)
from backend.services.ai.analytics import generate_slide_recommendation
from backend.services import analytics_service, analytics_cache
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

_AiModelLiteral = Literal[
    "cerebras",        # PRIMARY
    "groq",
    "groq_fast",
    "openrouter",
    "cloudflare",
    "gemini",
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemma",
    "mistral",
    "llama3",
    "openai",
]
_AiModel = Annotated[
    _AiModelLiteral,
    Field("cerebras", description="Preferred LLM backend (head of failover chain)"),
]

# --- Pydantic Models ---

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
    # `role` is intentionally a bounded str, not a Literal: the frontend sends
    # "user" / "model" (tutor.py treats anything != "user" as the assistant),
    # so a strict allow-list would 422 every real request. We validate shape
    # and cap sizes here; the tutor sanitizes and truncates content downstream.
    role: str = Field(..., max_length=32)
    content: str = Field(..., max_length=10_000)


class ChatRequest(BaseModel):
    slide_text: str = Field(..., min_length=0, max_length=10_000)
    user_message: str = Field(..., min_length=1, max_length=2_000)
    chat_history: Optional[List[ChatMessage]] = Field(default=None, max_length=100)
    ai_model: _AiModel = "cerebras"
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
@limiter.limit("30/minute")
async def generate_summary_endpoint(request: Request, body: SlideTextRequest, user: Any = Depends(verify_token)):
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")

    try:
        # The metadata filter can run an LLM-as-judge classifier (a blocking
        # network call). Run it off the event loop and inside the try so it
        # neither stalls the worker nor escapes as an unhandled 500.
        filter_result = await asyncio.to_thread(
            is_metadata_slide, body.slide_text, ai_model=body.ai_model
        )
        if filter_result.get("is_metadata"):
            return SummaryResponse(summary="This slide contains administrative information and is not suitable for summarization.")

        summary = await generate_summary(body.slide_text, ai_model=body.ai_model)
        return SummaryResponse(summary=summary)
    except (asyncio.TimeoutError, LLMTimeoutError):
        raise HTTPException(status_code=504, detail="AI summary timed out. Please retry.")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("AI summary failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="AI service unavailable. Please try a different model or retry shortly.")

@router.post("/generate-quiz", response_model=QuizResponse)
@limiter.limit("30/minute")
async def generate_quiz_endpoint(request: Request, body: SlideTextRequest, user: Any = Depends(verify_token)):
    if not body.slide_text.strip():
        raise HTTPException(status_code=400, detail="slide_text cannot be empty.")

    try:
        # Run the (possibly LLM-backed) metadata filter off the event loop and
        # inside the try — see generate_summary_endpoint for the rationale.
        filter_result = await asyncio.to_thread(
            is_metadata_slide, body.slide_text, ai_model=body.ai_model
        )
        if filter_result.get("is_metadata"):
            return QuizResponse(
                question="This slide contains administrative information.",
                options=["N/A", "N/A", "N/A", "N/A"],
                correctAnswer=0
            )

        quiz = await generate_quiz(body.slide_text, ai_model=body.ai_model)
        # Ensure correct return format
        if isinstance(quiz, list) and quiz:
            quiz = quiz[0]
        if not isinstance(quiz, dict):
            raise ValueError("Quiz generation returned unexpected format")
        # Guard: parse_json_response returns {} on total failure; also catches
        # any other case where required fields are absent.
        if not quiz.get("question") or not isinstance(quiz.get("options"), list):
            raise ValueError("AI returned an empty or incomplete quiz response.")
        # Normalize letter-format "answer": "A"|"B"|"C"|"D" → correctAnswer: int
        if "answer" in quiz and "correctAnswer" not in quiz:
            ans = quiz.get("answer", "")
            if isinstance(ans, str) and len(ans) == 1 and ans.upper().isalpha():
                quiz["correctAnswer"] = ord(ans.upper()) - ord("A")
        # Clamp cognitive_level: LLMs occasionally return values outside the
        # allowed enum ("comprehension", "understand", …) which would cause a
        # Pydantic ValidationError and surface as a confusing 502.
        if quiz.get("cognitive_level") not in ("recall", "apply", "analyse", None):
            quiz["cognitive_level"] = "apply"
        return QuizResponse(**quiz)
    except (asyncio.TimeoutError, LLMTimeoutError):
        raise HTTPException(status_code=504, detail="AI quiz timed out. Please retry.")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"AI returned invalid quiz format: {e}")
    except Exception as e:
        logger.error("AI quiz failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="AI service unavailable. Please try a different model or retry shortly.")

@router.post("/suggest-title")
@limiter.limit("30/minute")
async def suggest_title_endpoint(request: Request, body: SlideTextRequest, user: Any = Depends(verify_token)):
    try:
        title = await generate_slide_title(body.slide_text)
        return {"title": title}
    except Exception as e:
        logger.error("AI title failed: %s", e)
        raise HTTPException(status_code=500, detail="AI title suggestion failed.")

@router.post("/suggest-content")
@limiter.limit("30/minute")
async def suggest_content_endpoint(request: Request, body: SlideTextRequest, user: Any = Depends(verify_token)):
    try:
        enhanced = await enhance_slide_content(body.slide_text, ai_model=body.ai_model)
        return {"content": enhanced.get("content", body.slide_text)}
    except Exception as e:
        logger.error("AI content enhancement failed: %s", e)
        raise HTTPException(status_code=500, detail="AI content enhancement failed.")

@router.post("/analytics-insights", response_model=InsightsResponse)
@limiter.limit("30/minute")
async def analytics_insights_endpoint(request: Request, body: AnalyticsStatsRequest, user: Any = Depends(verify_token)):
    try:
        result = await generate_analytics_insights(body.dict(), ai_model=body.ai_model)
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
    """On-demand AI improvement tip for a single slide.

    Verifies the caller owns the parent lecture, recomputes the slide's
    metrics snapshot (so the cache key tracks the latest analytics), and
    returns a 1–3 sentence suggestion. Cached per slide + metrics-hash so
    repeated clicks are free until the analytics cache turns over.
    """
    user_id = user.id if hasattr(user, "id") else user.get("id")

    # 1. Resolve slide → lecture and confirm ownership.
    res = supabase_admin.table("slides")\
        .select("id, lecture_id, title, content_text, summary, lectures(professor_id)")\
        .eq("id", slide_id)\
        .limit(1)\
        .execute()
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Slide not found.")
    slide = rows[0]
    lecture_id = slide.get("lecture_id")
    lecture_info = slide.get("lectures") or {}
    if lecture_info.get("professor_id") != user_id:
        raise HTTPException(status_code=403, detail="Not your lecture.")

    # 2. Pull the cached slide analytics row for this slide.
    try:
        slide_rows = await asyncio.to_thread(
            analytics_service.get_slide_analytics, lecture_id, creds.credentials
        )
    except Exception as e:
        logger.error("Slide analytics lookup failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not load slide metrics.")

    metrics = next((s for s in slide_rows if s.get("slide_id") == slide_id), None)
    if metrics is None:
        raise HTTPException(status_code=404, detail="Slide metrics unavailable.")

    label = metrics.get("recommendation_label")
    if label == "insufficient_data" or label is None:
        # No useful suggestion possible — surface a static helper instead
        # of burning a token.
        return SlideSuggestionResponse(
            suggestion="Not enough student activity yet to give a tailored tip. Encourage a few students to complete the slide first.",
            label=label or "insufficient_data",
            reasons=metrics.get("recommendation_reasons", []),
            cached=False,
        )
    if label != "needs_review":
        # Hard-gate AI generation to slides flagged for review so off-path
        # calls (e.g. direct API hits) don't burn tokens for satisfactory
        # or outstanding slides where no tip is needed.
        return SlideSuggestionResponse(
            suggestion="This slide is performing well — no AI suggestion needed.",
            label=label,
            reasons=metrics.get("recommendation_reasons", []),
            cached=False,
        )

    # 3. Cache key = (slide_id, hash of metrics snapshot, model).
    snapshot = {
        "drop_off_rate": metrics.get("drop_off_rate"),
        "confusion_rate": metrics.get("confusion_rate"),
        "quiz_success_rate": metrics.get("quiz_success_rate"),
        "view_count": metrics.get("view_count"),
        "quiz_attempts": metrics.get("quiz_attempts"),
        "label": label,
        "reasons": sorted(metrics.get("recommendation_reasons", []) or []),
    }
    cache_params = {"slide_id": slide_id, "model": body.ai_model, "snapshot": snapshot}

    cache_hit = {"hit": True}

    async def _compute():
        cache_hit["hit"] = False
        text = await generate_slide_recommendation(
            slide_title=slide.get("title") or f"Slide {slide_id[:6]}",
            slide_text=slide.get("content_text") or slide.get("summary") or "",
            drop_off_rate=float(metrics.get("drop_off_rate") or 0.0),
            confusion_rate=float(metrics.get("confusion_rate") or 0.0),
            quiz_success_rate=metrics.get("quiz_success_rate"),
            view_count=int(metrics.get("view_count") or 0),
            reasons=metrics.get("recommendation_reasons", []) or [],
            ai_model=body.ai_model,
        )
        return {"suggestion": text}

    try:
        payload = await analytics_cache.get_or_compute_async(
            lecture_id,
            "ai_slide_recommendation",
            _compute,
            params=cache_params,
            ttl_seconds=60 * 60 * 24,  # 24h; invalidated whenever analytics cache is dropped
        )
    except Exception as e:
        logger.error("Slide recommendation pipeline failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="AI suggestion failed. Please retry.")

    return SlideSuggestionResponse(
        suggestion=payload.get("suggestion", ""),
        label=label,
        reasons=metrics.get("recommendation_reasons", []),
        cached=cache_hit["hit"],
    )


@router.post("/metric-feedback")
@limiter.limit("30/minute")
async def metric_feedback_endpoint(request: Request, body: MetricInsightRequest, user: Any = Depends(verify_token)):
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
        # tutor.chat_with_lecture consumes plain dicts (msg.get("role")/...),
        # so unwrap the validated ChatMessage models back into dicts.
        history = [m.model_dump() for m in body.chat_history] if body.chat_history else None
        result = await chat_with_lecture(
            slide_text=body.slide_text,
            user_message=body.user_message,
            chat_history=history,
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
    ai_model: _AiModel = "cerebras"

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

    try:
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

        analytics_cache.invalidate_course_overview_for_lecture(res.data.get("lecture_id"))
        return {"success": True, "analysis": analysis}
    except HTTPException:
        raise
    except (asyncio.TimeoutError, LLMTimeoutError):
        raise HTTPException(status_code=504, detail="Slide regeneration timed out. Please retry.")
    except Exception as e:
        logger.error("Slide regeneration failed for %s: %s", slide_id, e, exc_info=True)
        raise HTTPException(status_code=502, detail="Failed to regenerate slide content.")


# --- Lecture description auto-generation ---

class LectureDescriptionRequest(BaseModel):
    lecture_title: str = Field(..., min_length=1)
    course_name: Optional[str] = None
    slide_summaries: List[str] = Field(default_factory=list)
    ai_model: Optional[_AiModelLiteral] = None


class LectureDescriptionResponse(BaseModel):
    description: str


_DESCRIPTION_MAX_CHARS = 4000


@router.post("/lecture-description", response_model=LectureDescriptionResponse)
@limiter.limit("30/minute")
async def lecture_description_endpoint(
    request: Request,
    body: LectureDescriptionRequest,
    user: Any = Depends(verify_token),
):
    """Generate a short AI description from slide summaries and optional course context."""
    summaries = [s.strip() for s in body.slide_summaries if s.strip()]
    if not summaries:
        raise HTTPException(status_code=400, detail="No slide summaries provided.")

    course_line = f"\n[COURSE]\n{body.course_name}" if body.course_name else ""
    summaries_text = "\n".join(summaries)[:_DESCRIPTION_MAX_CHARS]

    from backend.services.ai.orchestrator import generate_text
    from backend.services.ai.prompts import LECTURE_DESCRIPTION_PROMPT

    prompt = LECTURE_DESCRIPTION_PROMPT.format(
        title=body.lecture_title,
        course_line=course_line,
        summaries=summaries_text,
    )
    try:
        raw = await generate_text(prompt, ai_model=body.ai_model or "cerebras")
    except (asyncio.TimeoutError, LLMTimeoutError):
        raise HTTPException(status_code=504, detail="Description generation timed out.")
    except Exception as e:
        logger.error("Description generation failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="AI service unavailable.")

    description = (raw or "").strip().strip('"') if raw else ""
    if not description:
        raise HTTPException(status_code=502, detail="Empty description returned.")

    return LectureDescriptionResponse(description=description)


# --- Course description auto-generation (summarizes a course from its lectures) ---

class CourseDescriptionRequest(BaseModel):
    course_id: str = Field(..., min_length=1)
    ai_model: Optional[_AiModelLiteral] = None


class CourseDescriptionResponse(BaseModel):
    description: str


# Per lecture, how many slide summaries to fold into the course outline.
_COURSE_SLIDES_PER_LECTURE = 4


@router.post("/course-description", response_model=CourseDescriptionResponse)
@limiter.limit("30/minute")
async def course_description_endpoint(
    request: Request,
    body: CourseDescriptionRequest,
    user: Any = Depends(verify_token),
    creds: HTTPAuthorizationCredentials = Depends(_security),
):
    """Generate a course-level description from the titles and slide summaries of
    the course's lectures.

    Reads through the caller's RLS-scoped client, so a professor can only
    generate a description for a course (and lectures) they can actually see.
    """
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.postgrest.auth(creds.credentials)

    course_res = (
        client.table("courses")
        .select("title")
        .eq("id", body.course_id)
        .limit(1)
        .execute()
    )
    course_rows = course_res.data or []
    if not course_rows:
        raise HTTPException(status_code=404, detail="Course not found.")
    course_title = course_rows[0].get("title") or "Course"

    lec_res = (
        client.table("lectures")
        .select("id, title, created_at")
        .eq("course_id", body.course_id)
        .eq("is_archived", False)
        .order("created_at", desc=False)
        .execute()
    )
    lectures = lec_res.data or []
    if not lectures:
        raise HTTPException(status_code=400, detail="Course has no lectures yet.")

    lecture_ids = [l["id"] for l in lectures]
    slides_res = (
        client.table("slides")
        .select("lecture_id, summary, content_text, title, slide_number")
        .in_("lecture_id", lecture_ids)
        .order("slide_number", desc=False)
        .execute()
    )
    slides = slides_res.data or []

    # Group a few slide summaries per lecture so the outline stays compact but
    # representative of each lecture's content.
    summaries_by_lecture: Dict[str, List[str]] = {}
    for s in slides:
        lid = s.get("lecture_id")
        if lid is None:
            continue
        bucket = summaries_by_lecture.setdefault(lid, [])
        if len(bucket) >= _COURSE_SLIDES_PER_LECTURE:
            continue
        chunk = (s.get("summary") or s.get("content_text") or s.get("title") or "").strip()
        if chunk:
            bucket.append(chunk)

    outline_lines: List[str] = []
    for l in lectures:
        outline_lines.append(f"- {l.get('title') or 'Untitled lecture'}")
        for chunk in summaries_by_lecture.get(l["id"], []):
            outline_lines.append(f"    • {chunk}")
    outline = "\n".join(outline_lines)[:_DESCRIPTION_MAX_CHARS]
    if not outline.strip():
        raise HTTPException(status_code=400, detail="Course content is empty.")

    from backend.services.ai.orchestrator import generate_text
    from backend.services.ai.prompts import COURSE_DESCRIPTION_PROMPT

    prompt = COURSE_DESCRIPTION_PROMPT.format(title=course_title, outline=outline)
    try:
        raw = await generate_text(prompt, ai_model=body.ai_model or "cerebras")
    except (asyncio.TimeoutError, LLMTimeoutError):
        raise HTTPException(status_code=504, detail="Description generation timed out.")
    except Exception as e:
        logger.error("Course description generation failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="AI service unavailable.")

    description = (raw or "").strip().strip('"') if raw else ""
    if not description:
        raise HTTPException(status_code=502, detail="Empty description returned.")

    return CourseDescriptionResponse(description=description)


# --- Experimental: AI lecture tagline (PS5-style library subtitle) ---

class LectureTaglineRequest(BaseModel):
    lecture_id: str = Field(..., min_length=1)
    ai_model: Optional[_AiModelLiteral] = None


class LectureTaglineResponse(BaseModel):
    tagline: str
    cached: bool


# In-process cache so repeated focus changes in the carousel are free.
# Keyed by (lecture_id, slide_count) so it self-invalidates if slides change.
_TAGLINE_CACHE: Dict[str, str] = {}
_TAGLINE_CACHE_MAX_ENTRIES = 512  # bound in-process cache growth
_TAGLINE_MAX_CHARS = 6000  # cap context fed to the model


@router.post("/lecture-tagline", response_model=LectureTaglineResponse)
@limiter.limit("30/minute")
async def lecture_tagline_endpoint(
    request: Request,
    body: LectureTaglineRequest,
    user: Any = Depends(verify_token),
    creds: HTTPAuthorizationCredentials = Depends(_security),
):
    """Generate a short, motivating tagline from a lecture's full content.

    Reads slides through the caller's RLS-scoped client (so a student only
    gets a tagline for a lecture they can actually see), then asks the LLM
    for a one-line subtitle. Cached per (lecture, slide-count) in-process.
    """
    # RLS-scoped read: a student must be able to see the lecture's slides.
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.postgrest.auth(creds.credentials)

    lec_res = (
        client.table("lectures")
        .select("title")
        .eq("id", body.lecture_id)
        .limit(1)
        .execute()
    )
    lec_rows = lec_res.data or []
    if not lec_rows:
        raise HTTPException(status_code=404, detail="Lecture not found.")
    title = lec_rows[0].get("title") or "Lecture"

    slides_res = (
        client.table("slides")
        .select("title, summary, content_text, slide_number")
        .eq("lecture_id", body.lecture_id)
        .order("slide_number", desc=False)
        .execute()
    )
    slides = slides_res.data or []
    if not slides:
        raise HTTPException(status_code=400, detail="Lecture has no slides yet.")

    cache_key = f"{body.lecture_id}:{len(slides)}"
    cached = _TAGLINE_CACHE.get(cache_key)
    if cached:
        return LectureTaglineResponse(tagline=cached, cached=True)

    # Build a compact context from the richest text each slide offers.
    parts: List[str] = []
    for s in slides:
        chunk = (s.get("summary") or s.get("content_text") or s.get("title") or "").strip()
        if chunk:
            parts.append(chunk)
    content = "\n".join(parts)[:_TAGLINE_MAX_CHARS]
    if not content.strip():
        raise HTTPException(status_code=400, detail="Lecture content is empty.")

    from backend.services.ai.orchestrator import generate_text
    from backend.services.ai.prompts import LECTURE_TAGLINE_PROMPT

    prompt = LECTURE_TAGLINE_PROMPT.format(title=title, content=content)
    try:
        raw = await generate_text(prompt, ai_model=body.ai_model or "cerebras")
    except (asyncio.TimeoutError, LLMTimeoutError):
        raise HTTPException(status_code=504, detail="Tagline generation timed out.")
    except Exception as e:
        logger.error("Tagline generation failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="AI service unavailable.")

    # Tidy the model output into a single clean line.
    tagline = (raw or "").strip().strip('"').splitlines()[0].strip() if raw else ""
    if not tagline:
        raise HTTPException(status_code=502, detail="Empty tagline returned.")

    # Bound the in-process cache so it can't grow without limit over the
    # process lifetime. Entries are cheap to recompute and self-invalidate on
    # slide-count change, so evicting the oldest insertion is fine.
    if len(_TAGLINE_CACHE) >= _TAGLINE_CACHE_MAX_ENTRIES:
        _TAGLINE_CACHE.pop(next(iter(_TAGLINE_CACHE)), None)
    _TAGLINE_CACHE[cache_key] = tagline
    return LectureTaglineResponse(tagline=tagline, cached=False)
