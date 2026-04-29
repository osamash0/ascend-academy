"""
Analytics Service - Aggregates learning analytics data
"""
from backend.core.database import supabase, url, key
from supabase import create_client
import hashlib
from typing import Dict, List, Any
from datetime import datetime, timedelta


def get_auth_client(token: str):
    """Create a Supabase client authenticated with the professor's JWT.
    This allows RLS policies (has_role check) to identify the professor
    and return all student data."""
    if not token:
        return supabase
    client = create_client(url, key)
    client.postgrest.auth(token)
    return client


def generate_anon_name(user_id: str) -> str:
    """Generate a creative, deterministic anonymous name for a student."""
    h = hashlib.md5(str(user_id).encode()).hexdigest()
    themes = ["Nexus", "Quantum", "Neural", "Prism", "Cortex", "Vector", "Logic", "Pulse"]
    theme = themes[int(h[:2], 16) % len(themes)]
    hex_id = h[-4:].upper()
    return f"{theme}-{hex_id}"


def get_lecture_overview(lecture_id: str, token: str = None) -> Dict[str, Any]:
    client = get_auth_client(token)
    """Get high-level metrics for a lecture"""

    progress_response = client.table("student_progress")\
        .select("user_id, completed_at, quiz_score")\
        .eq("lecture_id", lecture_id)\
        .limit(2000)\
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

    completed = len([p for p in progress_response.data if p.get("completed_at")])
    completion_rate = (completed / total_students) * 100 if total_students > 0 else 0

    # Get average time from lecture_complete events (was querying wrong event_type before)
    events_response = client.table("learning_events")\
        .select("event_data")\
        .eq("event_type", "lecture_complete")\
        .contains("event_data", {"lectureId": lecture_id})\
        .limit(500)\
        .execute()

    total_time = 0
    event_count = 0
    for event in events_response.data:
        if event.get("event_data") and isinstance(event["event_data"], dict):
            duration = event["event_data"].get("total_duration_seconds", 0)
            total_time += duration
            event_count += 1

    avg_time_minutes = (total_time / event_count / 60) if event_count > 0 else 0

    if avg_time_minutes > 20:
        engagement = "High"
    elif avg_time_minutes > 8:
        engagement = "Medium"
    else:
        engagement = "Low"

    return {
        "total_students": total_students,
        "completion_rate": round(completion_rate, 1),
        "average_score": round(sum(p.get("quiz_score", 0) for p in progress_response.data) / total_students, 1),
        "average_time_minutes": round(avg_time_minutes, 1),
        "engagement_level": engagement
    }


def get_slide_analytics(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    client = get_auth_client(token)
    """Get per-slide analytics"""

    slides_response = client.table("slides")\
        .select("id, slide_number, title")\
        .eq("lecture_id", lecture_id)\
        .order("slide_number")\
        .limit(200)\
        .execute()

    # Need total_students for drop-off calculation
    progress_response = client.table("student_progress")\
        .select("user_id")\
        .eq("lecture_id", lecture_id)\
        .limit(2000)\
        .execute()
    total_students = len(progress_response.data)

    # Fixed: was querying 'slide_viewed' (wrong); correct type is 'slide_view'
    events_response = client.table("learning_events")\
        .select("event_data")\
        .eq("event_type", "slide_view")\
        .contains("event_data", {"lectureId": lecture_id})\
        .limit(5000)\
        .execute()

    slide_analytics = []
    for slide in slides_response.data:
        # Fixed: event_data key is camelCase 'slideId', not 'slide_id'
        slide_events = [e for e in events_response.data
                       if e.get("event_data", {}).get("slideId") == slide["id"]]

        view_count = len(slide_events)
        avg_time = sum(e.get("event_data", {}).get("duration_seconds", 0)
                      for e in slide_events) / view_count if view_count > 0 else 0

        drop_off = 100 * (1 - (view_count / total_students)) if total_students > 0 else 0

        slide_analytics.append({
            "slide_number": slide["slide_number"],
            "title": slide.get("title", f"Slide {slide['slide_number']}"),
            "view_count": view_count,
            "average_time_seconds": round(avg_time, 1),
            "drop_off_rate": round(max(0, drop_off), 1)
        })

    return slide_analytics


def get_quiz_analytics(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    client = get_auth_client(token)
    """Get quiz difficulty analytics"""

    quiz_response = client.table("quiz_questions")\
        .select("id, question_text, slides!inner(lecture_id)")\
        .eq("slides.lecture_id", lecture_id)\
        .limit(200)\
        .execute()

    events_res = client.table("learning_events")\
        .select("event_data")\
        .eq("event_type", "quiz_attempt")\
        .contains("event_data", {"lectureId": lecture_id})\
        .limit(5000)\
        .execute()

    attempts_data = events_res.data or []
    quiz_analytics = []

    for question in quiz_response.data:
        q_attempts = [e for e in attempts_data if e.get("event_data", {}).get("questionId") == question["id"]]
        total_q = len(q_attempts)
        correct_q = len([e for e in q_attempts if e.get("event_data", {}).get("correct")])

        success_rate = (correct_q / total_q * 100) if total_q > 0 else 0

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
            "attempts": total_q
        })

    # Fixed: was 'sorted(students, ...)' — students variable never existed
    return sorted(quiz_analytics, key=lambda x: x["success_rate"])


