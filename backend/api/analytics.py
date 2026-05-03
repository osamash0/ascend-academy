"""
Analytics API Endpoints
"""
import logging
from fastapi import APIRouter, HTTPException, Depends, Query, Request, status

logger = logging.getLogger(__name__)
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from typing import Any, List, Optional, Dict
from backend.services import analytics_service, analytics_cache
from backend.core.auth_middleware import verify_token, require_professor, security
from backend.core.database import supabase
from backend.core.rate_limit import limiter
from fastapi.security import HTTPAuthorizationCredentials


# ── Response envelope ────────────────────────────────────────────────────────

class AnalyticsResponse(BaseModel):
    success: bool
    data: Any


class AnalyticsListResponse(BaseModel):
    success: bool
    data: List[Any]


class WeakestConceptItem(BaseModel):
    concept: str
    miss_rate: float
    attempts: int


class WeakestSlideItem(BaseModel):
    slide_id: str
    title: str
    miss_rate: float
    attempts: int


class SparklinePoint(BaseModel):
    date: str
    count: int


class ProfessorOverviewData(BaseModel):
    active_students: int
    average_completion: float
    average_quiz_accuracy: float
    median_time_minutes: float
    weakest_concepts: List[WeakestConceptItem]
    weakest_slides: List[WeakestSlideItem]
    activity_sparkline: List[SparklinePoint]
    lecture_count: int
    days: int


class ProfessorOverviewResponse(BaseModel):
    success: bool
    data: ProfessorOverviewData


# ── Typed item models ────────────────────────────────────────────────────────

class StudentPerformanceItem(BaseModel):
    student_id: str
    student_name: str
    progress_percentage: float
    quiz_score: float
    typology: str
    ai_interactions: int
    revisions: int


class QuizAnalyticsItem(BaseModel):
    question_id: str
    question_text: str
    success_rate: float
    difficulty: str
    attempts: int


class SlideAnalyticsItem(BaseModel):
    slide_number: int
    title: str
    view_count: int
    average_time_seconds: float
    drop_off_rate: float


class DistractorQuestion(BaseModel):
    question_id: str
    question_text: str
    options: List[str]
    correct_answer: int
    answer_distribution: Dict[str, int]
    most_common_wrong_answer: Optional[int]
    total_attempts: int


class DropoffPoint(BaseModel):
    slide_number: int
    title: str
    dropout_count: int
    dropout_percentage: float


class SlideConfidence(BaseModel):
    slide_number: int
    title: str
    got_it: int
    unsure: int
    confused: int
    total: int
    confusion_rate: float


class AIQueryItem(BaseModel):
    slide_title: str
    query_text: str
    created_at: str


# ── Router ───────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _assert_course_owner(course_id: str, user_id: str) -> None:
    """Raise 403 if the authenticated user is not the professor who owns this course."""
    res = supabase.table("courses").select("professor_id").eq("id", course_id).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found.")
    if res.data[0].get("professor_id") != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")


def _assert_lecture_owner(lecture_id: str, user_id: str, token: str = None) -> None:
    """Raise 403 if the authenticated user is not the professor who owns this lecture."""
    # Use the authenticated client if token provided, else default
    client = analytics_service.get_auth_client(token) if token else supabase
    
    # Use execute() instead of single() to avoid PGRST116 error when 0 rows found
    result = client.table("lectures").select("professor_id").eq("id", lecture_id).execute()
    
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lecture not found.")
        
    if result.data[0].get("professor_id") != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")


# ── Existing endpoints (bug-fixed) ───────────────────────────────────────────

