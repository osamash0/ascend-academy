"""
Analytics Service - Aggregates learning analytics data
"""
from backend.core.database import supabase, url, key
from supabase import create_client

def get_auth_client(token: str):
    """Create a Supabase client authenticated with the professor's JWT.
    This allows RLS policies (has_role check) to identify the professor
    and return all student data."""
    if not token:
        return supabase
    client = create_client(url, key)
    client.postgrest.auth(token)
    return client

from typing import Dict, List, Any

def get_lecture_overview(lecture_id: str, token: str = None) -> Dict[str, Any]:
    """Get high-level metrics for a lecture"""
    
    # Get total students who started
    progress_response = get_auth_client(token).table("student_progress")\
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
    events_response = get_auth_client(token).table("learning_events")\
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

def get_slide_analytics(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    """Get per-slide analytics"""
    
    # Get all slides for lecture
    slides_response = get_auth_client(token).table("slides")\
        .select("*")\
        .eq("lecture_id", lecture_id)\
        .order("slide_number")\
        .execute()
    
    # Get all events
    events_response = get_auth_client(token).table("learning_events")\
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

def get_quiz_analytics(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    """Get quiz difficulty analytics"""
    
    # Get all quiz questions for this lecture
    quiz_response = get_auth_client(token).table("quiz_questions")\
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

def get_student_performance(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    """Get student performance table"""
    
    progress_response = get_auth_client(token).table("student_progress")\
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

# Advanced Dashboard Data Collection
import random
from datetime import datetime, timedelta

def get_dashboard_data(lecture_id: str, token: str = None):
    # 1. Fetch real DB data
    progress_res = get_auth_client(token).table('student_progress').select('*').eq('lecture_id', lecture_id).execute()
    events_res = get_auth_client(token).table('learning_events').select('*').contains('event_data', {'lectureId': lecture_id}).execute()
    slides_res = get_auth_client(token).table('slides').select('id, title, slide_number').eq('lecture_id', lecture_id).execute()
    
    progress_data = progress_res.data or []
    events_data = events_res.data or []
    slides_data = slides_res.data or []
    
    # Overview
    unique_students = len({p['user_id'] for p in progress_data})
    total_attempts = sum(p.get('total_questions_answered') or 0 for p in progress_data)
    total_correct = sum(p.get('correct_answers') or 0 for p in progress_data)
    average_score = round((total_correct / total_attempts * 100) if total_attempts > 0 else 0)

    # Activity By Day
    last_7_days = [(datetime.now() - timedelta(days=6-i)).strftime('%Y-%m-%d') for i in range(7)]
    activity_by_day = []
    for d in last_7_days:
        day_events = [e for e in events_data if e.get('event_type') == 'quiz_attempt' and e.get('created_at', '').startswith(d)]
        weekday = datetime.strptime(d, '%Y-%m-%d').strftime('%a')
        activity_by_day.append({"date": weekday, "attempts": len(day_events)})

    # Deep Slide Analysis
    slide_stats = {}
    for ev in events_data:
        ev_data = ev.get('event_data', {})
        sid = ev_data.get('slideId') or ev_data.get('fromSlideId')
        if not sid: continue
        
        if sid not in slide_stats:
            slide_stats[sid] = {'duration': 0, 'views': 0, 'quizCorrect': 0, 'quizAttempts': 0, 'aiQueries': 0, 'revisions': 0, 'slideTitle': ''}
            
        ev_type = ev.get('event_type')
        if ev_type == 'slide_view':
            slide_stats[sid]['duration'] += ev_data.get('duration_seconds', 0)
            slide_stats[sid]['views'] += 1
            if ev_data.get('slideTitle'): slide_stats[sid]['slideTitle'] = ev_data.get('slideTitle')
        elif ev_type == 'quiz_attempt':
            slide_stats[sid]['quizAttempts'] += 1
            if ev_data.get('correct'): slide_stats[sid]['quizCorrect'] += 1
        elif ev_type == 'ai_tutor_query':
            slide_stats[sid]['aiQueries'] += 1
        elif ev_type == 'slide_back_navigation':
            slide_stats[sid]['revisions'] += 1

    slide_performance = []
    for sid, st in slide_stats.items():
        real_slide = next((s for s in slides_data if s['id'] == sid), None)
        title = real_slide['title'] if real_slide else st['slideTitle'] or f"Slide {sid[:4]}"
        avg_dur = round(st['duration'] / st['views']) if st['views'] > 0 else 0
        corr_rate = round((st['quizCorrect'] / st['quizAttempts']) * 100) if st['quizAttempts'] > 0 else 0
        
        # Advanced formula: The Confusion Index
        # AI queries carry highest friction weight, revisions second, quiz fails lowest but still present
        ai_friction = st['aiQueries'] * 30
        revision_friction = st['revisions'] * 15
        quiz_failure_friction = (st['quizAttempts'] - st['quizCorrect']) * 10
        raw_confusion = ai_friction + revision_friction + quiz_failure_friction
        # Normalize slightly between 10 to 100 for bubble sizing
        confusion_index = min(100, max(10, raw_confusion + 10))

        slide_performance.append({
            'id': sid,
            'name': title,
            'avgDuration': avg_dur,
            'correctRate': corr_rate,
            'quizAttempts': st['quizAttempts'],
            'aiQueries': st['aiQueries'],
            'revisions': st['revisions'],
            'confusionIndex': confusion_index
        })
    slide_performance.sort(key=lambda x: x['avgDuration'], reverse=True)

    # Topology & Student Matrix
    from backend.services.seed_service import FIRST_NAMES, LAST_NAMES
    students_matrix = []
    
    for p in progress_data:
        name = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
        completed = len(p.get('completed_slides') or [])
        prog_pct = round((completed / max(1, len(slides_data))) * 100)
        score = p.get('quiz_score', 0)
        
        # Get specific student behavior patterns
        stud_events = [e for e in events_data if e.get('user_id') == p['user_id']]
        stud_ai_queries = len([e for e in stud_events if e.get('event_type') == 'ai_tutor_query'])
        stud_revisions = len([e for e in stud_events if e.get('event_type') == 'slide_back_navigation'])
        
        # Determine Advanced Typology
        typology = "Standard"
        if prog_pct < 50 and stud_ai_queries > 3:
            typology = "Highly Confused (Seeking Help)"
        elif prog_pct < 50 and stud_ai_queries == 0:
            typology = "Disengaged (At Risk)"
        elif score >= 80 and stud_revisions > 3:
            typology = "The Reviser (High Effort)"
        elif score >= 80 and stud_revisions == 0:
            typology = "Natural Comprehension"
        elif score < 60:
            typology = "Struggling (Critical)"

        students_matrix.append({
            'student_id': p['user_id'],
            'student_name': name,
            'progress_percentage': prog_pct,
            'quiz_score': score,
            'typology': typology,
            'ai_interactions': stud_ai_queries,
            'revisions': stud_revisions
        })

    # Network Ticker - Latest global interactions
    live_ticker = []
    sorted_events = sorted(events_data, key=lambda x: x.get('created_at', ''), reverse=True)
    for e in sorted_events[:15]:
        evt = e.get('event_type')
        if evt in ['ai_tutor_query', 'slide_back_navigation', 'quiz_attempt']:
            slide_title = e.get('event_data', {}).get('slideTitle', 'Unknown Slide')
            desc = ""
            if evt == 'ai_tutor_query':
                q = e.get('event_data', {}).get('query', '')
                desc = f"Asked AI Tutor on {slide_title}: \"{q[:40]}...\""
            elif evt == 'slide_back_navigation':
                desc = f"Navigated backwards from {e.get('event_data',{}).get('fromSlideId', 'Unknown')} (Revision)"
            elif evt == 'quiz_attempt':
                corr = e.get('event_data', {}).get('correct')
                desc = f"{'Failed' if not corr else 'Passed'} quiz on {slide_title}"
            
            live_ticker.append({
                'type': evt,
                'description': desc,
                'time': e.get('created_at', '')
            })

    funnel = [
        {"stage": "Started", "count": unique_students},
        {"stage": "Reached Midpoint", "count": len([p for p in progress_data if len(p.get('completed_slides') or []) >= max(1, len(slides_data)//2)])},
        {"stage": "Completed", "count": len([p for p in progress_data if len(p.get('completed_slides') or []) == len(slides_data)]) if slides_data else 0}
    ]

    # Confidence Map
    conf_events = [e for e in events_data if e.get('event_type') == 'confidence_rating']
    conf_map = {'got_it': 0, 'unsure': 0, 'confused': 0}
    for c in conf_events:
        r = c.get('event_data', {}).get('rating')
        if r in conf_map: conf_map[r] += 1

    return {
        "overview": {
            "uniqueStudents": unique_students,
            "totalAttempts": total_attempts,
            "totalCorrect": total_correct,
            "averageScore": average_score,
            "totalEvents": len(events_data)
        },
        "activityByDay": activity_by_day,
        "slidePerformance": slide_performance,
        "studentsMatrix": students_matrix,
        "funnel": funnel,
        "confidenceMap": conf_map,
        "liveTicker": live_ticker
    }
