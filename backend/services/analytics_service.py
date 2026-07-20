import logging
logger = logging.getLogger(__name__)
import functools
from backend.core.database import SUPABASE_URL, ANON_KEY, supabase_admin, get_db_connection, create_client
from backend.services.utils.analytics_utils import calculate_student_typology, generate_anon_name
from supabase import Client
from backend.services import analytics_cache
import json
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta, date


def cached_analytic(view_name: str):
    """Decorator for the standard lecture-scoped cache-wrapper pattern.

    Replaces the 11x-repeated boilerplate of:
        def get_X(lecture_id, token=None, force_refresh=False):
            return analytics_cache.get_or_compute(
                lecture_id, "view", lambda: _compute_X(lecture_id, token),
                force_refresh=force_refresh,
            )

    Apply directly to the function that computes the value; the decorated
    function keeps the `(lecture_id, token=None, force_refresh=False)`
    signature and transparently checks/populates the cache first.

    Only use this for functions matching that exact shape. Some analytics
    functions (e.g. ``get_professor_overview``) key the cache on different
    params (a ``params=`` dict instead of ``force_refresh``) and are NOT
    equivalent — do not force them through this decorator.
    """
    def decorator(compute_fn):
        @functools.wraps(compute_fn)
        def wrapper(lecture_id: str, token: str = None, force_refresh: bool = False):
            return analytics_cache.get_or_compute(
                lecture_id,
                view_name,
                lambda: compute_fn(lecture_id, token),
                force_refresh=force_refresh,
            )
        return wrapper
    return decorator


def cached_analytic_async(view_name: str):
    """Async counterpart of :func:`cached_analytic`, backed by
    ``analytics_cache.get_or_compute_async``. Same shape/caveats apply."""
    def decorator(compute_fn):
        @functools.wraps(compute_fn)
        async def wrapper(lecture_id: str, token: str = None, force_refresh: bool = False):
            return await analytics_cache.get_or_compute_async(
                lecture_id,
                view_name,
                lambda: compute_fn(lecture_id, token),
                force_refresh=force_refresh,
            )
        return wrapper
    return decorator

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


def _fetch_all_in(
    make_query: Any, column: str, values: List[Any], batch: int = 100
) -> List[Dict[str, Any]]:
    """Fetch all rows where `column` is in `values`, batching the IN(...) list.

    A long `.in_(column, values)` list is serialized into the request URL, and
    once it grows past PostgREST's URL limit the request fails with a 400
    ('JSON could not be generated' / b'Bad Request') — which happens for
    course-wide queries that span hundreds of slide IDs. We split the IN list
    into fixed-size batches and concatenate the results. `make_query` must
    return a *fresh* query builder each call (the IN filter is applied here).
    """
    out: List[Dict[str, Any]] = []
    for i in range(0, len(values), batch):
        out.extend(_fetch_all(make_query().in_(column, values[i : i + batch])))
    return out


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


