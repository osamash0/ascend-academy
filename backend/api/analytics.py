"""
Analytics API Endpoints
"""
from fastapi import APIRouter, HTTPException, Depends
from backend.services import analytics_service
from backend.core.auth_middleware import verify_token

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

@router.get("/lecture/{lecture_id}/overview")
async def get_lecture_overview(lecture_id: str, user=Depends(verify_token)):
    """Get high-level metrics for a lecture"""
    try:
        data = analytics_service.get_lecture_overview(lecture_id)
        return {"success": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/lecture/{lecture_id}/slides")
async def get_slide_analytics(lecture_id: str, user=Depends(verify_token)):
    """Get per-slide analytics"""
    try:
        data = analytics_service.get_slide_analytics(lecture_id)
        return {"success": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/lecture/{lecture_id}/quizzes")
async def get_quiz_analytics(lecture_id: str, user=Depends(verify_token)):
    """Get quiz difficulty analytics"""
    try:
        data = analytics_service.get_quiz_analytics(lecture_id)
        return {"success": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/lecture/{lecture_id}/students")
async def get_student_performance(lecture_id: str, user=Depends(verify_token)):
    """Get student performance data"""
    try:
        data = analytics_service.get_student_performance(lecture_id)
        return {"success": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
