"""
Analytics API Endpoints
"""
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from typing import Any
from backend.services import analytics_service
from backend.core.auth_middleware import verify_token, security
from backend.core.database import supabase
from fastapi.security import HTTPAuthorizationCredentials


class AnalyticsResponse(BaseModel):
    success: bool
    data: Any

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _assert_lecture_owner(lecture_id: str, user_id: str) -> None:
    """Raise 403 if the authenticated user is not the professor who owns this lecture."""
    result = supabase.table("lectures").select("professor_id").eq("id", lecture_id).single().execute()
    if not result.data or result.data.get("professor_id") != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")


@router.get("/lecture/{lecture_id}/overview", response_model=AnalyticsResponse)
async def get_lecture_overview(lecture_id: str, user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """Get high-level metrics for a lecture"""
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id)
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
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id)
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
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id)
    try:
        data = await run_in_threadpool(analytics_service.get_quiz_analytics, lecture_id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to load analytics. Please try again.")

@router.get("/lecture/{lecture_id}/students", response_model=AnalyticsResponse)
async def get_student_performance(lecture_id: str, user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """Get student performance data"""
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id)
    try:
        data = await run_in_threadpool(analytics_service.get_student_performance, lecture_id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to load analytics. Please try again.")

@router.get("/lecture/{lecture_id}/dashboard", response_model=AnalyticsResponse)
async def get_dashboard_data(lecture_id: str, user=Depends(verify_token), creds: HTTPAuthorizationCredentials = Depends(security)):
    """Get comprehensive advanced dashboard analytics in a single call"""
    await run_in_threadpool(_assert_lecture_owner, lecture_id, user.id)
    try:
        data = await run_in_threadpool(analytics_service.get_dashboard_data, lecture_id, creds.credentials)
        return AnalyticsResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to load comprehensive analytics.")