@router.get("/lecture/{lecture_id}/overview", response_model=AnalyticsResponse)
async def get_lecture_overview(lecture_id: str, user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """Get high-level metrics for a lecture"""
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id, creds.credentials)
    try:
        data = await run_in_threadpool(analytics_service.get_lecture_overview, lecture_id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Analytics endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load analytics. Please try again.")


@router.get("/lecture/{lecture_id}/slides", response_model=AnalyticsResponse)
async def get_slide_analytics(lecture_id: str, user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """Get per-slide analytics"""
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id, creds.credentials)
    try:
        data = await run_in_threadpool(analytics_service.get_slide_analytics, lecture_id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Analytics endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load analytics. Please try again.")


@router.get("/lecture/{lecture_id}/quizzes", response_model=AnalyticsResponse)
async def get_quiz_analytics(lecture_id: str, user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """Get quiz difficulty analytics"""
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id, creds.credentials)
    try:
        data = await run_in_threadpool(analytics_service.get_quiz_analytics, lecture_id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Analytics endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load analytics. Please try again.")


@router.get("/lecture/{lecture_id}/students", response_model=AnalyticsResponse)
async def get_student_performance(lecture_id: str, user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """Get anonymized per-student performance breakdown"""
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id, creds.credentials)
    try:
        data = await run_in_threadpool(analytics_service.get_student_performance, lecture_id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Analytics endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load student analytics. Please try again.")


@router.get("/lecture/{lecture_id}/dashboard", response_model=AnalyticsResponse)
async def get_dashboard_data(lecture_id: str, user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """Get comprehensive advanced dashboard analytics in a single call"""
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id, creds.credentials)
    try:
        data = await analytics_service.get_dashboard_data(lecture_id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Analytics endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load comprehensive analytics.")


# ── New endpoints ────────────────────────────────────────────────────────────

@router.get("/lecture/{lecture_id}/distractors", response_model=AnalyticsResponse)
async def get_distractor_analysis(lecture_id: str, user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """
    Show which wrong answer options students select most often per question.
    Helps professors identify ambiguous distractors or conceptual gaps.
    """
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id, creds.credentials)
    try:
        data = await run_in_threadpool(analytics_service.get_distractor_analysis, lecture_id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Analytics endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load distractor analysis.")


@router.get("/lecture/{lecture_id}/dropoff", response_model=AnalyticsResponse)
async def get_dropoff_map(lecture_id: str, user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """
    Show which slide students abandon the lecture on.
    Uses last_slide_viewed from student_progress for non-completers.
    """
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id, creds.credentials)
    try:
        data = await run_in_threadpool(analytics_service.get_dropoff_map, lecture_id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Analytics endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load drop-off data.")


@router.get("/lecture/{lecture_id}/confidence-by-slide", response_model=AnalyticsResponse)
async def get_confidence_by_slide(lecture_id: str, user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """
    Per-slide confidence breakdown (got_it / unsure / confused).
    Shows exactly which slides leave students most confused.
    """
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id, creds.credentials)
    try:
        data = await run_in_threadpool(analytics_service.get_confidence_by_slide, lecture_id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Analytics endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load per-slide confidence data.")


@router.get("/lecture/{lecture_id}/ai-queries", response_model=AnalyticsResponse)
async def get_ai_query_feed(lecture_id: str, user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """
    Return latest student AI tutor queries (anonymized).
    Shows professors what students are actually confused about in their own words.
    """
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id, creds.credentials)
    try:
        data = await run_in_threadpool(analytics_service.get_ai_query_feed, lecture_id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Analytics endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load AI query feed.")

@router.get("/lecture/{lecture_id}/retry-performance", response_model=AnalyticsResponse)
async def get_retry_performance(lecture_id: str, user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """
    Per-question first-attempt vs second-attempt miss rates.
    Surfaces the questions students get wrong most often, plus how many
    still trip them up on the end-of-lecture review pass.
    """
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id, creds.credentials)
    try:
        data = await run_in_threadpool(analytics_service.get_retry_performance, lecture_id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Analytics endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load retry-performance data.")


@router.get("/professor/overview", response_model=ProfessorOverviewResponse)
@limiter.limit("60/minute")
async def get_professor_overview(
    request: Request,
    course_id: str = Query(..., min_length=1),
    days: int = Query(7, ge=1, le=90),
    user=Depends(require_professor),
    creds: HTTPAuthorizationCredentials = Depends(security),
):
    """Course-wide aggregate metrics for the professor dashboard.

    Returns active students (last N days), average completion %, average
    quiz accuracy, median time, weakest concepts (degrades to weakest
    slides if the concept graph has nothing to say), and an N-day
    activity sparkline.
    """
    await run_in_threadpool(_assert_course_owner, course_id, user.id)
    try:
        data = await run_in_threadpool(
            analytics_service.get_professor_overview,
            course_id,
            days,
            creds.credentials,
        )
        return ProfessorOverviewResponse(success=True, data=ProfessorOverviewData(**data))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Professor overview endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load professor overview.")


@router.post("/lecture/{lecture_id}/cache/refresh", response_model=AnalyticsResponse)
async def refresh_analytics_cache(lecture_id: str, user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """Force-invalidate every cached analytics aggregate for a lecture.

    Professor-only. Returns the number of cache rows dropped so the UI can
    surface a confirmation. The next dashboard load will recompute and
    repopulate the cache from scratch.
    """
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id, creds.credentials)
    try:
        deleted = await run_in_threadpool(analytics_cache.invalidate, lecture_id)
        # Force-recompute the dashboard so the next read is already warm.
        # Other per-feature aggregates repopulate lazily on first read.
        recomputed = False
        try:
            await analytics_service.get_dashboard_data(
                lecture_id, creds.credentials, force_refresh=True
            )
            recomputed = True
        except Exception as e:
            logger.warning("Cache refresh recompute failed (will lazy-fill): %s", e)

        return AnalyticsResponse(
            success=True,
            data={"invalidated_rows": deleted, "recomputed": recomputed},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Cache refresh failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to refresh analytics cache.")


@router.get("/personal/optimal-schedule", response_model=AnalyticsResponse)
async def get_personal_optimal_schedule(user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """
    Calculate the best time to study for the authenticated student.
    Analyzes historical event data to find peak performance windows.
    """
    try:
        data = await run_in_threadpool(analytics_service.get_personal_optimal_schedule, user.id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except Exception as e:
        logger.error("Analytics endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to calculate optimal schedule.")
