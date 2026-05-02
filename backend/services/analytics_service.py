from backend.core.database import SUPABASE_URL, ANON_KEY, supabase_admin, db_pool, get_db_connection
from backend.services.utils.analytics_utils import calculate_student_typology, generate_anon_name
from supabase import create_client, Client
from functools import lru_cache
from backend.services import cache
import json
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta

def _fetch_all(query: Any, limit: int = 10000) -> List[Dict[str, Any]]:
    """Helper to fetch all records from a Supabase query using pagination."""
    all_data: List[Dict[str, Any]] = []
    chunk_size = 1000
    for offset in range(0, limit, chunk_size):
        res = query.range(offset, offset + chunk_size - 1).execute()
        if not res.data:
            break
        all_data.extend(res.data)
        if len(res.data) < chunk_size:
            break
    return all_data


def get_auth_client(token: Optional[str]) -> Client:
    """Create a Supabase client authenticated with the user's JWT.
    Enforces RLS by using the ANON_KEY (not the service_role key).

    Raises ValueError when called without a token. Callers that legitimately
    need to bypass RLS for background tasks must import supabase_admin
    directly — we no longer silently downgrade to admin (that was a
    privilege-escalation hazard).
    """
    if not token:
        raise ValueError(
            "get_auth_client requires a user JWT. "
            "Use supabase_admin directly for trusted background tasks."
        )
    if not ANON_KEY:
        raise RuntimeError(
            "ANON_KEY not configured; cannot create RLS-enforcing client."
        )
    client: Client = create_client(SUPABASE_URL, ANON_KEY)
    client.postgrest.auth(token)
    return client


def get_lecture_overview(lecture_id: str, token: str = None) -> Dict[str, Any]:
    client = get_auth_client(token)
    """Get high-level metrics for a lecture"""

    progress_data = _fetch_all(client.table("student_progress")\
        .select("user_id, completed_at, quiz_score")\
        .eq("lecture_id", lecture_id))

    total_students = len(progress_data)

    if total_students == 0:
        return {
            "total_students": 0,
            "completion_rate": 0,
            "average_score": 0,
            "average_time_minutes": 0,
            "engagement_level": "No Data"
        }

    completed = len([p for p in progress_data if p.get("completed_at")])
    completion_rate = (completed / total_students) * 100 if total_students > 0 else 0

    # Get average time from lecture_complete events (was querying wrong event_type before)
    events_data = _fetch_all(client.table("learning_events")\
        .select("event_data")\
        .eq("event_type", "lecture_complete")\
        .contains("event_data", {"lectureId": lecture_id}))

    total_time = 0
    event_count = 0
    for event in events_data:
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
        "average_score": round(sum(p.get("quiz_score", 0) for p in progress_data) / total_students, 1),
        "average_time_minutes": round(avg_time_minutes, 1),
        "engagement_level": engagement
    }