def get_student_performance(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    client = get_auth_client(token)
    """Get per-student performance breakdown (anonymized)"""

    progress_res = client.table("student_progress")\
        .select("user_id, quiz_score, total_questions_answered, correct_answers, completed_slides, completed_at")\
        .eq("lecture_id", lecture_id)\
        .limit(2000)\
        .execute()

    slides_res = client.table("slides")\
        .select("id, slide_number")\
        .eq("lecture_id", lecture_id)\
        .limit(200)\
        .execute()

    events_res = client.table("learning_events")\
        .select("user_id, event_type")\
        .contains("event_data", {"lectureId": lecture_id})\
        .limit(5000)\
        .execute()

    progress_data = progress_res.data or []
    slides_data = slides_res.data or []
    events_data = events_res.data or []

    # Pre-bucket events by user to avoid O(n²) scans inside the student loop
    from collections import defaultdict
    events_by_user: dict = defaultdict(list)
    for e in events_data:
        uid = e.get("user_id")
        if uid:
            events_by_user[uid].append(e)

    students_matrix = []
    for p in progress_data:
        name = generate_anon_name(p["user_id"])
        completed = len(p.get("completed_slides") or [])
        prog_pct = round((completed / max(1, len(slides_data))) * 100)
        score = p.get("quiz_score", 0)

        stud_events = events_by_user[p["user_id"]]
        stud_ai_queries = sum(1 for e in stud_events if e.get("event_type") == "ai_tutor_query")
        stud_revisions = sum(1 for e in stud_events if e.get("event_type") == "slide_back_navigation")

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
            "student_id": p["user_id"],
            "student_name": name,
            "progress_percentage": prog_pct,
            "quiz_score": score,
            "typology": typology,
            "ai_interactions": stud_ai_queries,
            "revisions": stud_revisions
        })

    return sorted(students_matrix, key=lambda x: x["quiz_score"], reverse=True)


