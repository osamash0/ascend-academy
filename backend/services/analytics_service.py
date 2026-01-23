"""
Analytics Service - Aggregates learning analytics data
"""
from backend.core.database import supabase
from typing import Dict, List, Any

def get_lecture_overview(lecture_id: str) -> Dict[str, Any]:
    """Get high-level metrics for a lecture"""
    
    # Get total students who started
    progress_response = supabase.table("student_progress")\
        .select("*")\
        .eq("lecture_id", lecture_id)\
        .execute()
    
    total_students = len(progress_response.data)
    
    if total_students == 0:
        return {
            "total_students": 0,
            "completion_rate": 0,
            "average_score": 0,
            "average_time_minutes": 0,
            "engagement_level": "No Data"
        }
    
    # Calculate metrics
    completed = len([p for p in progress_response.data if p.get("completed_at")])
    completion_rate = (completed / total_students) * 100 if total_students > 0 else 0
    
    # Get average time from events
    events_response = supabase.table("learning_events")\
        .select("event_data")\
        .eq("event_type", "slide_viewed")\
        .execute()
    
    total_time = 0
    event_count = 0
    for event in events_response.data:
        if event.get("event_data") and isinstance(event["event_data"], dict):
            duration = event["event_data"].get("duration_seconds", 0)
            total_time += duration
            event_count += 1
    
    avg_time_minutes = (total_time / 60) if event_count > 0 else 0
    
    # Engagement level (simple heuristic)
    if avg_time_minutes > 60:
        engagement = "High"
    elif avg_time_minutes > 30:
        engagement = "Medium"
    else:
        engagement = "Low"
    
    return {
        "total_students": total_students,
        "completion_rate": round(completion_rate, 1),
        "average_score": round(random.uniform(70, 95), 1),  # Mock for now
        "average_time_minutes": round(avg_time_minutes, 1),
        "engagement_level": engagement
    }

def get_slide_analytics(lecture_id: str) -> List[Dict[str, Any]]:
    """Get per-slide analytics"""
    
    # Get all slides for lecture
    slides_response = supabase.table("slides")\
        .select("*")\
        .eq("lecture_id", lecture_id)\
        .order("slide_number")\
        .execute()
    
    # Get all events
    events_response = supabase.table("learning_events")\
        .select("*")\
        .eq("event_type", "slide_viewed")\
        .execute()
    
    slide_analytics = []
    for slide in slides_response.data:
        # Filter events for this slide
        slide_events = [e for e in events_response.data 
                       if e.get("event_data", {}).get("slide_id") == slide["id"]]
        
        # Calculate metrics
        view_count = len(slide_events)
        avg_time = sum(e.get("event_data", {}).get("duration_seconds", 0) 
                      for e in slide_events) / view_count if view_count > 0 else 0
        
        # Drop-off rate (mock calculation)
        import random
        drop_off = random.uniform(0, 15)  # 0-15% drop-off
        
        slide_analytics.append({
            "slide_number": slide["slide_number"],
            "title": slide.get("title", f"Slide {slide['slide_number']}"),
            "view_count": view_count,
            "average_time_seconds": round(avg_time, 1),
            "drop_off_rate": round(drop_off, 1)
        })
    
    return slide_analytics

def get_quiz_analytics(lecture_id: str) -> List[Dict[str, Any]]:
    """Get quiz difficulty analytics"""
    
    # Get all quiz questions for this lecture
    quiz_response = supabase.table("quiz_questions")\
        .select("*, slides!inner(lecture_id)")\
        .eq("slides.lecture_id", lecture_id)\
        .execute()
    
    quiz_analytics = []
    import random
    
    for question in quiz_response.data:
        # Mock success rate (you'd calculate from actual attempts)
        success_rate = random.uniform(40, 95)
        
        # Difficulty based on success rate
        if success_rate > 80:
            difficulty = "Easy"
        elif success_rate > 60:
            difficulty = "Medium"
        else:
            difficulty = "Hard"
        
        quiz_analytics.append({
            "question_id": question["id"],
            "question_text": question["question_text"],
            "success_rate": round(success_rate, 1),
            "difficulty": difficulty,
            "attempts": random.randint(10, 50)  # Mock
        })
    
    return quiz_analytics

def get_student_performance(lecture_id: str) -> List[Dict[str, Any]]:
    """Get student performance table"""
    
    progress_response = supabase.table("student_progress")\
        .select("*")\
        .eq("lecture_id", lecture_id)\
        .execute()
    
    import random
    from backend.services.seed_service import FIRST_NAMES, LAST_NAMES
    
    students = []
    for i, progress in enumerate(progress_response.data[:20]):  # Limit to 20
        completed = len(progress.get("completed_slides", []))
        total_slides = 10  # Mock
        
        progress_pct = (completed / total_slides) * 100 if total_slides > 0 else 0
        score = random.randint(60, 100)
        
        # Status
        if progress_pct >= 90 and score >= 85:
            status = "Excelling"
        elif progress_pct >= 50 and score >= 70:
            status = "On Track"
        else:
            status = "At Risk"
        
        students.append({
            "student_id": progress["user_id"],
            "student_name": f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}",
            "progress_percentage": round(progress_pct, 1),
            "quiz_score": score,
            "status": status
        })
    
    return sorted(students, key=lambda x: x["quiz_score"], reverse=True)

# Import random for mocking
import random
