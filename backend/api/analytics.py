"""
Analytics API Endpoints
"""
from fastapi import APIRouter, HTTPException, Depends
from backend.services import analytics_service
from backend.core.auth_middleware import verify_token

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

@router.get("/lecture/{lecture_id}/overview")
def get_lecture_overview(lecture_id: str, user=Depends(verify_token)):
    """Get high-level metrics for a lecture"""
    try:
        data = analytics_service.get_lecture_overview(lecture_id)
        return {"success": True, "data": data}
    except Exception as e:
        print(f"DEBUG analytics error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load analytics. Please try again.")

@router.get("/lecture/{lecture_id}/slides")
def get_slide_analytics(lecture_id: str, user=Depends(verify_token)):
    """Get per-slide analytics"""
    try:
        data = analytics_service.get_slide_analytics(lecture_id)
        return {"success": True, "data": data}
    except Exception as e:
        print(f"DEBUG analytics error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load analytics. Please try again.")

@router.get("/lecture/{lecture_id}/quizzes")
def get_quiz_analytics(lecture_id: str, user=Depends(verify_token)):
    """Get quiz difficulty analytics"""
    try:
        data = analytics_service.get_quiz_analytics(lecture_id)
        return {"success": True, "data": data}
    except Exception as e:
        print(f"DEBUG analytics error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load analytics. Please try again.")

@router.get("/lecture/{lecture_id}/students")
def get_student_performance(lecture_id: str, user=Depends(verify_token)):
    """Get student performance data"""
    try:
        data = analytics_service.get_student_performance(lecture_id)
        return {"success": True, "data": data}
    except Exception as e:
        print(f"DEBUG analytics error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load analytics. Please try again.")
