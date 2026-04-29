"""
Analytics API Endpoints
"""
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from typing import Any, List, Optional, Dict
from backend.services import analytics_service
from backend.core.auth_middleware import verify_token, security
from backend.core.database import supabase
from fastapi.security import HTTPAuthorizationCredentials


# ── Response envelope ────────────────────────────────────────────────────────

class AnalyticsResponse(BaseModel):
    success: bool
    data: Any


class AnalyticsListResponse(BaseModel):
    success: bool
    data: List[Any]


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
    except Exception:
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
    except Exception:
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
    except Exception:
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
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to load student analytics. Please try again.")


@router.get("/lecture/{lecture_id}/dashboard", response_model=AnalyticsResponse)
async def get_dashboard_data(lecture_id: str, user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """Get comprehensive advanced dashboard analytics in a single call"""
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id, creds.credentials)
    try:
        data = await run_in_threadpool(analytics_service.get_dashboard_data, lecture_id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception:
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
    except Exception:
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
    except Exception:
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
    except Exception:
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
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to load AI query feed.")

@router.get("/personal/optimal-schedule", response_model=AnalyticsResponse)
async def get_personal_optimal_schedule(user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """
    Calculate the best time to study for the authenticated student.
    Analyzes historical event data to find peak performance windows.
    """
    try:
        data = await run_in_threadpool(analytics_service.get_personal_optimal_schedule, user.id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to calculate optimal schedule.")