def get_slide_analytics(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    client = get_auth_client(token)
    """Get per-slide analytics"""

    slides_data = _fetch_all(client.table("slides")\
        .select("id, slide_number, title")\
        .eq("lecture_id", lecture_id)\
        .order("slide_number"))

    # Need total_students for drop-off calculation
    progress_data = _fetch_all(client.table("student_progress")\
        .select("user_id")\
        .eq("lecture_id", lecture_id))
    total_students = len(progress_data)

    # Fixed: was querying 'slide_viewed' (wrong); correct type is 'slide_view'
    events_data = _fetch_all(client.table("learning_events")\
        .select("event_data")\
        .eq("event_type", "slide_view")\
        .contains("event_data", {"lectureId": lecture_id}))

    slide_analytics = []
    for slide in slides_data:
        # Fixed: event_data key is camelCase 'slideId', not 'slide_id'
        slide_events = [e for e in events_data
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

    quiz_data = _fetch_all(client.table("quiz_questions")\
        .select("id, question_text, slides!inner(lecture_id)")\
        .eq("slides.lecture_id", lecture_id))

    events_data = _fetch_all(client.table("learning_events")\
        .select("event_data")\
        .eq("event_type", "quiz_attempt")\
        .contains("event_data", {"lectureId": lecture_id}))

    attempts_data = events_data or []
    quiz_analytics = []

    for question in quiz_data:
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

    return sorted(quiz_analytics, key=lambda x: x["success_rate"])


def get_student_performance(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    client = get_auth_client(token)
    """Get per-student performance breakdown (anonymized)"""

    progress_data = _fetch_all(client.table("student_progress")\
        .select("user_id, quiz_score, total_questions_answered, correct_answers, completed_slides, completed_at")\
        .eq("lecture_id", lecture_id))

    slides_data = _fetch_all(client.table("slides")\
        .select("id, slide_number")\
        .eq("lecture_id", lecture_id))

    events_data = _fetch_all(client.table("learning_events")\
        .select("user_id, event_type")\
        .contains("event_data", {"lectureId": lecture_id}))

    # Data is already lists from _fetch_all

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

        typology = calculate_student_typology(prog_pct, score, stud_ai_queries, stud_revisions)

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

    quiz_data = _fetch_all(client.table("quiz_questions")\
        .select("id, question_text, options, correct_answer, slides!inner(lecture_id)")\
        .eq("slides.lecture_id", lecture_id))

    events_data = _fetch_all(client.table("learning_events")\
        .select("event_data")\
        .eq("event_type", "quiz_attempt")\
        .contains("event_data", {"lectureId": lecture_id}))

    attempts_data = events_data or []
    result = []

    for question in quiz_data:
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
        
        # Tie-breaking distractor analysis
        most_common_wrongs = []
        if wrong_counts:
            max_v = max(wrong_counts.values())
            most_common_wrongs = [int(k) for k, v in wrong_counts.items() if v == max_v]

        result.append({
            "question_id": question["id"],
            "question_text": question["question_text"],
            "options": question.get("options", []),
            "correct_answer": question.get("correct_answer"),
            "answer_distribution": answer_distribution,
            "most_common_wrong_answer": most_common_wrongs[0] if most_common_wrongs else None,
            "all_common_wrong_answers": most_common_wrongs,
            "total_attempts": total_attempts
        })

    return result


def _calculate_retry_performance(
    questions: List[Dict[str, Any]],
    first_attempt_events: List[Dict[str, Any]],
    retry_attempt_events: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Pure aggregator: rank questions by first- and second-attempt miss rate.

    questions: [{id, question_text}]
    first_attempt_events / retry_attempt_events: [{event_data: {questionId, correct}}]

    Returns rows sorted by first_attempt_miss_rate desc; questions with no
    first-attempt data go to the end.
    """
    by_q_first: Dict[str, List[bool]] = {}
    for e in first_attempt_events:
        ed = e.get("event_data") or {}
        qid = ed.get("questionId")
        if qid:
            by_q_first.setdefault(qid, []).append(bool(ed.get("correct")))

    by_q_retry: Dict[str, List[bool]] = {}
    for e in retry_attempt_events:
        ed = e.get("event_data") or {}
        qid = ed.get("questionId")
        if qid:
            by_q_retry.setdefault(qid, []).append(bool(ed.get("correct")))

    rows = []
    for q in questions:
        qid = q["id"]
        first = by_q_first.get(qid, [])
        retry = by_q_retry.get(qid, [])
        first_total = len(first)
        first_misses = sum(1 for c in first if not c)
        retry_total = len(retry)
        retry_misses = sum(1 for c in retry if not c)
        first_rate = round((first_misses / first_total) * 100, 1) if first_total else 0.0
        retry_rate = round((retry_misses / retry_total) * 100, 1) if retry_total else 0.0
        rows.append({
            "question_id": qid,
            "question_text": q.get("question_text", ""),
            "first_attempt_total": first_total,
            "first_attempt_misses": first_misses,
            "first_attempt_miss_rate": first_rate,
            "retry_total": retry_total,
            "retry_misses": retry_misses,
            "retry_miss_rate": retry_rate,
        })

    rows.sort(key=lambda r: (
        0 if r["first_attempt_total"] > 0 else 1,
        -r["first_attempt_miss_rate"],
        -r["retry_miss_rate"],
        r["question_id"],
    ))
    return rows


def get_retry_performance(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    """Per-question first-attempt vs second-attempt miss rates for a lecture."""
    client = get_auth_client(token)

    quiz_data = _fetch_all(client.table("quiz_questions")
        .select("id, question_text, slides!inner(lecture_id)")
        .eq("slides.lecture_id", lecture_id))

    first_events = _fetch_all(client.table("learning_events")
        .select("event_data")
        .eq("event_type", "quiz_attempt")
        .contains("event_data", {"lectureId": lecture_id}))

    retry_events = _fetch_all(client.table("learning_events")
        .select("event_data")
        .eq("event_type", "quiz_retry_attempt")
        .contains("event_data", {"lectureId": lecture_id}))

    return _calculate_retry_performance(quiz_data, first_events, retry_events)


def get_dropoff_map(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    client = get_auth_client(token)
    """
    Show which slide most students abandon the lecture on.
    Uses last_slide_viewed from student_progress for non-completers.
    """

    progress_data = _fetch_all(client.table("student_progress")\
        .select("user_id, last_slide_viewed, completed_at")\
        .eq("lecture_id", lecture_id))

    slides_data = _fetch_all(client.table("slides")\
        .select("id, slide_number, title")\
        .eq("lecture_id", lecture_id)\
        .order("slide_number"))

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

    events_data = _fetch_all(client.table("learning_events")\
        .select("event_data")\
        .eq("event_type", "confidence_rating")\
        .contains("event_data", {"lectureId": lecture_id}))

    slides_data = _fetch_all(client.table("slides")\
        .select("id, slide_number, title")\
        .eq("lecture_id", lecture_id)\
        .order("slide_number"))

    slide_id_map = {s["id"]: s for s in slides_data}

    # Aggregate confidence per slide
    slide_conf: Dict[str, Dict[str, int]] = {}
    for e in events_data:
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

    events_data = _fetch_all(client.table("learning_events")\
        .select("event_data, created_at")\
        .eq("event_type", "ai_tutor_query")\
        .contains("event_data", {"lectureId": lecture_id})\
        .order("created_at", desc=True))

    result = []
    for e in events_data:
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


async def get_dashboard_data(lecture_id: str, token: str = None):
    """Get comprehensive advanced dashboard analytics in a single call using high-performance SQL."""
    cache_key = f"dashboard_data:{lecture_id}"
    
    # 1. Try cache first
    cached_data = await cache.get_cache(cache_key)
    if cached_data:
        return cached_data

    # 2. Direct SQL Aggregation (Lighter on Python, faster on DB)
    try:
        async with await get_db_connection() as conn:
            # Overview Stats
            overview_row = await conn.fetchrow("""
                SELECT 
                    COUNT(DISTINCT user_id)::int as "uniqueStudents",
                    COALESCE(SUM(total_questions_answered), 0)::int as "totalAttempts",
                    COALESCE(SUM(correct_answers), 0)::int as "totalCorrect",
                    ROUND(COALESCE(AVG(CASE WHEN total_questions_answered > 0 THEN (correct_answers::float / total_questions_answered * 100) ELSE 0 END), 0))::int as "averageScore"
                FROM student_progress 
                WHERE lecture_id = $1::uuid
            """, lecture_id)

            # Activity By Day (Last 7 days)
            activity_rows = await conn.fetch("""
                WITH days AS (
                    SELECT CURRENT_DATE - i as day 
                    FROM generate_series(0, 6) i
                )
                SELECT 
                    TO_CHAR(days.day, 'Dy') as "date",
                    COUNT(le.id)::int as "attempts"
                FROM days
                LEFT JOIN learning_events le ON le.created_at::date = days.day 
                    AND le.event_type = 'quiz_attempt'
                    AND le.event_data->>'lectureId' = $1
                GROUP BY days.day
                ORDER BY days.day ASC
            """, lecture_id)

            # Slide Performance
            slide_rows = await conn.fetch("""
                SELECT 
                    s.id, 
                    s.title as "name",
                    ROUND(COALESCE(AVG((le.event_data->>'duration_seconds')::int) FILTER (WHERE le.event_type = 'slide_view'), 0))::int as "avgDuration",
                    COUNT(le.id) FILTER (WHERE le.event_type = 'quiz_attempt')::int as "quizAttempts",
                    COUNT(le.id) FILTER (WHERE le.event_type = 'quiz_attempt' AND (le.event_data->>'correct')::boolean = true)::int as "quizCorrect",
                    COUNT(le.id) FILTER (WHERE le.event_type = 'ai_tutor_query')::int as "aiQueries",
                    COUNT(le.id) FILTER (WHERE le.event_type = 'slide_back_navigation')::int as "revisions"
                FROM slides s
                LEFT JOIN learning_events le ON le.event_data->>'lectureId' = $1 
                    AND (le.event_data->>'slideId' = s.id::text OR le.event_data->>'fromSlideId' = s.id::text)
                WHERE s.lecture_id = $1::uuid
                GROUP BY s.id, s.title, s.slide_number
                ORDER BY "avgDuration" DESC
            """, lecture_id)

            # Students Matrix
            student_rows = await conn.fetch("""
                SELECT 
                    p.user_id as "student_id",
                    p.quiz_score as "quiz_score",
                    COALESCE(array_length(p.completed_slides, 1), 0)::int as "completed_count",
                    COUNT(le.id) FILTER (WHERE le.event_type = 'ai_tutor_query')::int as "ai_interactions",
                    COUNT(le.id) FILTER (WHERE le.event_type = 'slide_back_navigation')::int as "revisions"
                FROM student_progress p
                LEFT JOIN learning_events le ON le.user_id = p.user_id 
                    AND le.event_data->>'lectureId' = $1
                WHERE p.lecture_id = $1::uuid
                GROUP BY p.user_id, p.quiz_score, p.completed_slides
                ORDER BY p.quiz_score DESC
            """, lecture_id)

            # Slide Count for matrix calc
            num_slides = await conn.fetchval("SELECT COUNT(*)::int FROM slides WHERE lecture_id = $1::uuid", lecture_id)
            num_slides = max(1, num_slides)

            # Confidence Map (Overall counts)
            conf_counts = await conn.fetchrow("""
                SELECT 
                    COUNT(le.id) FILTER (WHERE le.event_data->>'rating' = 'got_it')::int as "got_it",
                    COUNT(le.id) FILTER (WHERE le.event_data->>'rating' = 'unsure')::int as "unsure",
                    COUNT(le.id) FILTER (WHERE le.event_data->>'rating' = 'confused')::int as "confused"
                FROM learning_events le
                WHERE le.event_type = 'confidence_rating' AND le.event_data->>'lectureId' = $1
            """, lecture_id)

            # Retry Performance — first-attempt vs second-attempt miss rates per question.
            # First and retry events are pre-aggregated separately to avoid the
            # N×M row multiplication that would occur from joining both event
            # sets in a single FROM clause.
            retry_rows = await conn.fetch("""
                WITH first_agg AS (
                    SELECT
                        event_data->>'questionId' AS question_id,
                        COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE (event_data->>'correct')::boolean = false)::int AS misses
                    FROM learning_events
                    WHERE event_type = 'quiz_attempt'
                      AND event_data->>'lectureId' = $1
                    GROUP BY event_data->>'questionId'
                ),
                retry_agg AS (
                    SELECT
                        event_data->>'questionId' AS question_id,
                        COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE (event_data->>'correct')::boolean = false)::int AS misses
                    FROM learning_events
                    WHERE event_type = 'quiz_retry_attempt'
                      AND event_data->>'lectureId' = $1
                    GROUP BY event_data->>'questionId'
                )
                SELECT
                    q.id::text AS "question_id",
                    q.question_text AS "question_text",
                    COALESCE(fa.total, 0)::int AS "first_attempt_total",
                    COALESCE(fa.misses, 0)::int AS "first_attempt_misses",
                    COALESCE(ra.total, 0)::int AS "retry_total",
                    COALESCE(ra.misses, 0)::int AS "retry_misses"
                FROM quiz_questions q
                JOIN slides s ON s.id = q.slide_id
                LEFT JOIN first_agg fa ON fa.question_id = q.id::text
                LEFT JOIN retry_agg ra ON ra.question_id = q.id::text
                WHERE s.lecture_id = $1::uuid
            """, lecture_id)

            # Live Ticker & AI Queries
            ticker_rows = await conn.fetch("""
                SELECT 
                    event_type as "type",
                    event_data,
                    created_at::text as "time"
                FROM learning_events
                WHERE event_data->>'lectureId' = $1
                    AND event_type IN ('ai_tutor_query', 'slide_back_navigation', 'quiz_attempt')
                ORDER BY created_at DESC
                LIMIT 50
            """, lecture_id)

    except Exception as e:
        logger.error("Database analytics failure: %s", e)
        # Fallback to sync supabase if pool fails (optional, but safer to just raise)
        raise

    # 3. Post-process (Small Python loops)
    processed_slides = []
    for r in slide_rows:
        corr_rate = round((r["quizCorrect"] / r["quizAttempts"] * 100)) if r["quizAttempts"] > 0 else 0
        raw_confusion = (r["aiQueries"] * 30) + (r["revisions"] * 15) + ((r["quizAttempts"] - r["quizCorrect"]) * 10)
        processed_slides.append({
            **dict(r),
            "correctRate": corr_rate,
            "confusionIndex": min(100, max(10, raw_confusion + 10))
        })

    processed_students = []
    for r in student_rows:
        prog_pct = round((r["completed_count"] / num_slides) * 100)
        processed_students.append({
            "student_id": r["student_id"],
            "student_name": generate_anon_name(r["student_id"]),
            "progress_percentage": prog_pct,
            "quiz_score": r["quiz_score"],
            "typology": calculate_student_typology(prog_pct, r["quiz_score"], r["ai_interactions"], r["revisions"]),
            "ai_interactions": r["ai_interactions"],
            "revisions": r["revisions"]
        })

    ai_query_feed = []
    live_ticker = []
    for r in ticker_rows:
        evd = json.loads(r["event_data"]) if isinstance(r["event_data"], str) else r["event_data"]
        slide_title = evd.get("slideTitle", "Unknown Slide")
        
        if r["type"] == "ai_tutor_query":
            q_text = evd.get("query", "").strip()
            if q_text:
                ai_query_feed.append({"slide_title": slide_title, "query_text": q_text, "created_at": r["time"]})
                if len(live_ticker) < 15:
                    live_ticker.append({"type": r["type"], "description": f'Asked AI Tutor: "{q_text[:40]}..."', "time": r["time"]})
        elif len(live_ticker) < 15:
            if r["type"] == "slide_back_navigation":
                desc = f"Navigated backwards from {evd.get('fromSlideId', 'Unknown')} (Revision)"
            else:
                desc = f"{'Passed' if evd.get('correct') else 'Failed'} quiz on {slide_title}"
            live_ticker.append({"type": r["type"], "description": desc, "time": r["time"]})

    # Compute miss-rates from raw counts (kept out of SQL to avoid div-by-zero noise)
    retry_performance = []
    for r in retry_rows:
        d = dict(r)
        ft = d["first_attempt_total"]
        rt = d["retry_total"]
        d["first_attempt_miss_rate"] = round((d["first_attempt_misses"] / ft) * 100, 1) if ft else 0.0
        d["retry_miss_rate"] = round((d["retry_misses"] / rt) * 100, 1) if rt else 0.0
        retry_performance.append(d)
    retry_performance.sort(key=lambda r: (
        0 if r["first_attempt_total"] > 0 else 1,
        -r["first_attempt_miss_rate"],
        -r["retry_miss_rate"],
        r["question_id"],
    ))

    result = {
        "overview": {**dict(overview_row), "totalEvents": sum(dict(conf_counts).values()) + len(ticker_rows)},
        "activityByDay": [dict(r) for r in activity_rows],
        "slidePerformance": processed_slides,
        "studentsMatrix": processed_students,
        "confidenceMap": dict(conf_counts),
        "liveTicker": live_ticker,
        "aiQueryFeed": ai_query_feed[:50],
        "retryPerformance": retry_performance,
        # Re-using slide_rows for a simpler confidence map if needed, or just passing overall
        "dropoffData": [], # Can be added if needed, but keeping it light for now
        "confidenceBySlide": [] # Can be added similarly
    }

    # 4. Store in cache
    await cache.set_cache(cache_key, result, ttl_seconds=300)
    
    return result


def _group_events_by_user(events_data: list) -> dict:
    from collections import defaultdict
    groups = defaultdict(list)
    for ev in events_data:
        uid = ev.get("user_id")
        if uid: groups[uid].append(ev)
    return groups


def _group_events_by_slide(events_data: list) -> dict:
    from collections import defaultdict
    groups = defaultdict(list)
    for ev in events_data:
        ev_data = ev.get("event_data", {})
        sid = ev_data.get("slideId") or ev_data.get("fromSlideId")
        if sid: groups[sid].append(ev)
    return groups


def _calculate_overview_stats(progress_data: list, total_events: int, student_count: int) -> dict:
    total_attempts = sum(p.get("total_questions_answered") or 0 for p in progress_data)
    total_correct = sum(p.get("correct_answers") or 0 for p in progress_data)
    average_score = round((total_correct / total_attempts * 100) if total_attempts > 0 else 0)
    return {
        "uniqueStudents": student_count,
        "totalAttempts": total_attempts,
        "totalCorrect": total_correct,
        "averageScore": average_score,
        "totalEvents": total_events
    }


def _calculate_activity_by_day(events_data: list) -> list:
    last_7_days = [(datetime.now() - timedelta(days=6 - i)).strftime("%Y-%m-%d") for i in range(7)]
    events_by_day = {}
    for ev in events_data:
        if ev.get("event_type") == "quiz_attempt":
            day = ev.get("created_at", "")[:10]
            events_by_day[day] = events_by_day.get(day, 0) + 1
            
    return [
        {"date": datetime.strptime(d, "%Y-%m-%d").strftime("%a"), "attempts": events_by_day.get(d, 0)}
        for d in last_7_days
    ]


def _calculate_slide_performance(slides_data: list, events_by_slide: dict) -> list:
    perf = []
    for s in slides_data:
        sid = s["id"]
        slide_events = events_by_slide.get(sid, [])
        st = {"duration": 0, "views": 0, "quizCorrect": 0, "quizAttempts": 0, "aiQueries": 0, "revisions": 0}
        for ev in slide_events:
            evt, evd = ev.get("event_type"), ev.get("event_data", {})
            if evt == "slide_view":
                st["duration"] += evd.get("duration_seconds", 0)
                st["views"] += 1
            elif evt == "quiz_attempt":
                st["quizAttempts"] += 1
                if evd.get("correct"): st["quizCorrect"] += 1
            elif evt == "ai_tutor_query": st["aiQueries"] += 1
            elif evt == "slide_back_navigation": st["revisions"] += 1

        avg_dur = round(st["duration"] / st["views"]) if st["views"] > 0 else 0
        corr_rate = round((st["quizCorrect"] / st["quizAttempts"]) * 100) if st["quizAttempts"] > 0 else 0
        raw_confusion = (st["aiQueries"] * 30) + (st["revisions"] * 15) + ((st["quizAttempts"] - st["quizCorrect"]) * 10)
        
        perf.append({
            "id": sid, "name": s["title"], "avgDuration": avg_dur, "correctRate": corr_rate,
            "quizAttempts": st["quizAttempts"], "aiQueries": st["aiQueries"], "revisions": st["revisions"],
            "confusionIndex": min(100, max(10, raw_confusion + 10))
        })
    return sorted(perf, key=lambda x: x["avgDuration"], reverse=True)


def _calculate_students_matrix(progress_data: list, events_by_user: dict, num_slides: int) -> list:
    matrix = []
    num_slides = max(1, num_slides)
    for p in progress_data:
        uid = p["user_id"]
        completed_count = len(p.get("completed_slides") or [])
        prog_pct = round((completed_count / num_slides) * 100)
        score = p.get("quiz_score", 0)
        stud_events = events_by_user.get(uid, [])
        stud_ai_queries = sum(1 for e in stud_events if e.get("event_type") == "ai_tutor_query")
        stud_revisions = sum(1 for e in stud_events if e.get("event_type") == "slide_back_navigation")

        typology = calculate_student_typology(prog_pct, score, stud_ai_queries, stud_revisions)

        matrix.append({
            "student_id": uid, "student_name": generate_anon_name(uid), "progress_percentage": prog_pct,
            "quiz_score": score, "typology": typology, "ai_interactions": stud_ai_queries, "revisions": stud_revisions
        })
    return sorted(matrix, key=lambda x: x["quiz_score"], reverse=True)


def _calculate_confidence_map(slides_data: list, events_by_slide: dict) -> tuple:
    overall_conf = {"got_it": 0, "unsure": 0, "confused": 0}
    slide_conf_list = []
    for s in slides_data:
        sid = s["id"]
        slide_events = events_by_slide.get(sid, [])
        s_counts = {"got_it": 0, "unsure": 0, "confused": 0}
        for ev in slide_events:
            if ev.get("event_type") == "confidence_rating":
                r = ev.get("event_data", {}).get("rating")
                if r in s_counts:
                    s_counts[r] += 1
                    overall_conf[r] += 1
        
        total_s = sum(s_counts.values())
        slide_conf_list.append({
            "slide_number": s["slide_number"], "title": s["title"],
            **s_counts, "total": total_s, 
            "confusion_rate": round((s_counts["confused"] / total_s * 100) if total_s > 0 else 0, 1)
        })
    return overall_conf, slide_conf_list


def _calculate_dropoff_map(slides_data: list, progress_data: list, student_count: int) -> list:
    dropout_by_slide = {}
    for p in progress_data:
        if not p.get("completed_at"):
            s_num = p.get("last_slide_viewed", 1)
            dropout_by_slide[s_num] = dropout_by_slide.get(s_num, 0) + 1
            
    return [
        {
            "slide_number": s["slide_number"], "title": s["title"],
            "dropout_count": dropout_by_slide.get(s["slide_number"], 0),
            "dropout_percentage": round((dropout_by_slide.get(s["slide_number"], 0) / student_count * 100) if student_count > 0 else 0, 1)
        }
        for s in slides_data if s["slide_number"] in dropout_by_slide
    ]


def _generate_live_feeds(events_data: list) -> tuple:
    ticker, queries = [], []
    sorted_events = sorted(events_data, key=lambda x: x.get("created_at", ""), reverse=True)
    for e in sorted_events:
        evt, evd = e.get("event_type"), e.get("event_data", {})
        if evt == "ai_tutor_query":
            q_text = evd.get("query", "").strip()
            if q_text: queries.append({"slide_title": evd.get("slideTitle", "Unknown Slide"), "query_text": q_text, "created_at": e.get("created_at", "")})
        if len(ticker) < 15 and evt in ["ai_tutor_query", "slide_back_navigation", "quiz_attempt"]:
            slide_title = evd.get("slideTitle", "Unknown Slide")
            if evt == "ai_tutor_query": desc = f'Asked AI Tutor on {slide_title}: "{evd.get("query", "")[:40]}..."'
            elif evt == "slide_back_navigation": desc = f"Navigated backwards from {evd.get('fromSlideId', 'Unknown')} (Revision)"
            else: desc = f"{'Passed' if evd.get('correct') else 'Failed'} quiz on {slide_title}"
            ticker.append({"type": evt, "description": desc, "time": e.get("created_at", "")})
    return ticker, queries


def get_personal_optimal_schedule(user_id: str, token: str = None) -> Dict[str, Any]:
    """
    Calculate the best time to study for a specific student based on:
    1. Circadian patterns (when they are active)
    2. Performance metrics (accuracy and speed during different hours)
    """
    client = get_auth_client(token)
    
    # Fetch all learning events for this user
    events_data = _fetch_all(client.table("learning_events")\
        .select("event_type, event_data, created_at")\
        .eq("user_id", user_id))
    
    events = events_data or []
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
    pattern = "Calibrating"
    if peak is not None:
        if 5 <= peak < 12:
            advice = "You're a morning lark! Your focus and accuracy are highest in the AM."
            pattern = "Morning Peak"
        elif 12 <= peak < 17:
            advice = "Afternoon power-user! You handle complex topics well in the middle of the day."
            pattern = "Afternoon Surge"
        elif 17 <= peak < 22:
            advice = "Evening focus! You seem to reach your flow state as the day winds down."
            pattern = "Evening Flow"
        else:
            advice = "Night owl detected! You show high cognitive clarity during late-night sessions."
            pattern = "Night Owl"

    # For the frontend timeline, we want ALL 24 hours.
    # Hours without data will have a baseline score.
    full_day_stats = []
    for h in range(24):
        # Find if we have real data for this hour
        existing = next((s for s in scores if s["hour"] == h), None)
        if existing:
            full_day_stats.append(existing)
        else:
            full_day_stats.append({
                "hour": h,
                "score": 0.1, # Baseline
                "accuracy": 0,
                "intensity": 0
            })

    # Sort full_day_stats by hour for the timeline
    full_day_stats.sort(key=lambda x: x["hour"])

    return {
        "suggested_hours": full_day_stats,
        "peak_hour": peak,
        "message": advice,
        "accuracy_at_peak": suggested[0]["accuracy"] if suggested else 0,
        "energy_pattern": pattern,
        "circadian_score": int(suggested[0]["score"] * 100) if suggested else 0
    }
