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
    """Get high-level metrics for a lecture"""

    progress_response = get_auth_client(token).table("student_progress")\
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
    events_response = get_auth_client(token).table("learning_events")\
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
    """Get per-slide analytics"""

    slides_response = get_auth_client(token).table("slides")\
        .select("id, slide_number, title")\
        .eq("lecture_id", lecture_id)\
        .order("slide_number")\
        .limit(200)\
        .execute()

    # Need total_students for drop-off calculation
    progress_response = get_auth_client(token).table("student_progress")\
        .select("user_id")\
        .eq("lecture_id", lecture_id)\
        .limit(2000)\
        .execute()
    total_students = len(progress_response.data)

    # Fixed: was querying 'slide_viewed' (wrong); correct type is 'slide_view'
    events_response = get_auth_client(token).table("learning_events")\
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
    """Get quiz difficulty analytics"""

    quiz_response = get_auth_client(token).table("quiz_questions")\
        .select("id, question_text, slides!inner(lecture_id)")\
        .eq("slides.lecture_id", lecture_id)\
        .limit(200)\
        .execute()

    events_res = get_auth_client(token).table("learning_events")\
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
    """Get per-student performance breakdown (anonymized)"""

    progress_res = get_auth_client(token).table("student_progress")\
        .select("user_id, quiz_score, total_questions_answered, correct_answers, completed_slides, completed_at")\
        .eq("lecture_id", lecture_id)\
        .limit(2000)\
        .execute()

    slides_res = get_auth_client(token).table("slides")\
        .select("id, slide_number")\
        .eq("lecture_id", lecture_id)\
        .limit(200)\
        .execute()

    events_res = get_auth_client(token).table("learning_events")\
        .select("user_id, event_type")\
        .contains("event_data", {"lectureId": lecture_id})\
        .limit(5000)\
        .execute()

    progress_data = progress_res.data or []
    slides_data = slides_res.data or []
    events_data = events_res.data or []

    students_matrix = []
    for p in progress_data:
        name = generate_anon_name(p["user_id"])
        completed = len(p.get("completed_slides") or [])
        prog_pct = round((completed / max(1, len(slides_data))) * 100)
        score = p.get("quiz_score", 0)

        stud_events = [e for e in events_data if e.get("user_id") == p["user_id"]]
        stud_ai_queries = len([e for e in stud_events if e.get("event_type") == "ai_tutor_query"])
        stud_revisions = len([e for e in stud_events if e.get("event_type") == "slide_back_navigation"])

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
    """
    Show which wrong answer options students pick most per question.
    Derived from selectedAnswer field in quiz_attempt events.
    """

    quiz_res = get_auth_client(token).table("quiz_questions")\
        .select("id, question_text, options, correct_answer, slides!inner(lecture_id)")\
        .eq("slides.lecture_id", lecture_id)\
        .limit(200)\
        .execute()

    events_res = get_auth_client(token).table("learning_events")\
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
    """
    Show which slide most students abandon the lecture on.
    Uses last_slide_viewed from student_progress for non-completers.
    """

    progress_res = get_auth_client(token).table("student_progress")\
        .select("user_id, last_slide_viewed, completed_at")\
        .eq("lecture_id", lecture_id)\
        .limit(2000)\
        .execute()

    slides_res = get_auth_client(token).table("slides")\
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
    """
    Per-slide confidence breakdown (got_it / unsure / confused).
    Currently only the aggregate total is shown; this gives per-slide granularity.
    """

    events_res = get_auth_client(token).table("learning_events")\
        .select("event_data")\
        .eq("event_type", "confidence_rating")\
        .contains("event_data", {"lectureId": lecture_id})\
        .limit(5000)\
        .execute()

    slides_res = get_auth_client(token).table("slides")\
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
    """
    Return the latest student AI tutor queries for this lecture (anonymized).
    The query text is collected but never shown to professors — this surfaces it.
    """

    events_res = get_auth_client(token).table("learning_events")\
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
    # Fetch real DB data
    progress_res = get_auth_client(token).table("student_progress")\
        .select("user_id, quiz_score, total_questions_answered, correct_answers, completed_slides, completed_at")\
        .eq("lecture_id", lecture_id)\
        .limit(2000)\
        .execute()
    events_res = get_auth_client(token).table("learning_events")\
        .select("user_id, event_type, event_data, created_at")\
        .contains("event_data", {"lectureId": lecture_id})\
        .limit(5000)\
        .execute()
    slides_res = get_auth_client(token).table("slides")\
        .select("id, title, slide_number")\
        .eq("lecture_id", lecture_id)\
        .limit(200)\
        .execute()

    progress_data = progress_res.data or []
    events_data = events_res.data or []
    slides_data = slides_res.data or []

    # Overview
    unique_students = len({p["user_id"] for p in progress_data})
    total_attempts = sum(p.get("total_questions_answered") or 0 for p in progress_data)
    total_correct = sum(p.get("correct_answers") or 0 for p in progress_data)
    average_score = round((total_correct / total_attempts * 100) if total_attempts > 0 else 0)

    # Activity By Day (last 7 days)
    last_7_days = [(datetime.now() - timedelta(days=6 - i)).strftime("%Y-%m-%d") for i in range(7)]
    activity_by_day = []
    for d in last_7_days:
        day_events = [e for e in events_data if e.get("event_type") == "quiz_attempt" and e.get("created_at", "").startswith(d)]
        weekday = datetime.strptime(d, "%Y-%m-%d").strftime("%a")
        activity_by_day.append({"date": weekday, "attempts": len(day_events)})

    # Deep Slide Analysis
    slide_stats = {}
    for ev in events_data:
        ev_data = ev.get("event_data", {})
        sid = ev_data.get("slideId") or ev_data.get("fromSlideId")
        if not sid:
            continue

        if sid not in slide_stats:
            slide_stats[sid] = {"duration": 0, "views": 0, "quizCorrect": 0, "quizAttempts": 0, "aiQueries": 0, "revisions": 0, "slideTitle": ""}

        ev_type = ev.get("event_type")
        if ev_type == "slide_view":
            slide_stats[sid]["duration"] += ev_data.get("duration_seconds", 0)
            slide_stats[sid]["views"] += 1
            if ev_data.get("slideTitle"):
                slide_stats[sid]["slideTitle"] = ev_data.get("slideTitle")
        elif ev_type == "quiz_attempt":
            slide_stats[sid]["quizAttempts"] += 1
            if ev_data.get("correct"):
                slide_stats[sid]["quizCorrect"] += 1
        elif ev_type == "ai_tutor_query":
            slide_stats[sid]["aiQueries"] += 1
        elif ev_type == "slide_back_navigation":
            slide_stats[sid]["revisions"] += 1

    slide_performance = []
    for sid, st in slide_stats.items():
        real_slide = next((s for s in slides_data if s["id"] == sid), None)
        title = real_slide["title"] if real_slide else st["slideTitle"] or f"Slide {sid[:4]}"
        avg_dur = round(st["duration"] / st["views"]) if st["views"] > 0 else 0
        corr_rate = round((st["quizCorrect"] / st["quizAttempts"]) * 100) if st["quizAttempts"] > 0 else 0

        ai_friction = st["aiQueries"] * 30
        revision_friction = st["revisions"] * 15
        quiz_failure_friction = (st["quizAttempts"] - st["quizCorrect"]) * 10
        raw_confusion = ai_friction + revision_friction + quiz_failure_friction
        confusion_index = min(100, max(10, raw_confusion + 10))

        slide_performance.append({
            "id": sid,
            "name": title,
            "avgDuration": avg_dur,
            "correctRate": corr_rate,
            "quizAttempts": st["quizAttempts"],
            "aiQueries": st["aiQueries"],
            "revisions": st["revisions"],
            "confusionIndex": confusion_index
        })
    slide_performance.sort(key=lambda x: x["avgDuration"], reverse=True)

    # Student Typology Matrix
    students_matrix = []
    for p in progress_data:
        name = generate_anon_name(p["user_id"])
        completed = len(p.get("completed_slides") or [])
        prog_pct = round((completed / max(1, len(slides_data))) * 100)
        score = p.get("quiz_score", 0)

        stud_events = [e for e in events_data if e.get("user_id") == p["user_id"]]
        stud_ai_queries = len([e for e in stud_events if e.get("event_type") == "ai_tutor_query"])
        stud_revisions = len([e for e in stud_events if e.get("event_type") == "slide_back_navigation"])

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

    # Completion Funnel
    funnel = [
        {"stage": "Started", "count": unique_students},
        {"stage": "Reached Midpoint", "count": len([p for p in progress_data if len(p.get("completed_slides") or []) >= max(1, len(slides_data) // 2)])},
        {"stage": "Completed", "count": len([p for p in progress_data if len(p.get("completed_slides") or []) == len(slides_data)]) if slides_data else 0}
    ]

    # Confidence Map (aggregate)
    conf_events = [e for e in events_data if e.get("event_type") == "confidence_rating"]
    conf_map = {"got_it": 0, "unsure": 0, "confused": 0}
    for c in conf_events:
        r = c.get("event_data", {}).get("rating")
        if r in conf_map:
            conf_map[r] += 1

    # Live Ticker
    live_ticker = []
    sorted_events = sorted(events_data, key=lambda x: x.get("created_at", ""), reverse=True)
    for e in sorted_events[:15]:
        evt = e.get("event_type")
        if evt in ["ai_tutor_query", "slide_back_navigation", "quiz_attempt"]:
            slide_title = e.get("event_data", {}).get("slideTitle", "Unknown Slide")
            desc = ""
            if evt == "ai_tutor_query":
                q = e.get("event_data", {}).get("query", "")
                desc = f'Asked AI Tutor on {slide_title}: "{q[:40]}..."'
            elif evt == "slide_back_navigation":
                desc = f"Navigated backwards from {e.get('event_data', {}).get('fromSlideId', 'Unknown')} (Revision)"
            elif evt == "quiz_attempt":
                corr = e.get("event_data", {}).get("correct")
                desc = f"{'Passed' if corr else 'Failed'} quiz on {slide_title}"

            live_ticker.append({
                "type": evt,
                "description": desc,
                "time": e.get("created_at", "")
            })

    # Completion Time Distribution — new insight
    complete_events = [e for e in events_data if e.get("event_type") == "lecture_complete"]
    time_buckets = {"< 5min": 0, "5–15min": 0, "15–30min": 0, "> 30min": 0}
    for e in complete_events:
        secs = e.get("event_data", {}).get("total_duration_seconds", 0)
        mins = secs / 60
        if mins < 5:
            time_buckets["< 5min"] += 1
        elif mins < 15:
            time_buckets["5–15min"] += 1
        elif mins < 30:
            time_buckets["15–30min"] += 1
        else:
            time_buckets["> 30min"] += 1

    completion_times = [{"bucket": k, "count": v} for k, v in time_buckets.items()]

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
        "liveTicker": live_ticker,
        "completionTimes": completion_times
    }