@cached_analytic("overview")
def get_lecture_overview(lecture_id: str, token: str = None) -> Dict[str, Any]:
    """Get high-level metrics for a lecture (cached)."""
    client = get_auth_client(token)

    progress_data = _fetch_all(client.table("student_progress")\
        .select("user_id, completed_at, quiz_score, total_questions_answered")\
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

    quiz_takers = [p for p in progress_data if (p.get("total_questions_answered") or 0) > 0]
    avg_score = sum(p.get("quiz_score", 0) for p in quiz_takers) / len(quiz_takers) if quiz_takers else 0.0

    return {
        "total_students": total_students,
        "completion_rate": round(completion_rate, 1),
        "average_score": round(avg_score, 1),
        "average_time_minutes": round(avg_time_minutes, 1),
        "engagement_level": engagement
    }


@cached_analytic("slides")
def get_slide_analytics(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    """Get per-slide analytics (cached)."""
    from backend.services.recommendations import compute_slide_recommendation

    client = get_auth_client(token)

    slides_data = _fetch_all(client.table("slides")\
        .select("id, slide_number, title")\
        .eq("lecture_id", lecture_id)\
        .order("slide_number"))

    # Need total_students for drop-off calculation
    progress_data = _fetch_all(client.table("student_progress")\
        .select("user_id")\
        .eq("lecture_id", lecture_id))
    total_students = len(progress_data)

    # Slide views (camelCase 'slideId' in event_data)
    view_events = _fetch_all(client.table("learning_events")\
        .select("event_data")\
        .eq("event_type", "slide_view")\
        .contains("event_data", {"lectureId": lecture_id}))

    # Confidence ratings — used to compute confusion_rate per slide
    confidence_events = _fetch_all(client.table("learning_events")\
        .select("event_data")\
        .eq("event_type", "confidence_rating")\
        .contains("event_data", {"lectureId": lecture_id}))

    # Quiz attempts joined with their slide via quiz_questions
    quiz_questions = _fetch_all(client.table("quiz_questions")\
        .select("id, slide_id, slides!inner(lecture_id)")\
        .eq("slides.lecture_id", lecture_id))
    qid_to_slide = {q["id"]: q["slide_id"] for q in quiz_questions}

    quiz_events = _fetch_all(client.table("learning_events")\
        .select("event_data")\
        .eq("event_type", "quiz_attempt")\
        .contains("event_data", {"lectureId": lecture_id}))

    # Aggregate per-slide quiz totals/correct
    quiz_by_slide: Dict[str, Dict[str, int]] = {}
    for ev in quiz_events:
        ed = ev.get("event_data") or {}
        sid = qid_to_slide.get(ed.get("questionId"))
        if not sid:
            continue
        bucket = quiz_by_slide.setdefault(sid, {"attempts": 0, "correct": 0})
        bucket["attempts"] += 1
        if ed.get("correct"):
            bucket["correct"] += 1

    # Aggregate confusion per slide
    conf_by_slide: Dict[str, Dict[str, int]] = {}
    for ev in confidence_events:
        ed = ev.get("event_data") or {}
        sid = ed.get("slideId")
        rating = ed.get("rating")
        if not sid or rating not in ("got_it", "unsure", "confused"):
            continue
        b = conf_by_slide.setdefault(sid, {"got_it": 0, "unsure": 0, "confused": 0})
        b[rating] += 1

    slide_analytics = []
    for slide in slides_data:
        sid = slide["id"]
        slide_views = [e for e in view_events
                       if e.get("event_data", {}).get("slideId") == sid]

        view_count = len(slide_views)
        avg_time = sum(e.get("event_data", {}).get("duration_seconds", 0)
                      for e in slide_views) / view_count if view_count > 0 else 0
        drop_off = 100 * (1 - (view_count / total_students)) if total_students > 0 else 0

        cb = conf_by_slide.get(sid, {"got_it": 0, "unsure": 0, "confused": 0})
        conf_total = cb["got_it"] + cb["unsure"] + cb["confused"]
        confusion_rate = round((cb["confused"] / conf_total * 100), 1) if conf_total > 0 else 0.0

        qb = quiz_by_slide.get(sid, {"attempts": 0, "correct": 0})
        quiz_attempts = qb["attempts"]
        quiz_success_rate = round((qb["correct"] / quiz_attempts * 100), 1) if quiz_attempts > 0 else None

        label, reasons = compute_slide_recommendation(
            drop_off_rate=max(0.0, drop_off),
            confusion_rate=confusion_rate,
            quiz_success_rate=quiz_success_rate,
            view_count=view_count,
            quiz_attempts=quiz_attempts,
        )

        slide_analytics.append({
            "slide_id": sid,
            "slide_number": slide["slide_number"],
            "title": slide.get("title", f"Slide {slide['slide_number']}"),
            "view_count": view_count,
            "average_time_seconds": round(avg_time, 1),
            "drop_off_rate": round(max(0, drop_off), 1),
            "confusion_rate": confusion_rate,
            "quiz_attempts": quiz_attempts,
            "quiz_success_rate": quiz_success_rate,
            "recommendation_label": label,
            "recommendation_reasons": reasons,
        })

    return slide_analytics


@cached_analytic("quizzes")
def get_quiz_analytics(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    """Get quiz difficulty analytics (cached)."""
    client = get_auth_client(token)

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


@cached_analytic("students")
def get_student_performance(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    """Get per-student performance breakdown (anonymized, cached)."""
    client = get_auth_client(token)

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

        import hashlib
        anon_id = "anon_" + hashlib.md5(p["user_id"].encode()).hexdigest()[:8]
        students_matrix.append({
            "student_id": anon_id,
            "student_name": name,
            "progress_percentage": prog_pct,
            "quiz_score": score,
            "typology": typology,
            "ai_interactions": stud_ai_queries,
            "revisions": stud_revisions
        })

    return sorted(students_matrix, key=lambda x: x["quiz_score"], reverse=True)


@cached_analytic("distractors")
def get_distractor_analysis(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    """Show which wrong answer options students pick most per question (cached)."""
    client = get_auth_client(token)

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


@cached_analytic("retry_performance")
def get_retry_performance(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    """Per-question first-attempt vs second-attempt miss rates for a lecture (cached)."""
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


@cached_analytic("dropoff")
def get_dropoff_map(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    """Show which slide most students abandon the lecture on (cached)."""
    client = get_auth_client(token)

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
        slide_idx = p.get("last_slide_viewed")
        slide_num = (slide_idx + 1) if slide_idx is not None else 1
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


@cached_analytic("confidence_by_slide")
def get_confidence_by_slide(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    """Per-slide confidence breakdown (got_it / unsure / confused; cached)."""
    client = get_auth_client(token)

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


@cached_analytic("ai_queries")
def get_ai_query_feed(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    """Return the latest student AI tutor queries for this lecture (cached)."""
    client = get_auth_client(token)

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


@cached_analytic("insights")
def get_lecture_insights(lecture_id: str, token: str = None) -> Dict[str, Any]:
    """Ranked insight feed powering the Insight Garden (cached)."""
    # Lazy import: the insights package imports this module, so importing it at
    # module top would be circular.
    from backend.services.insights import build_insights

    insights = build_insights(lecture_id, token)
    return {
        "lectureId": lecture_id,
        "computedAt": datetime.utcnow().isoformat() + "Z",
        "insights": insights,
    }


@cached_analytic_async("dashboard")
async def get_dashboard_data(lecture_id: str, token: str = None):
    """Get comprehensive advanced dashboard analytics in a single call using high-performance SQL."""
    try:
        async with await get_db_connection() as conn:
            # Overview Stats
            overview_row = await conn.fetchrow("""
                SELECT 
                    COUNT(DISTINCT user_id)::int as "uniqueStudents",
                    COALESCE(SUM(total_questions_answered), 0)::int as "totalAttempts",
                    COALESCE(SUM(correct_answers), 0)::int as "totalCorrect",
                    ROUND(COALESCE(AVG(CASE WHEN total_questions_answered > 0 THEN (correct_answers::float / total_questions_answered * 100) ELSE NULL END), 0))::int as "averageScore"
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
            slide_idx = p.get("last_slide_viewed")
            slide_num = (slide_idx + 1) if slide_idx is not None else 1
            dropout_by_slide[slide_num] = dropout_by_slide.get(slide_num, 0) + 1
            
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


# ── Professor course-wide overview ───────────────────────────────────────────


async def get_professor_overview(
    course_id: str,
    days: int = 7,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """Course-wide aggregate for the professor dashboard (cached).

    Cache key reuses the ``analytics_cache.lecture_id`` slot but stores
    the course id, paired with ``view_name='professor_overview'``. The
    per-lecture ``invalidate(lecture_id)`` does NOT touch this row;
    course-level invalidation flows through
    :func:`analytics_cache.invalidate_course_overview` (called from the
    backend mutation paths and the DB triggers on
    ``lectures`` / ``slides`` / ``quiz_questions``).
    """
    return await analytics_cache.get_or_compute_async(
        course_id,
        "professor_overview",
        lambda: _compute_professor_overview(course_id, days, token),
        params={"days": days},
    )


async def _compute_professor_overview(
    course_id: str,
    days: int,
    token: Optional[str],
) -> Dict[str, Any]:
    from collections import defaultdict
    import asyncio
    client = get_auth_client(token) if token else supabase_admin

    # 1. Lectures in this course
    lec_rows = await asyncio.to_thread(
        _fetch_all,
        client.table("lectures")
        .select("id, title, total_slides")
        .eq("course_id", course_id)
    )
    lecture_ids = [l["id"] for l in lec_rows]

    empty: Dict[str, Any] = {
        "active_students": 0,
        "average_completion": 0.0,
        "average_quiz_accuracy": 0.0,
        "median_time_minutes": 0.0,
        "weakest_concepts": [],
        "weakest_slides": [],
        "activity_sparkline": _empty_sparkline(days),
        "lecture_count": 0,
        "days": days,
    }
    if not lecture_ids:
        return empty

    total_slides_by_lec = {
        l["id"]: max(1, int(l.get("total_slides") or 1)) for l in lec_rows
    }

    # 2. Progress rows across all lectures in course
    progress = await asyncio.to_thread(
        _fetch_all,
        client.table("student_progress")
        .select(
            "user_id, lecture_id, quiz_score, total_questions_answered, "
            "correct_answers, completed_slides, completed_at"
        )
        .in_("lecture_id", lecture_ids)
    )

    # 3. Recent learning events (last `days` days)
    # Batch query using direct async database connection to prevent N+1 loop
    from datetime import timezone
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    if client.__class__.__name__ == "FakeSupabaseClient":
        course_events = []
        for lid in lecture_ids:
            events_data = await asyncio.to_thread(
                _fetch_all,
                client.table("learning_events")
                .select("user_id, event_type, event_data, created_at")
                .contains("event_data", {"lectureId": lid})
            )
            for e in events_data:
                created_at_val = e.get("created_at")
                if isinstance(created_at_val, str):
                    try:
                        dt_val = datetime.fromisoformat(created_at_val.replace('Z', '+00:00'))
                    except ValueError:
                        dt_val = datetime.now(timezone.utc)
                elif isinstance(created_at_val, datetime):
                    dt_val = created_at_val
                else:
                    dt_val = datetime.now(timezone.utc)

                if dt_val >= cutoff:
                    course_events.append(e)
    else:
        async with await get_db_connection() as conn:
            event_rows = await conn.fetch("""
                SELECT user_id, event_type, event_data, created_at
                FROM learning_events
                WHERE created_at >= $1::timestamptz
                  AND (event_data->>'lectureId') = ANY($2::text[])
            """, cutoff, lecture_ids)
        def _row_to_dict(r):
            d = dict(r)
            ed = d.get("event_data")
            if isinstance(ed, str):
                try:
                    d["event_data"] = json.loads(ed)
                except Exception:
                    d["event_data"] = {}
            return d
        course_events = [_row_to_dict(r) for r in event_rows]

    active_students = len({
        e["user_id"] for e in course_events if e.get("user_id")
    })

    # 4. Average completion across progress rows
    completion_pcts: List[float] = []
    for p in progress:
        total = total_slides_by_lec.get(p.get("lecture_id"), 1)
        completed = len(p.get("completed_slides") or [])
        completion_pcts.append(min(100.0, round((completed / total) * 100, 1)))
    avg_completion = (
        round(sum(completion_pcts) / len(completion_pcts), 1)
        if completion_pcts else 0.0
    )

    # 5. Average quiz accuracy (weighted by attempts)
    total_q = sum(int(p.get("total_questions_answered") or 0) for p in progress)
    total_c = sum(int(p.get("correct_answers") or 0) for p in progress)
    avg_accuracy = round((total_c / total_q) * 100, 1) if total_q > 0 else 0.0

    # 6. Median lecture-completion time (minutes)
    durations: List[float] = []
    for e in course_events:
        if e.get("event_type") != "lecture_complete":
            continue
        d = (e.get("event_data") or {}).get("total_duration_seconds")
        if isinstance(d, (int, float)) and d > 0:
            durations.append(d / 60.0)
    median_time = _median(durations)

    # 7. Weakest concepts (degrades to weakest slides)
    slides = await asyncio.to_thread(
        _fetch_all,
        client.table("slides")
        .select("id, title, lecture_id")
        .in_("lecture_id", lecture_ids)
    )
    slide_ids = [s["id"] for s in slides]
    # Batch the IN list: a course can span hundreds of slides, and a single
    # .in_("slide_id", slide_ids) would overflow the PostgREST URL → 400.
    questions = await asyncio.to_thread(
        _fetch_all_in,
        lambda: client.table("quiz_questions").select("id, metadata, slide_id"),
        "slide_id",
        slide_ids,
    ) if slide_ids else []

    q_concept = {
        q["id"]: ((q.get("metadata") or {}).get("concept") or "").strip()
        for q in questions
    }

    concept_stats: Dict[str, Dict[str, int]] = defaultdict(
        lambda: {"attempts": 0, "correct": 0}
    )
    slide_stats: Dict[str, Dict[str, int]] = defaultdict(
        lambda: {"attempts": 0, "correct": 0}
    )
    for e in course_events:
        if e.get("event_type") != "quiz_attempt":
            continue
        ed_raw = e.get("event_data") or {}
        import json
        ed = json.loads(ed_raw) if isinstance(ed_raw, str) else ed_raw
        if isinstance(ed, str):
            try:
                ed = json.loads(ed)
            except Exception:
                ed = {}
        if not isinstance(ed, dict):
            ed = {}
        qid = ed.get("questionId")
        is_correct = bool(ed.get("correct"))
        concept = q_concept.get(qid)
        if concept:
            concept_stats[concept]["attempts"] += 1
            if is_correct:
                concept_stats[concept]["correct"] += 1
        sid = ed.get("slideId")
        if sid:
            slide_stats[sid]["attempts"] += 1
            if is_correct:
                slide_stats[sid]["correct"] += 1

    weakest_concepts = sorted(
        [
            {
                "concept": c,
                "miss_rate": round((1 - s["correct"] / s["attempts"]) * 100, 1),
                "attempts": s["attempts"],
            }
            for c, s in concept_stats.items() if s["attempts"] > 0
        ],
        key=lambda r: (-r["miss_rate"], -r["attempts"]),
    )[:5]

    weakest_slides: List[Dict[str, Any]] = []
    if not weakest_concepts:
        title_map = {s["id"]: s.get("title") or "Untitled" for s in slides}
        
        irrelevant_keywords = {"intro", "welcome", "date", "info", "agenda", "organization", "logistics", "syllabus", "admin", "overview"}
        def is_relevant_slide(title: str) -> bool:
            t = title.lower()
            return not any(kw in t for kw in irrelevant_keywords)

        weakest_slides = sorted(
            [
                {
                    "slide_id": sid,
                    "title": title_map.get(sid) or "Untitled",
                    "miss_rate": round((1 - s["correct"] / s["attempts"]) * 100, 1),
                    "attempts": s["attempts"],
                }
                for sid, s in slide_stats.items() 
                if s["attempts"] > 0 and is_relevant_slide(title_map.get(sid) or "Untitled")
            ],
            key=lambda r: (-r["miss_rate"], -r["attempts"]),
        )[:5]

    # 8. 7-day activity sparkline (counts learning_events tied to course)
    by_day: Dict[str, int] = defaultdict(int)
    for e in course_events:
        if e.get("event_type") not in (
            "quiz_attempt", "slide_view", "ai_tutor_query",
            "lecture_complete", "confidence_rating",
        ):
            continue
        created = e.get("created_at")
        if isinstance(created, (datetime, date)):
            day = created.isoformat()[:10]
        else:
            day = (created or "")[:10]
        if day:
            by_day[day] += 1
    today = datetime.utcnow().date()
    sparkline = []
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        sparkline.append({"date": d, "count": by_day.get(d, 0)})

    return {
        "active_students": active_students,
        "average_completion": avg_completion,
        "average_quiz_accuracy": avg_accuracy,
        "median_time_minutes": round(median_time, 1),
        "weakest_concepts": weakest_concepts,
        "weakest_slides": weakest_slides,
        "activity_sparkline": sparkline,
        "lecture_count": len(lecture_ids),
        "days": days,
    }


def _median(values: List[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


def _empty_sparkline(days: int) -> List[Dict[str, Any]]:
    today = datetime.utcnow().date()
    return [
        {"date": (today - timedelta(days=i)).isoformat(), "count": 0}
        for i in range(days - 1, -1, -1)
    ]


# ── Comparative Benchmarks (Task #50) ────────────────────────────────────────
#
# Compute a uniform metric pack per lecture so we can compare:
#   • a lecture against its sibling lectures within the same course
#   • a course against the professor's other courses
#
# Every metric is sourced from existing aggregates so numbers match what the
# rest of the dashboard already shows (no double-counting, same time windows).

_BENCHMARK_METRIC_KEYS = (
    "avg_time_minutes",
    "completion_rate",
    "unique_students",
    "drop_off_rate",
    "avg_score",
    "mastery_rate",
    "struggle_rate",
    "distractor_confusion",
    "concept_count",
    "needs_review_share",
)


async def _compute_lecture_benchmark_metrics(
    lecture_id: str,
    token: Optional[str],
) -> Dict[str, float]:
    """Single metric pack for one lecture, reusing cached analytics."""
    import asyncio
    overview, quizzes, distractors, slides = await asyncio.gather(
        asyncio.to_thread(get_lecture_overview, lecture_id, token),
        asyncio.to_thread(get_quiz_analytics, lecture_id, token),
        asyncio.to_thread(get_distractor_analysis, lecture_id, token),
        asyncio.to_thread(get_slide_analytics, lecture_id, token),
    )

    # Engagement
    avg_time = float(overview.get("average_time_minutes") or 0)
    completion = float(overview.get("completion_rate") or 0)
    students = int(overview.get("total_students") or 0)
    # Lecture-level drop-off mirrors what the dashboard shows: students who
    # started but didn't finish (= 100% − completion rate). Per-slide
    # percentages from get_dropoff_map are NOT additive and can't be averaged
    # into a meaningful lecture-level number, so we don't use them here.
    drop_off = round(max(0.0, 100.0 - completion), 1)

    # Quiz performance
    avg_score = float(overview.get("average_score") or 0)
    answered = [q for q in quizzes if (q.get("attempts") or 0) > 0]
    mastery = (
        round(sum(1 for q in answered if (q.get("success_rate") or 0) >= 80)
              / len(answered) * 100, 1)
        if answered else 0.0
    )
    struggle = (
        round(sum(1 for q in answered if (q.get("success_rate") or 0) < 60)
              / len(answered) * 100, 1)
        if answered else 0.0
    )
    # Distractor confusion: questions where the most-picked wrong answer
    # accounts for >= 50% of all wrong picks (a clear pile-up on one
    # distractor — usually a sign of an ambiguous option or shared misconception).
    confused_qs = 0
    relevant_qs = 0
    for d in distractors:
        dist = d.get("answer_distribution") or {}
        correct_idx = str(d.get("correct_answer", -1))
        wrong_total = sum(v for k, v in dist.items() if k != correct_idx)
        if wrong_total <= 0:
            continue
        relevant_qs += 1
        top_wrong = max(
            (v for k, v in dist.items() if k != correct_idx),
            default=0,
        )
        if (top_wrong / wrong_total) >= 0.5:
            confused_qs += 1
    distractor_confusion = (
        round(confused_qs / relevant_qs * 100, 1) if relevant_qs else 0.0
    )

    # Concept coverage — distinct non-empty concept tags on this lecture's questions.
    concept_count = 0
    if token:
        try:
            client = get_auth_client(token)
            qs = await asyncio.to_thread(
                _fetch_all,
                client.table("quiz_questions")
                .select("metadata, slides!inner(lecture_id)")
                .eq("slides.lecture_id", lecture_id)
            )
            concepts = {
                ((q.get("metadata") or {}).get("concept") or "").strip()
                for q in qs
            }
            concepts.discard("")
            concept_count = len(concepts)
        except Exception:
            concept_count = 0

    # Slide quality — share of slides flagged 'needs_review'.
    rated = [s for s in slides if s.get("recommendation_label")]
    needs_review_share = (
        round(sum(1 for s in rated
                  if s.get("recommendation_label") == "needs_review")
              / len(rated) * 100, 1)
        if rated else 0.0
    )

    return {
        "avg_time_minutes": round(avg_time, 1),
        "completion_rate": round(completion, 1),
        "unique_students": students,
        "drop_off_rate": drop_off,
        "avg_score": round(avg_score, 1),
        "mastery_rate": mastery,
        "struggle_rate": struggle,
        "distractor_confusion": distractor_confusion,
        "concept_count": concept_count,
        "needs_review_share": needs_review_share,
    }


def _summarize_metric_pack(packs: List[Dict[str, float]]) -> Dict[str, Dict[str, float]]:
    """avg/min/max/count for each benchmark metric across a peer set."""
    summary: Dict[str, Dict[str, float]] = {}
    for k in _BENCHMARK_METRIC_KEYS:
        vals = [float(p.get(k) or 0) for p in packs]
        if not vals:
            summary[k] = {"avg": 0.0, "min": 0.0, "max": 0.0, "count": 0}
            continue
        summary[k] = {
            "avg": round(sum(vals) / len(vals), 1),
            "min": round(min(vals), 1),
            "max": round(max(vals), 1),
            "count": len(vals),
        }
    return summary


def _aggregate_course_metrics(
    lecture_packs: List[Dict[str, Any]],
) -> Dict[str, float]:
    """Course-level metric pack = average of its lectures' packs.

    Empty courses get zeros so they still render in the comparison table.
    """
    if not lecture_packs:
        return {k: 0 for k in _BENCHMARK_METRIC_KEYS}
    out: Dict[str, float] = {}
    for k in _BENCHMARK_METRIC_KEYS:
        vals = [float(p.get(k) or 0) for p in lecture_packs]
        out[k] = round(sum(vals) / len(vals), 1) if vals else 0.0
    # unique_students is more meaningful as a sum across the course
    out["unique_students"] = int(sum(int(p.get("unique_students") or 0)
                                     for p in lecture_packs))
    return out


async def get_lecture_benchmarks(lecture_id: str, token: Optional[str]) -> Dict[str, Any]:
    """Lecture metric pack + sibling lectures (same course) + peer summary."""
    import asyncio
    if not token:
        raise ValueError("token required")
    client = get_auth_client(token)

    lec_res = await asyncio.to_thread(
        lambda: client.table("lectures")
        .select("id, title, course_id, professor_id")
        .eq("id", lecture_id)
        .execute()
    )
    if not lec_res.data:
        return {
            "scope": "lecture",
            "lecture_id": lecture_id,
            "course_id": None,
            "current": None,
            "peers": [],
            "summary": _summarize_metric_pack([]),
        }
    lec = lec_res.data[0]
    course_id = lec.get("course_id")

    sibling_rows: List[Dict[str, Any]] = []
    if course_id:
        sib_res = await asyncio.to_thread(
            lambda: client.table("lectures")
            .select("id, title")
            .eq("course_id", course_id)
            .execute()
        )
        sibling_rows = sib_res.data or []
    else:
        sibling_rows = [{"id": lec["id"], "title": lec.get("title") or ""}]

    # Fetch sibling lecture metrics rows concurrently
    async def get_metrics_row(s):
        try:
            metrics = await _compute_lecture_benchmark_metrics(s["id"], token)
        except Exception as e:
            logger.warning("Benchmark metric compute failed for %s: %s", s["id"], e)
            metrics = {k: 0 for k in _BENCHMARK_METRIC_KEYS}
        return {
            "lecture_id": s["id"],
            "title": s.get("title") or "Untitled",
            "metrics": metrics,
        }

    rows = list(await asyncio.gather(*(get_metrics_row(s) for s in sibling_rows)))

    current_pack = next((r for r in rows if r["lecture_id"] == lecture_id), None)
    if current_pack is None:
        # current lecture not in sibling set (course mismatch); compute it standalone
        current_metrics = await _compute_lecture_benchmark_metrics(lecture_id, token)
        current_pack = {
            "lecture_id": lecture_id,
            "title": lec.get("title") or "Untitled",
            "metrics": current_metrics,
        }
        rows.append(current_pack)

    peers = [r for r in rows if r["lecture_id"] != lecture_id]
    summary = _summarize_metric_pack([r["metrics"] for r in peers])

    return {
        "scope": "lecture",
        "lecture_id": lecture_id,
        "course_id": course_id,
        "current": current_pack,
        "peers": peers,
        "summary": summary,
    }


async def get_course_benchmarks(course_id: str, token: Optional[str]) -> Dict[str, Any]:
    """Course aggregate metric pack + every other course owned by the same
    professor + peer summary."""
    import asyncio
    if not token:
        raise ValueError("token required")
    client = get_auth_client(token)

    course_res = await asyncio.to_thread(
        lambda: client.table("courses")
        .select("id, title, professor_id")
        .eq("id", course_id)
        .execute()
    )
    if not course_res.data:
        return {
            "scope": "course",
            "course_id": course_id,
            "current": None,
            "peers": [],
            "summary": _summarize_metric_pack([]),
        }
    professor_id = course_res.data[0].get("professor_id")
    course_title = course_res.data[0].get("title") or "Untitled"

    sibling_courses_res = await asyncio.to_thread(
        lambda: client.table("courses")
        .select("id, title")
        .eq("professor_id", professor_id)
        .execute()
    )
    sibling_courses = sibling_courses_res.data or []

    # Process all courses concurrently
    async def get_course_row(c):
        cid = c["id"]
        lec_res = await asyncio.to_thread(
            lambda: client.table("lectures")
            .select("id, title")
            .eq("course_id", cid)
            .execute()
        )
        lecs = lec_res.data or []
        
        # Fetch sibling lecture benchmark metrics concurrently
        lec_packs = await asyncio.gather(*(
            _compute_lecture_benchmark_metrics(l["id"], token)
            for l in lecs
        ), return_exceptions=True)
        
        valid_packs = []
        for l_idx, p in enumerate(lec_packs):
            if isinstance(p, Exception):
                logger.warning("Benchmark compute failed for lecture %s: %s", lecs[l_idx]["id"], p)
            else:
                valid_packs.append(p)
                
        agg = _aggregate_course_metrics(valid_packs)
        return {
            "course_id": cid,
            "title": c.get("title") or "Untitled",
            "lecture_count": len(lecs),
            "metrics": agg,
        }

    rows = list(await asyncio.gather(*(get_course_row(c) for c in sibling_courses)))

    current_pack = next((r for r in rows if r["course_id"] == course_id), None)
    if current_pack is None:
        current_pack = {
            "course_id": course_id,
            "title": course_title,
            "lecture_count": 0,
            "metrics": _aggregate_course_metrics([]),
        }
        rows.append(current_pack)

    peers = [r for r in rows if r["course_id"] != course_id]
    summary = _summarize_metric_pack([r["metrics"] for r in peers])

    return {
        "scope": "course",
        "course_id": course_id,
        "current": current_pack,
        "peers": peers,
        "summary": summary,
    }


# NOTE: get_personal_optimal_schedule moved to
# backend/services/personal_schedule_service.py (P4-1 god-object split —
# it's per-user circadian/study-time analytics, unrelated to the per-lecture
# analytics aggregates in this module).