def get_distractor_analysis(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    client = get_auth_client(token)
    """
    Show which wrong answer options students pick most per question.
    Derived from selectedAnswer field in quiz_attempt events.
    """

    quiz_res = client.table("quiz_questions")\
        .select("id, question_text, options, correct_answer, slides!inner(lecture_id)")\
        .eq("slides.lecture_id", lecture_id)\
        .limit(200)\
        .execute()

    events_res = client.table("learning_events")\
        .select("event_data")\
        .eq("event_type", "quiz_attempt")\
        .contains("event_data", {"lectureId": lecture_id})\
        .limit(5000)\
        .execute()

    attempts_data = events_res.data or []
    result = []

    for question in quiz_res.data:
        q_attempts = [
            e["event_data"] for e in attempts_data
            if e.get("event_data", {}).get("questionId") == question["id"]
        ]

        total_attempts = len(q_attempts)
        answer_distribution: Dict[str, int] = {}
        for attempt in q_attempts:
            selected = attempt.get("selectedAnswer")
            if selected is not None:
                key = str(selected)
                answer_distribution[key] = answer_distribution.get(key, 0) + 1

        correct_idx = str(question.get("correct_answer", -1))
        wrong_counts = {k: v for k, v in answer_distribution.items() if k != correct_idx}
        most_common_wrong = max(wrong_counts, key=wrong_counts.get) if wrong_counts else None

        result.append({
            "question_id": question["id"],
            "question_text": question["question_text"],
            "options": question.get("options", []),
            "correct_answer": question.get("correct_answer"),
            "answer_distribution": answer_distribution,
            "most_common_wrong_answer": int(most_common_wrong) if most_common_wrong is not None else None,
            "total_attempts": total_attempts
        })

    return result


def get_dropoff_map(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    client = get_auth_client(token)
    """
    Show which slide most students abandon the lecture on.
    Uses last_slide_viewed from student_progress for non-completers.
    """

    progress_res = client.table("student_progress")\
        .select("user_id, last_slide_viewed, completed_at")\
        .eq("lecture_id", lecture_id)\
        .limit(2000)\
        .execute()

    slides_res = client.table("slides")\
        .select("id, slide_number, title")\
        .eq("lecture_id", lecture_id)\
        .order("slide_number")\
        .limit(200)\
        .execute()

    progress_data = progress_res.data or []
    slides_data = slides_res.data or []
    total_started = len(progress_data)

    # Only count students who never finished
    dropouts = [p for p in progress_data if not p.get("completed_at")]

    # Count dropouts per slide number
    dropout_by_slide: Dict[int, int] = {}
    for p in dropouts:
        slide_num = p.get("last_slide_viewed", 1)
        dropout_by_slide[slide_num] = dropout_by_slide.get(slide_num, 0) + 1

    # Build slide title map
    slide_title_map = {s["slide_number"]: s.get("title") or f"Slide {s['slide_number']}" for s in slides_data}

    result = []
    for slide_num, count in sorted(dropout_by_slide.items()):
        result.append({
            "slide_number": slide_num,
            "title": slide_title_map.get(slide_num, f"Slide {slide_num}"),
            "dropout_count": count,
            "dropout_percentage": round((count / total_started * 100) if total_started > 0 else 0, 1)
        })

    return result


def get_confidence_by_slide(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    client = get_auth_client(token)
    """
    Per-slide confidence breakdown (got_it / unsure / confused).
    Currently only the aggregate total is shown; this gives per-slide granularity.
    """

    events_res = client.table("learning_events")\
        .select("event_data")\
        .eq("event_type", "confidence_rating")\
        .contains("event_data", {"lectureId": lecture_id})\
        .limit(5000)\
        .execute()

    slides_res = client.table("slides")\
        .select("id, slide_number, title")\
        .eq("lecture_id", lecture_id)\
        .order("slide_number")\
        .limit(200)\
        .execute()

    slide_id_map = {s["id"]: s for s in (slides_res.data or [])}

    # Aggregate confidence per slide
    slide_conf: Dict[str, Dict[str, int]] = {}
    for e in (events_res.data or []):
        ev_data = e.get("event_data", {})
        sid = ev_data.get("slideId")
        rating = ev_data.get("rating")
        if not sid or rating not in ("got_it", "unsure", "confused"):
            continue
        if sid not in slide_conf:
            slide_conf[sid] = {"got_it": 0, "unsure": 0, "confused": 0}
        slide_conf[sid][rating] += 1

    result = []
    for sid, counts in slide_conf.items():
        slide_info = slide_id_map.get(sid)
        total = counts["got_it"] + counts["unsure"] + counts["confused"]
        confusion_rate = round((counts["confused"] / total * 100) if total > 0 else 0, 1)

        result.append({
            "slide_number": slide_info["slide_number"] if slide_info else 0,
            "title": (slide_info.get("title") or f"Slide {sid[:4]}") if slide_info else f"Slide {sid[:4]}",
            "got_it": counts["got_it"],
            "unsure": counts["unsure"],
            "confused": counts["confused"],
            "total": total,
            "confusion_rate": confusion_rate
        })

    return sorted(result, key=lambda x: x["confusion_rate"], reverse=True)


def get_ai_query_feed(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    client = get_auth_client(token)
    """
    Return the latest student AI tutor queries for this lecture (anonymized).
    The query text is collected but never shown to professors — this surfaces it.
    """

    events_res = client.table("learning_events")\
        .select("event_data, created_at")\
        .eq("event_type", "ai_tutor_query")\
        .contains("event_data", {"lectureId": lecture_id})\
        .order("created_at", desc=True)\
        .limit(50)\
        .execute()

    result = []
    for e in (events_res.data or []):
        ev_data = e.get("event_data", {})
        query_text = ev_data.get("query", "").strip()
        if not query_text:
            continue
        result.append({
            "slide_title": ev_data.get("slideTitle", "Unknown Slide"),
            "query_text": query_text,
            "created_at": e.get("created_at", "")
        })

    return result


# Advanced Dashboard Data Collection
def get_dashboard_data(lecture_id: str, token: str = None):
    client = get_auth_client(token)
    
    # 1. Efficiently fetch data from Supabase
    progress_res = client.table("student_progress")\
        .select("user_id, quiz_score, total_questions_answered, correct_answers, completed_slides, completed_at, last_slide_viewed")\
        .eq("lecture_id", lecture_id)\
        .limit(2000)\
        .execute()
    
    events_res = client.table("learning_events")\
        .select("user_id, event_type, event_data, created_at")\
        .contains("event_data", {"lectureId": lecture_id})\
        .limit(5000)\
        .execute()
    
    slides_res = client.table("slides")\
        .select("id, title, slide_number")\
        .eq("lecture_id", lecture_id)\
        .order("slide_number")\
        .limit(200)\
        .execute()

    progress_data = progress_res.data or []
    events_data = events_res.data or []
    slides_data = slides_res.data or []
    
    # 2. Pre-index data for O(1) lookups
    events_by_user = {}
    for ev in events_data:
        uid = ev.get("user_id")
        if uid not in events_by_user:
            events_by_user[uid] = []
        events_by_user[uid].append(ev)

    events_by_slide = {}
    for ev in events_data:
        ev_data = ev.get("event_data", {})
        sid = ev_data.get("slideId") or ev_data.get("fromSlideId")
        if sid:
            if sid not in events_by_slide:
                events_by_slide[sid] = []
            events_by_slide[sid].append(ev)

    unique_user_ids = {p["user_id"] for p in progress_data}
    unique_students_count = len(unique_user_ids)

    # 3. Calculate Overview Stats
    total_attempts = sum(p.get("total_questions_answered") or 0 for p in progress_data)
    total_correct = sum(p.get("correct_answers") or 0 for p in progress_data)
    average_score = round((total_correct / total_attempts * 100) if total_attempts > 0 else 0)

    # 4. Activity By Day (Optimized lookup)
    last_7_days = [(datetime.now() - timedelta(days=6 - i)).strftime("%Y-%m-%d") for i in range(7)]
    events_by_day = {}
    for ev in events_data:
        if ev.get("event_type") == "quiz_attempt":
            day = ev.get("created_at", "")[:10]
            events_by_day[day] = events_by_day.get(day, 0) + 1
            
    activity_by_day = [
        {"date": datetime.strptime(d, "%Y-%m-%d").strftime("%a"), "attempts": events_by_day.get(d, 0)}
        for d in last_7_days
    ]

    # 5. Deep Slide Analysis
    slide_performance = []
    for s in slides_data:
        sid = s["id"]
        slide_events = events_by_slide.get(sid, [])
        st = {"duration": 0, "views": 0, "quizCorrect": 0, "quizAttempts": 0, "aiQueries": 0, "revisions": 0}
        for ev in slide_events:
            ev_type = ev.get("event_type")
            ev_data = ev.get("event_data", {})
            if ev_type == "slide_view":
                st["duration"] += ev_data.get("duration_seconds", 0)
                st["views"] += 1
            elif ev_type == "quiz_attempt":
                st["quizAttempts"] += 1
                if ev_data.get("correct"): st["quizCorrect"] += 1
            elif ev_type == "ai_tutor_query": st["aiQueries"] += 1
            elif ev_type == "slide_back_navigation": st["revisions"] += 1

        avg_dur = round(st["duration"] / st["views"]) if st["views"] > 0 else 0
        corr_rate = round((st["quizCorrect"] / st["quizAttempts"]) * 100) if st["quizAttempts"] > 0 else 0
        raw_confusion = (st["aiQueries"] * 30) + (st["revisions"] * 15) + ((st["quizAttempts"] - st["quizCorrect"]) * 10)
        confusion_index = min(100, max(10, raw_confusion + 10))

        slide_performance.append({
            "id": sid, "name": s["title"], "avgDuration": avg_dur, "correctRate": corr_rate,
            "quizAttempts": st["quizAttempts"], "aiQueries": st["aiQueries"], "revisions": st["revisions"],
            "confusionIndex": confusion_index
        })
    slide_performance.sort(key=lambda x: x["avgDuration"], reverse=True)

    # 6. Student Typology Matrix
    students_matrix = []
    num_slides = max(1, len(slides_data))
    for p in progress_data:
        uid = p["user_id"]
        completed_count = len(p.get("completed_slides") or [])
        prog_pct = round((completed_count / num_slides) * 100)
        score = p.get("quiz_score", 0)
        stud_events = events_by_user.get(uid, [])
        stud_ai_queries = sum(1 for e in stud_events if e.get("event_type") == "ai_tutor_query")
        stud_revisions = sum(1 for e in stud_events if e.get("event_type") == "slide_back_navigation")

        typology = "Standard"
        if prog_pct < 50: typology = "Highly Confused (Seeking Help)" if stud_ai_queries > 3 else "Disengaged (At Risk)"
        elif score >= 80: typology = "The Reviser (High Effort)" if stud_revisions > 3 else "Natural Comprehension"
        elif score < 60: typology = "Struggling (Critical)"

        students_matrix.append({
            "student_id": uid, "student_name": generate_anon_name(uid), "progress_percentage": prog_pct,
            "quiz_score": score, "typology": typology, "ai_interactions": stud_ai_queries, "revisions": stud_revisions
        })
    students_matrix.sort(key=lambda x: x["quiz_score"], reverse=True)

    # 7. Confidence & Dropoff Map
    conf_map = {"got_it": 0, "unsure": 0, "confused": 0}
    slide_confidence_list = []
    for s in slides_data:
        sid = s["id"]
        slide_events = events_by_slide.get(sid, [])
        s_conf = {"got_it": 0, "unsure": 0, "confused": 0}
        for ev in slide_events:
            if ev.get("event_type") == "confidence_rating":
                r = ev.get("event_data", {}).get("rating")
                if r in s_conf:
                    s_conf[r] += 1
                    conf_map[r] += 1
        
        total_s = sum(s_conf.values())
        slide_confidence_list.append({
            "slide_number": s["slide_number"], "title": s["title"],
            "got_it": s_conf["got_it"], "unsure": s_conf["unsure"], "confused": s_conf["confused"],
            "total": total_s, "confusion_rate": round((s_conf["confused"] / total_s * 100) if total_s > 0 else 0, 1)
        })
                
    dropout_by_slide = {}
    for p in progress_data:
        if not p.get("completed_at"):
            s_num = p.get("last_slide_viewed", 1)
            dropout_by_slide[s_num] = dropout_by_slide.get(s_num, 0) + 1
            
    dropoff_list = [
        {
            "slide_number": s["slide_number"], "title": s["title"],
            "dropout_count": dropout_by_slide.get(s["slide_number"], 0),
            "dropout_percentage": round((dropout_by_slide.get(s["slide_number"], 0) / unique_students_count * 100) if unique_students_count > 0 else 0, 1)
        }
        for s in slides_data if s["slide_number"] in dropout_by_slide
    ]

    # 8. Live Ticker & AI Query Feed
    live_ticker = []
    ai_queries = []
    sorted_events = sorted(events_data, key=lambda x: x.get("created_at", ""), reverse=True)
    for e in sorted_events:
        evt, ev_data = e.get("event_type"), e.get("event_data", {})
        if evt == "ai_tutor_query":
            q_text = ev_data.get("query", "").strip()
            if q_text: ai_queries.append({"slide_title": ev_data.get("slideTitle", "Unknown Slide"), "query_text": q_text, "created_at": e.get("created_at", "")})
        if len(live_ticker) < 15 and evt in ["ai_tutor_query", "slide_back_navigation", "quiz_attempt"]:
            slide_title = ev_data.get("slideTitle", "Unknown Slide")
            if evt == "ai_tutor_query": desc = f'Asked AI Tutor on {slide_title}: "{ev_data.get("query", "")[:40]}..."'
            elif evt == "slide_back_navigation": desc = f"Navigated backwards from {ev_data.get('fromSlideId', 'Unknown')} (Revision)"
            else: desc = f"{'Passed' if ev_data.get('correct') else 'Failed'} quiz on {slide_title}"
            live_ticker.append({"type": evt, "description": desc, "time": e.get("created_at", "")})

    return {
        "overview": {"uniqueStudents": unique_students_count, "totalAttempts": total_attempts, "totalCorrect": total_correct, "averageScore": average_score, "totalEvents": len(events_data)},
        "activityByDay": activity_by_day, "slidePerformance": slide_performance, "studentsMatrix": students_matrix,
        "confidenceMap": conf_map, "liveTicker": live_ticker, "dropoffData": dropoff_list, "aiQueryFeed": ai_queries[:50],
        "confidenceBySlide": slide_confidence_list
    }



def get_personal_optimal_schedule(user_id: str, token: str = None) -> Dict[str, Any]:
    """
    Calculate the best time to study for a specific student based on:
    1. Circadian patterns (when they are active)
    2. Performance metrics (accuracy and speed during different hours)
    """
    client = get_auth_client(token)
    
    # Fetch all learning events for this user
    events_res = client.table("learning_events")\
        .select("event_type, event_data, created_at")\
        .eq("user_id", user_id)\
        .limit(5000)\
        .execute()
    
    events = events_res.data or []
    if not events:
        return {
            "suggested_hours": [],
            "message": "Not enough data yet. Keep learning to see your optimal schedule!",
            "peak_hour": None
        }

    # Group by hour (0-23)
    # Note: We should ideally handle timezone, but using UTC for now
    hourly_stats = {h: {"count": 0, "correct": 0, "attempts": 0, "total_duration": 0, "view_count": 0} for h in range(24)}
    
    # Login events are not learning activity — exclude to avoid skewing circadian scores
    _EXCLUDED_EVENT_TYPES = {"login"}

    for ev in events:
        if ev.get("event_type") in _EXCLUDED_EVENT_TYPES:
            continue
        try:
            # created_at is like '2024-03-20T10:30:00+00:00'
            dt = datetime.fromisoformat(ev["created_at"].replace('Z', '+00:00'))
            hour = dt.hour

            hourly_stats[hour]["count"] += 1

            ev_type = ev.get("event_type")
            ev_data = ev.get("event_data", {})
            
            if ev_type == "quiz_attempt":
                hourly_stats[hour]["attempts"] += 1
                if ev_data.get("correct"):
                    hourly_stats[hour]["correct"] += 1
            elif ev_type == "slide_view":
                hourly_stats[hour]["view_count"] += 1
                hourly_stats[hour]["total_duration"] += ev_data.get("duration_seconds", 0)
        except Exception:
            continue

    # Score each hour
    scores = []
    for h, s in hourly_stats.items():
        if s["count"] == 0:
            continue
            
        # Volume (20% weight) - normalized against max count
        # Accuracy (50% weight) - correct/attempts
        # Focus (30% weight) - avg duration per slide
        
        accuracy = (s["correct"] / s["attempts"]) if s["attempts"] > 0 else 0.5 # Neutral if no quizzes
        avg_duration = (s["total_duration"] / s["view_count"]) if s["view_count"] > 0 else 30
        
        # Scale duration to a 0-1 score (assume 60s is ideal "deep focus" per slide)
        focus_score = min(1.0, avg_duration / 60.0)
        
        # Volume score
        intensity = min(1.0, s["count"] / 10.0) # Assume 10 events/hour is high intensity
        
        total_score = (intensity * 0.2) + (accuracy * 0.5) + (focus_score * 0.3)
        
        scores.append({
            "hour": h,
            "score": round(total_score, 3),
            "accuracy": round(accuracy * 100, 1),
            "intensity": s["count"]
        })

    # Sort by score
    scores.sort(key=lambda x: x["score"], reverse=True)
    
    suggested = scores[:3]
    if not suggested:
        return {
            "suggested_hours": [],
            "message": "Not enough data yet. Keep learning!",
            "peak_hour": None
        }

    peak = suggested[0]["hour"]
    
    # Simple advice logic
    advice = ""
    if peak >= 5 and peak < 12:
        advice = "You're a morning lark! Your focus and accuracy are highest in the AM."
    elif peak >= 12 and peak < 17:
        advice = "Afternoon power-user! You handle complex topics well in the middle of the day."
    elif peak >= 17 and peak < 22:
        advice = "Evening focus! You seem to reach your flow state as the day winds down."
    else:
        advice = "Night owl detected! You show high cognitive clarity during late-night sessions."

    return {
        "suggested_hours": suggested,
        "peak_hour": peak,
        "message": advice,
        "accuracy_at_peak": suggested[0]["accuracy"]
    }
