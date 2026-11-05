import logging
logger = logging.getLogger(__name__)
import functools
from backend.core.database import SUPABASE_URL, ANON_KEY, supabase_admin, get_db_connection, create_client
from backend.services.utils.analytics_utils import calculate_student_typology, generate_anon_name
from supabase import Client
from backend.services import analytics_cache
import json
import hashlib
from functools import lru_cache
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta, date, timezone


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


@lru_cache(maxsize=128)
def get_auth_client(token: str = None) -> Client:
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


#: People a slide needs before the legacy views say anything about how they feel about it.
#: Same figure as the v4 door's MIN_READERS (space_engine); kept here to avoid an import cycle.
MIN_PEOPLE = 5

_RATINGS = ("got_it", "unsure", "confused")


def lecture_owner_id(client: Client, lecture_id: str) -> Optional[str]:
    """The lecture's owner (`lectures.professor_id`), whose own reading never counts."""
    rows = client.table("lectures").select("professor_id").eq("id", lecture_id).execute().data or []
    return rows[0].get("professor_id") if rows else None


def people_ratings(events: List[Dict[str, Any]], owner_id: Optional[str], slide_id: Optional[str] = None) -> Dict[str, Dict[str, str]]:
    """Each person's latest check-in per slide, as {slide_id: {user_id: rating}}.

    Takes events oldest first (latest write wins). The owner and events without a
    person are dropped. Counting people, not events, is what makes the floor mean 5 people.
    """
    out: Dict[str, Dict[str, str]] = {}
    for ev in events:
        uid = ev.get("user_id")
        if not uid or uid == owner_id:
            continue
        ed = ev.get("event_data") or {}
        sid = ed.get("slideId")
        rating = ed.get("rating")
        if not sid or rating not in _RATINGS or (slide_id is not None and sid != slide_id):
            continue
        out.setdefault(sid, {})[uid] = rating
    return out


def _floored_counts(events: List[Dict[str, Any]], owner_id: Optional[str]) -> Dict[str, Dict[str, int]]:
    """{slide_id: {got_it, unsure, confused}} over people, only for slides MIN_PEOPLE+ people rated."""
    result: Dict[str, Dict[str, int]] = {}
    for sid, by_person in people_ratings(events, owner_id).items():
        if len(by_person) < MIN_PEOPLE:
            continue
        counts = {r: 0 for r in _RATINGS}
        for rating in by_person.values():
            counts[rating] += 1
        result[sid] = counts
    return result


def _confidence_counts_by_slide(
    client: Client, lecture_id: str, owner_id: Optional[str] = None, owner_known: bool = False
) -> Dict[str, Dict[str, int]]:
    """{slide_id: {got_it, unsure, confused}} over people, only for slides 5+ people rated."""
    events = _fetch_all(client.table("learning_events")\
        .select("user_id, event_data, created_at")\
        .eq("event_type", "confidence_rating")\
        .eq("event_data->>lectureId", str(lecture_id))\
        .order("created_at"))
    if not owner_known:
        owner_id = lecture_owner_id(client, lecture_id)
    return _floored_counts(events, owner_id)


#: The dashboard's quiz-score bands; counts only, the dashboard never lists a learner (decided 2026-11-05).
_SCORE_EDGES = (20, 40, 60, 80)


def score_bands(scores: list) -> list:
    """People per quiz-score band (0-20, 21-40, 41-60, 61-80, 81-100); empty under MIN_PEOPLE people."""
    if len(scores) < MIN_PEOPLE:
        return []
    bands = [0] * (len(_SCORE_EDGES) + 1)
    for sc in scores:
        value = float(sc or 0)
        bands[sum(1 for edge in _SCORE_EDGES if value > edge)] += 1
    return bands


def _same_person(uid: Any, other: Any) -> bool:
    return other is not None and str(uid) == str(other)


def people_first_tries(events: List[Dict[str, Any]], owner_id: Optional[str]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """Each person's first try per question, as {question_id: {user_id: event_data}}.

    Takes events oldest first. One person trying N times is one person, and the owner and
    events without a person are dropped: the floor means 5 people, never 5 tries.
    """
    out: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for ev in events:
        uid = ev.get("user_id")
        ed = ev.get("event_data") or {}
        qid = ed.get("questionId")
        if not uid or _same_person(uid, owner_id) or not qid:
            continue
        out.setdefault(qid, {}).setdefault(str(uid), ed)
    return out


def legacy_questions(rows: List[Dict[str, Any]], owner_id: Optional[str]) -> Optional[List[Dict[str, Any]]]:
    """The legacy tutor questions that may be shown word for word, or None while fewer than 5 people asked.

    rows: [{user_id, event_data (dict), created_at}] newest first. v4 reader questions never count
    or appear here (they reach owners only as themes), the owner is not an asker, and rows without
    a person are dropped. The rows returned are the caller's own; callers must not pass a user id on.
    """
    kept: List[Dict[str, Any]] = []
    askers: set = set()
    for r in rows:
        ed = r.get("event_data") or {}
        uid = r.get("user_id")
        if ed.get("source") == "v4_reader" or not uid or _same_person(uid, owner_id):
            continue
        if not (ed.get("query") or "").strip():
            continue
        askers.add(str(uid))
        kept.append(r)
    return kept if len(askers) >= MIN_PEOPLE else None


def legacy_question_feed(rows: List[Dict[str, Any]], owner_id: Optional[str]) -> List[Dict[str, Any]]:
    """Legacy tutor questions word for word, newest first, only when 5+ people asked in the Lecture.

    Neither a name nor a user id leaves this function. Under the floor the answer is an empty list.
    """
    return [
        {"slide_title": (r.get("event_data") or {}).get("slideTitle", "Unknown Slide"),
         "query_text": r["event_data"]["query"].strip(), "created_at": r.get("created_at", "")}
        for r in legacy_questions(rows, owner_id) or []
    ]


@cached_analytic("overview")
def get_lecture_overview(lecture_id: str, token: str = None) -> Dict[str, Any]:
    """High-level metrics for a lecture (cached). Counts people, never the owner; any figure fewer
    than MIN_PEOPLE people stand behind is None, never 0."""
    client = get_auth_client(token)
    owner_id = lecture_owner_id(client, lecture_id)

    progress_data = [p for p in _fetch_all(client.table("student_progress")\
        .select("user_id, completed_at, quiz_score, total_questions_answered")\
        .eq("lecture_id", lecture_id)) if p.get("user_id") and not _same_person(p["user_id"], owner_id)]

    people = {str(p["user_id"]) for p in progress_data}
    if len(people) < MIN_PEOPLE:
        return {
            "total_students": None,
            "completion_rate": None,
            "average_score": None,
            "average_time_minutes": None,
            "engagement_level": "No Data"
        }

    completed = {str(p["user_id"]) for p in progress_data if p.get("completed_at")}
    completion_rate = len(completed) / len(people) * 100

    # Average time per person (a person finishing twice counts once), from lecture_complete events
    events_data = _fetch_all(client.table("learning_events")\
        .select("user_id, event_data")\
        .eq("event_type", "lecture_complete")\
        .eq("event_data->>lectureId", str(lecture_id)))

    durations: Dict[str, List[float]] = {}
    for event in events_data:
        uid = event.get("user_id")
        ed = event.get("event_data")
        if not uid or _same_person(uid, owner_id) or not isinstance(ed, dict):
            continue
        durations.setdefault(str(uid), []).append(ed.get("total_duration_seconds", 0) or 0)

    if len(durations) >= MIN_PEOPLE:
        avg_time_minutes: Optional[float] = round(
            sum(sum(d) / len(d) for d in durations.values()) / len(durations) / 60, 1)
        engagement = "High" if avg_time_minutes > 20 else "Medium" if avg_time_minutes > 8 else "Low"
    else:
        avg_time_minutes, engagement = None, "No Data"

    quiz_takers = {str(p["user_id"]): p.get("quiz_score") or 0
                   for p in progress_data if (p.get("total_questions_answered") or 0) > 0}
    avg_score = round(sum(quiz_takers.values()) / len(quiz_takers), 1) if len(quiz_takers) >= MIN_PEOPLE else None

    return {
        "total_students": len(people),
        "completion_rate": round(completion_rate, 1),
        "average_score": avg_score,
        "average_time_minutes": avg_time_minutes,
        "engagement_level": engagement
    }


def _viewers_by_slide(client: Client, lecture_id: str, owner_id: Optional[str]) -> tuple:
    """(people who viewed each slide, each person's total time on each slide), the owner left out.

    The second is {slide_id: {user_id: seconds summed over that person's views}}: one person
    opening a slide ten times is one person with one total, never ten durations.
    """
    view_events = _fetch_all(client.table("learning_events")\
        .select("user_id, event_data")\
        .eq("event_type", "slide_view")\
        .eq("event_data->>lectureId", str(lecture_id)))
    viewers: Dict[str, set] = {}
    durations: Dict[str, Dict[str, float]] = {}
    for ev in view_events:
        uid = ev.get("user_id")
        ed = ev.get("event_data") or {}
        sid = ed.get("slideId")
        if not uid or _same_person(uid, owner_id) or not sid:
            continue
        viewers.setdefault(sid, set()).add(uid)
        per_person = durations.setdefault(sid, {})
        per_person[str(uid)] = per_person.get(str(uid), 0.0) + float(ed.get("duration_seconds") or 0)
    return viewers, durations


@cached_analytic("slide_viewers")
def get_slide_viewer_counts(lecture_id: str, token: str = None) -> Dict[str, int]:
    """How many people viewed each slide (the owner left out), floor not applied.

    Only the insight bundle reads this, for the slide-to-slide comparison in its drop-off
    finding; it is never sent to a client as a per-slide figure.
    """
    client = get_auth_client(token)
    viewers, _ = _viewers_by_slide(client, lecture_id, lecture_owner_id(client, lecture_id))
    return {sid: len(people) for sid, people in viewers.items()}


@cached_analytic("lecture_people")
def get_lecture_people_count(lecture_id: str, token: str = None) -> int:
    """How many people opened the lecture (the owner left out), floor not applied.

    Only the insight bundle reads this, for the reach of its findings; it is never sent to a client.
    """
    client = get_auth_client(token)
    owner_id = lecture_owner_id(client, lecture_id)
    rows = _fetch_all(client.table("student_progress").select("user_id").eq("lecture_id", lecture_id))
    return len({str(r["user_id"]) for r in rows if r.get("user_id") and not _same_person(r["user_id"], owner_id)})


@cached_analytic("slides")
def get_slide_analytics(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    """Per-slide analytics (cached). Counts people, never the owner; a slide fewer than
    MIN_PEOPLE people viewed, tried or rated says nothing (null, never 0)."""
    from backend.services.recommendations import compute_slide_recommendation

    client = get_auth_client(token)
    owner_id = lecture_owner_id(client, lecture_id)

    slides_data = _fetch_all(client.table("slides")\
        .select("id, slide_number, title")\
        .eq("lecture_id", lecture_id)\
        .order("slide_number"))

    # Need total_students for drop-off calculation (people, not the owner)
    progress_data = _fetch_all(client.table("student_progress")\
        .select("user_id")\
        .eq("lecture_id", lecture_id))
    total_students = len({r.get("user_id") for r in progress_data if r.get("user_id") != owner_id})

    # Slide views (camelCase 'slideId' in event_data), over people
    viewers, durations = _viewers_by_slide(client, lecture_id, owner_id)

    # Confidence check-ins, over people: a slide under MIN_PEOPLE raters has no entry
    conf_by_slide = _confidence_counts_by_slide(client, lecture_id, owner_id, owner_known=True)

    # Quiz attempts joined with their slide via quiz_questions
    quiz_questions = _fetch_all(client.table("quiz_questions")\
        .select("id, slide_id, slides!inner(lecture_id)")\
        .eq("slides.lecture_id", lecture_id))
    qid_to_slide = {q["id"]: q["slide_id"] for q in quiz_questions}

    quiz_events = _fetch_all(client.table("learning_events")\
        .select("user_id, event_data, created_at")\
        .eq("event_type", "quiz_attempt")\
        .eq("event_data->>lectureId", str(lecture_id))\
        .order("created_at"))

    # Per slide, each person's first try on each of its questions: {slide_id: {user_id: [correct]}}.
    # A retry never counts, and one person is one person however often they tried (as /quizzes).
    quiz_by_slide: Dict[str, Dict[str, List[bool]]] = {}
    for qid, by_person in people_first_tries(quiz_events or [], owner_id).items():
        sid = qid_to_slide.get(qid)
        if not sid:
            continue
        for uid, ed in by_person.items():
            quiz_by_slide.setdefault(sid, {}).setdefault(uid, []).append(bool(ed.get("correct")))

    slide_analytics = []
    for slide in slides_data:
        sid = slide["id"]

        # Views: too few people is null, never 0 (and the figures derived from them go with it).
        n_viewers = len(viewers.get(sid, ()))
        seen = n_viewers >= MIN_PEOPLE
        view_count = n_viewers if seen else None
        # Each viewer's own total time on the slide, then the mean over viewers.
        avg_time = round(sum(durations[sid].values()) / len(durations[sid]), 1) if seen else None
        drop_off = max(0.0, 100 * (1 - (n_viewers / total_students))) if seen and total_students > 0 else (0.0 if seen else None)

        cb = conf_by_slide.get(sid)
        confusion_rate = round(cb["confused"] / sum(cb.values()) * 100, 1) if cb else None

        # quiz_attempts is the people who tried; the success rate is each one's own share of
        # first tries right, averaged over them (one person on ten questions outweighs no one).
        qb = quiz_by_slide.get(sid) or {}
        tried = len(qb) >= MIN_PEOPLE
        quiz_attempts = len(qb) if tried else None
        quiz_success_rate = (
            round(sum(sum(v) / len(v) for v in qb.values()) / len(qb) * 100, 1) if tried else None)

        if seen:
            label, reasons = compute_slide_recommendation(
                drop_off_rate=drop_off,
                confusion_rate=confusion_rate or 0.0,
                quiz_success_rate=quiz_success_rate,
                view_count=view_count,
                quiz_attempts=quiz_attempts or 0,
            )
        else:
            # Nothing is said about a slide too few people viewed; the existing neutral label says so.
            label, reasons = "insufficient_data", ["low_view_count"]

        slide_analytics.append({
            "slide_id": sid,
            "slide_number": slide["slide_number"],
            "title": slide.get("title", f"Slide {slide['slide_number']}"),
            "view_count": view_count,
            "average_time_seconds": avg_time,
            "drop_off_rate": round(drop_off, 1) if drop_off is not None else None,
            "confusion_rate": confusion_rate,
            "quiz_attempts": quiz_attempts,
            "quiz_success_rate": quiz_success_rate,
            "recommendation_label": label,
            "recommendation_reasons": reasons,
        })

    return slide_analytics


@cached_analytic("quizzes")
def get_quiz_analytics(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    """Quiz difficulty per question (cached). Counts people (each one's first try), never the
    owner; a question fewer than MIN_PEOPLE people tried says nothing (null, never 0)."""
    client = get_auth_client(token)
    owner_id = lecture_owner_id(client, lecture_id)

    quiz_data = _fetch_all(client.table("quiz_questions")\
        .select("id, question_text, slides!inner(lecture_id)")\
        .eq("slides.lecture_id", lecture_id))

    events_data = _fetch_all(client.table("learning_events")\
        .select("user_id, event_data, created_at")\
        .eq("event_type", "quiz_attempt")\
        .eq("event_data->>lectureId", str(lecture_id))\
        .order("created_at"))

    tries = people_first_tries(events_data or [], owner_id)
    quiz_analytics = []

    for question in quiz_data:
        people = tries.get(question["id"], {})
        if len(people) < MIN_PEOPLE:
            quiz_analytics.append({
                "question_id": question["id"],
                "question_text": question["question_text"],
                "success_rate": None,
                "difficulty": None,
                "attempts": None,
            })
            continue

        success_rate = sum(1 for ed in people.values() if ed.get("correct")) / len(people) * 100
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
            "attempts": len(people)
        })

    return sorted(quiz_analytics, key=lambda x: (x["success_rate"] is None, x["success_rate"] or 0))


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
        .eq("event_data->>lectureId", str(lecture_id)))

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
    """Which wrong answer options people pick most per question (cached). Counts people (each
    one's first try), never the owner; under MIN_PEOPLE people the shares are withheld."""
    client = get_auth_client(token)
    owner_id = lecture_owner_id(client, lecture_id)

    quiz_data = _fetch_all(client.table("quiz_questions")\
        .select("id, question_text, options, correct_answer, slides!inner(lecture_id)")\
        .eq("slides.lecture_id", lecture_id))

    events_data = _fetch_all(client.table("learning_events")\
        .select("user_id, event_data, created_at")\
        .eq("event_type", "quiz_attempt")\
        .eq("event_data->>lectureId", str(lecture_id))\
        .order("created_at"))

    tries = people_first_tries(events_data or [], owner_id)
    result = []

    for question in quiz_data:
        people = tries.get(question["id"], {})
        base = {
            "question_id": question["id"],
            "question_text": question["question_text"],
            "options": question.get("options", []),
            "correct_answer": question.get("correct_answer"),
        }
        if len(people) < MIN_PEOPLE:
            result.append({**base, "answer_distribution": {}, "most_common_wrong_answer": None,
                           "all_common_wrong_answers": [], "total_attempts": None})
            continue

        answer_distribution: Dict[str, int] = {}
        for attempt in people.values():
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
            **base,
            "answer_distribution": answer_distribution,
            "most_common_wrong_answer": most_common_wrongs[0] if most_common_wrongs else None,
            "all_common_wrong_answers": most_common_wrongs,
            "total_attempts": len(people)
        })

    return result


def _calculate_retry_performance(
    questions: List[Dict[str, Any]],
    first_attempt_events: List[Dict[str, Any]],
    retry_attempt_events: List[Dict[str, Any]],
    owner_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Pure aggregator: rank questions by first- and second-attempt miss rate, over people.

    questions: [{id, question_text}]
    first_attempt_events / retry_attempt_events: [{user_id, event_data: {questionId, correct}}],
    oldest first. Each person counts once per side (their first try, their first retry), the
    owner never counts, and a side fewer than MIN_PEOPLE people stand behind is None, never 0.

    Returns rows sorted by first_attempt_miss_rate desc; questions with no first-attempt
    figure go to the end.
    """
    first_by_q = people_first_tries(first_attempt_events, owner_id)
    retry_by_q = people_first_tries(retry_attempt_events, owner_id)

    def side(people: Dict[str, Dict[str, Any]]) -> tuple:
        if len(people) < MIN_PEOPLE:
            return None, None, None
        misses = sum(1 for ed in people.values() if not ed.get("correct"))
        return len(people), misses, round(misses / len(people) * 100, 1)

    rows = []
    for q in questions:
        qid = q["id"]
        first_total, first_misses, first_rate = side(first_by_q.get(qid, {}))
        retry_total, retry_misses, retry_rate = side(retry_by_q.get(qid, {}))
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
        0 if r["first_attempt_total"] is not None else 1,
        -(r["first_attempt_miss_rate"] or 0),
        -(r["retry_miss_rate"] or 0),
        r["question_id"],
    ))
    return rows


@cached_analytic("retry_performance")
def get_retry_performance(lecture_id: str, token: str = None) -> List[Dict[str, Any]]:
    """Per-question first-attempt vs second-attempt miss rates for a lecture (cached)."""
    client = get_auth_client(token)
    owner_id = lecture_owner_id(client, lecture_id)

    quiz_data = _fetch_all(client.table("quiz_questions")
        .select("id, question_text, slides!inner(lecture_id)")
        .eq("slides.lecture_id", lecture_id))

    first_events = _fetch_all(client.table("learning_events")
        .select("user_id, event_data, created_at")
        .eq("event_type", "quiz_attempt")
        .eq("event_data->>lectureId", str(lecture_id))
        .order("created_at"))

    retry_events = _fetch_all(client.table("learning_events")
        .select("user_id, event_data, created_at")
        .eq("event_type", "quiz_retry_attempt")
        .eq("event_data->>lectureId", str(lecture_id))
        .order("created_at"))

    return _calculate_retry_performance(quiz_data, first_events, retry_events, owner_id)


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

    slide_conf = _confidence_counts_by_slide(client, lecture_id)

    slides_data = _fetch_all(client.table("slides")\
        .select("id, slide_number, title")\
        .eq("lecture_id", lecture_id)\
        .order("slide_number"))

    slide_id_map = {s["id"]: s for s in slides_data}

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
    """The latest legacy AI tutor questions for this lecture (cached); empty under 5 askers."""
    client = get_auth_client(token)
    owner_id = lecture_owner_id(client, lecture_id)

    events_data = _fetch_all(client.table("learning_events")\
        .select("user_id, event_data, created_at")\
        .eq("event_type", "ai_tutor_query")\
        .contains("event_data", {"lectureId": lecture_id})\
        .order("created_at", desc=True))

    return legacy_question_feed(events_data, owner_id)


@cached_analytic("insights")
def get_lecture_insights(lecture_id: str, token: str = None) -> Dict[str, Any]:
    """Ranked insight feed powering the Insight Garden (cached)."""
    # Lazy import: the insights package imports this module, so importing it at
    # module top would be circular.
    from backend.services.insights import build_insights

    insights = build_insights(lecture_id, token)
    return {
        "lectureId": lecture_id,
        "computedAt": datetime.now(timezone.utc).isoformat() + "Z",
        "insights": insights,
    }


#: The event kinds the dashboard's "this week" counts speak about.
_TICKER_KINDS = ("quiz_attempt", "slide_back_navigation", "ai_tutor_query")


def _event_dict(raw: Any) -> Dict[str, Any]:
    """asyncpg hands jsonb back as text."""
    return json.loads(raw) if isinstance(raw, str) else (raw or {})


def _slide_performance(slide_rows: list, events: List[Dict[str, Any]], owner_id: Optional[str]) -> List[Dict[str, Any]]:
    """The dashboard's per-slide figures, over people and never the owner.

    A figure appears only when MIN_PEOPLE people stand behind it (None otherwise, never 0):
    time and the confusion index need 5 viewers of the slide, the quiz figures 5 people who
    tried it, the tutor and go-back counts 5 people who did it. `events` run oldest first.
    """
    viewers: Dict[str, set] = {}
    durations: Dict[str, List[float]] = {}
    tries: Dict[str, Dict[tuple, bool]] = {}
    askers: Dict[str, set] = {}
    revisers: Dict[str, set] = {}
    for ev in events:
        uid = ev.get("user_id")
        if not uid or _same_person(uid, owner_id):
            continue
        uid = str(uid)
        ed = ev["event_data"]
        kind = ev["type"]
        for sid in {ed.get("slideId"), ed.get("fromSlideId")} - {None}:
            if kind == "slide_view":
                viewers.setdefault(sid, set()).add(uid)
                durations.setdefault(sid, []).append(ed.get("duration_seconds") or 0)
            elif kind == "quiz_attempt":
                tries.setdefault(sid, {}).setdefault((uid, ed.get("questionId")), bool(ed.get("correct")))
            elif kind == "ai_tutor_query":
                askers.setdefault(sid, set()).add(uid)
            elif kind == "slide_back_navigation":
                revisers.setdefault(sid, set()).add(uid)

    def floored(n: int) -> Optional[int]:
        return n if n >= MIN_PEOPLE else None

    perf = []
    for r in slide_rows:
        sid = r["id"]
        n_viewers = len(viewers.get(sid, ()))
        seen = n_viewers >= MIN_PEOPLE
        slide_tries = tries.get(sid, {})
        answerers = {u for u, _ in slide_tries}
        tried = len(answerers) >= MIN_PEOPLE
        asked, went_back = len(askers.get(sid, ())), len(revisers.get(sid, ()))
        missed = {u for (u, _), ok in slide_tries.items() if not ok}

        # The index is built only from shares of people, each over its own 5-people floor, so no
        # count under the floor can be read back out of it. It is None when no component passes.
        parts = []
        if seen and asked >= MIN_PEOPLE:
            parts.append(min(1.0, asked / n_viewers))
        if seen and went_back >= MIN_PEOPLE:
            parts.append(min(1.0, went_back / n_viewers))
        if seen and tried:
            parts.append(len(missed) / len(answerers))

        perf.append({
            "id": sid,
            "name": r["name"],
            "avgDuration": round(sum(durations[sid]) / len(durations[sid])) if seen else None,
            "correctRate": round(sum(slide_tries.values()) / len(slide_tries) * 100) if tried else None,
            "quizAttempts": len(answerers) if tried else None,
            "aiQueries": floored(asked),
            "revisions": floored(went_back),
            "confusionIndex": min(100, max(10, round(sum(parts) * 100))) if parts else None,
        })
    return sorted(perf, key=lambda x: (x["avgDuration"] is None, -(x["avgDuration"] or 0)))


@cached_analytic_async("dashboard")
async def get_dashboard_data(lecture_id: str, token: str = None):
    """Advanced dashboard analytics in a single call.

    asyncpg bypasses RLS, so the privacy rules are applied here: people (never events or tries)
    are counted, the lecture's owner never counts, and any figure fewer than MIN_PEOPLE people
    stand behind is None or absent, never 0.
    """
    try:
        async with await get_db_connection() as conn:
            owner_id = await conn.fetchval("SELECT professor_id FROM lectures WHERE id = $1::uuid", lecture_id)

            # One row per person who opened the lecture
            progress_rows = await conn.fetch("""
                SELECT p.user_id, p.quiz_score, p.total_questions_answered, p.correct_answers
                FROM student_progress p
                WHERE p.lecture_id = $1::uuid
            """, lecture_id)

            slide_rows = await conn.fetch("""
                SELECT s.id::text AS "id", s.title AS "name"
                FROM slides s
                WHERE s.lecture_id = $1::uuid
                ORDER BY s.slide_number
            """, lecture_id)

            # Everything the per-slide figures, the retry table, the week counts and the question
            # feed are made of, oldest first (a person's first try is the one that counts).
            event_rows = await conn.fetch("""
                SELECT le.user_id, le.event_type AS "type", le.event_data,
                       le.created_at::text AS "time",
                       le.created_at::date::text AS "day",
                       (le.created_at >= now() - interval '7 days') AS "recent"
                FROM learning_events le
                WHERE le.event_data->>'lectureId' = $1
                    AND le.event_type IN ('slide_view', 'quiz_attempt', 'quiz_retry_attempt',
                                          'ai_tutor_query', 'slide_back_navigation')
                ORDER BY le.created_at ASC
            """, lecture_id)

            # Confidence Map: read as events, counted as people in Python.
            conf_rows = await conn.fetch("""
                SELECT le.user_id, le.event_data
                FROM learning_events le
                WHERE le.event_type = 'confidence_rating' AND le.event_data->>'lectureId' = $1
                ORDER BY le.created_at ASC
            """, lecture_id)

            question_rows = await conn.fetch("""
                SELECT q.id::text AS "id", q.question_text AS "question_text"
                FROM quiz_questions q
                JOIN slides s ON s.id = q.slide_id
                WHERE s.lecture_id = $1::uuid
            """, lecture_id)

    except Exception as e:
        logger.error("Database analytics failure: %s", e)
        # Fallback to sync supabase if pool fails (optional, but safer to just raise)
        raise

    owner_key = str(owner_id) if owner_id else None

    # Overview, over people. Opening the lecture makes a person; answering makes a scorer.
    people = {str(r["user_id"]): r for r in progress_rows
              if r["user_id"] and str(r["user_id"]) != owner_key}
    scorers = [r for r in people.values() if (r["total_questions_answered"] or 0) > 0]
    overview: Dict[str, Any] = {
        "uniqueStudents": len(people) if len(people) >= MIN_PEOPLE else None,
        "totalAttempts": None, "averageScore": None,
    }
    if len(scorers) >= MIN_PEOPLE:
        # People who answered at least once, never a count of answers.
        overview["totalAttempts"] = len(scorers)
        overview["averageScore"] = round(sum(
            (r["correct_answers"] or 0) / r["total_questions_answered"] * 100 for r in scorers) / len(scorers))
    score_band_counts = score_bands([r["quiz_score"] for r in scorers])

    events = [{"user_id": str(r["user_id"]) if r["user_id"] else None, "type": r["type"],
               "event_data": _event_dict(r["event_data"]), "time": r["time"],
               "day": r["day"], "recent": r["recent"]} for r in event_rows]
    others = [e for e in events if e["user_id"] and e["user_id"] != owner_key]

    conf_events = []
    for r in conf_rows:
        conf_events.append({"user_id": str(r["user_id"]) if r["user_id"] else None,
                            "event_data": _event_dict(r["event_data"])})
    # None, not zeros, when no slide reaches the floor: "not enough people" is not "nobody understood".
    conf_counts: Optional[Dict[str, int]] = None
    for counts in _floored_counts(conf_events, owner_key).values():
        conf_counts = conf_counts or {k: 0 for k in _RATINGS}
        for k in _RATINGS:
            conf_counts[k] += counts[k]

    conf_others = [e for e in conf_events if e["user_id"] and e["user_id"] != owner_key]
    active = {e["user_id"] for e in others} | {e["user_id"] for e in conf_others}
    # People who did anything at all (the key keeps its old name; it is a count of people, never events).
    overview["totalEvents"] = len(active) if len(active) >= MIN_PEOPLE else None

    # People who answered a quiz question on each day this week; a day under 5 people is None.
    today = datetime.now(timezone.utc).date()
    days = [today - timedelta(days=6 - i) for i in range(7)]
    activity_by_day = []
    for d in days:
        n = len({e["user_id"] for e in others if e["type"] == "quiz_attempt" and e["day"] == d.isoformat()})
        activity_by_day.append({"date": d.strftime("%a"), "people": n if n >= MIN_PEOPLE else None})

    # The week in counts of people per kind, never one person's event, and only from 5 people.
    live_ticker = []
    for kind in _TICKER_KINDS:
        n = len({e["user_id"] for e in others if e["recent"] and e["type"] == kind})
        if n >= MIN_PEOPLE:
            live_ticker.append({"type": kind, "people": n})

    ai_query_feed = legacy_question_feed(
        [{"user_id": e["user_id"], "event_data": e["event_data"], "created_at": e["time"]}
         for e in reversed(events) if e["type"] == "ai_tutor_query"],
        owner_key)

    retry_performance = _calculate_retry_performance(
        [{"id": r["id"], "question_text": r["question_text"]} for r in question_rows],
        [e for e in events if e["type"] == "quiz_attempt"],
        [e for e in events if e["type"] == "quiz_retry_attempt"],
        owner_key)

    return {
        "overview": overview,
        "activityByDay": activity_by_day,
        "slidePerformance": _slide_performance([dict(r) for r in slide_rows], events, owner_key),
        "scoreBands": score_band_counts,
        "confidenceMap": conf_counts,
        "liveTicker": live_ticker,
        "aiQueryFeed": ai_query_feed[:50],
        "retryPerformance": retry_performance,
        "dropoffData": [],  # Can be added if needed, but keeping it light for now
        "confidenceBySlide": []  # Can be added similarly
    }


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

    # 3. Recent learning events (last `days` days).
    #
    # P5-2 (Foundation 10x roadmap §13, OLTP/OLAP split — staged lift (a)):
    # active_students / median_time_minutes / activity_sparkline no longer
    # scan every learning_events row for the course; they read
    # `mv_course_daily_activity` (supabase/migrations/
    # 20260720000001_professor_overview_daily_activity_mv.sql), a per
    # (course_id, day) rollup refreshed on a schedule by an Arq cron job
    # (backend/workers/arq_worker.py, every 10 minutes — see that file for
    # the bounded-staleness rationale). weakest_concepts/weakest_slides still
    # need item-level slide_id/question_id granularity the rollup doesn't
    # carry, so they read a narrower *live* quiz_attempt-only query below
    # (previously this fetched ALL event types for the window and filtered
    # to quiz_attempt in Python; querying only quiz_attempt rows cuts the
    # payload without changing the result).
    from datetime import timezone
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    def _row_to_dict(r):
        d = dict(r)
        ed = d.get("event_data")
        if isinstance(ed, str):
            try:
                d["event_data"] = json.loads(ed)
            except Exception:
                d["event_data"] = {}
        return d

    use_mv = client.__class__.__name__ != "FakeSupabaseClient"

    if not use_mv:
        # Unit-test path (FakeSupabaseClient simulates PostgREST, not a real
        # Postgres connection the MV could live in): compute everything from
        # the raw event set exactly as before the P5-2 change.
        course_events = []
        for lid in lecture_ids:
            events_data = await asyncio.to_thread(
                _fetch_all,
                client.table("learning_events")
                .select("user_id, event_type, event_data, created_at")
                .eq("event_data->>lectureId", str(lid))
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

        active_students = len({
            e["user_id"] for e in course_events if e.get("user_id")
        })

        durations: List[float] = []
        for e in course_events:
            if e.get("event_type") != "lecture_complete":
                continue
            d = (e.get("event_data") or {}).get("total_duration_seconds")
            if isinstance(d, (int, float)) and d > 0:
                durations.append(d / 60.0)
        median_time = _median(durations)

        # quiz_attempt subset for step 7 below.
        quiz_attempt_events = [
            e for e in course_events if e.get("event_type") == "quiz_attempt"
        ]
        by_day_events = course_events
    else:
        today = datetime.now(timezone.utc).date()
        window_start = today - timedelta(days=days - 1)
        async with await get_db_connection() as conn:
            mv_rows = await conn.fetch("""
                SELECT activity_day, tracked_event_count, active_user_ids,
                       lecture_complete_durations_seconds
                FROM mv_course_daily_activity
                WHERE course_id = $1::uuid
                  AND activity_day BETWEEN $2::date AND $3::date
                ORDER BY activity_day
            """, course_id, window_start, today)

            quiz_rows = await conn.fetch("""
                SELECT event_data, created_at
                FROM learning_events
                WHERE event_type = 'quiz_attempt'
                  AND created_at >= $1::timestamptz
                  AND (event_data->>'lectureId') = ANY($2::text[])
            """, cutoff, lecture_ids)
        quiz_attempt_events = [_row_to_dict(r) for r in quiz_rows]

        active_user_set: set = set()
        durations: List[float] = []
        tracked_by_day: Dict[date, int] = {}
        for r in mv_rows:
            day = r["activity_day"]
            tracked_by_day[day] = int(r["tracked_event_count"] or 0)
            for uid in (r["active_user_ids"] or []):
                if uid:
                    active_user_set.add(uid)
            for secs in (r["lecture_complete_durations_seconds"] or []):
                if secs and secs > 0:
                    durations.append(float(secs) / 60.0)

        active_students = len(active_user_set)
        median_time = _median(durations)
        by_day_events = None  # sparkline built directly from tracked_by_day below

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
    for e in quiz_attempt_events:
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
    if use_mv:
        # tracked_by_day is already the exact per-day count of the same
        # five event types the branch below filters for (see the
        # `tracked_event_count` FILTER clause in the migration).
        by_day: Dict[str, int] = {d.isoformat(): c for d, c in tracked_by_day.items()}
    else:
        by_day = defaultdict(int)
        for e in by_day_events:
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
    today = datetime.now(timezone.utc).date()
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
    today = datetime.now(timezone.utc).date()
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

    # A lecture fewer than MIN_PEOPLE people opened says nothing: every metric is None (never 0),
    # and it is left out of the peer summary.
    if overview.get("total_students") is None:
        return {k: None for k in _BENCHMARK_METRIC_KEYS}

    # Engagement
    avg_time = overview.get("average_time_minutes")
    completion = float(overview.get("completion_rate") or 0)
    students = int(overview.get("total_students") or 0)
    # Lecture-level drop-off mirrors what the dashboard shows: students who
    # started but didn't finish (= 100% − completion rate). Per-slide
    # percentages from get_dropoff_map are NOT additive and can't be averaged
    # into a meaningful lecture-level number, so we don't use them here.
    drop_off = round(max(0.0, 100.0 - completion), 1)

    # Quiz performance (a question under the floor has a null rate and does not count)
    avg_score = overview.get("average_score")
    answered = [q for q in quizzes if q.get("success_rate") is not None]
    mastery = (
        round(sum(1 for q in answered if q["success_rate"] >= 80)
              / len(answered) * 100, 1)
        if answered else None
    )
    struggle = (
        round(sum(1 for q in answered if q["success_rate"] < 60)
              / len(answered) * 100, 1)
        if answered else None
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
        round(confused_qs / relevant_qs * 100, 1) if relevant_qs else None
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
        "avg_time_minutes": round(float(avg_time), 1) if avg_time is not None else None,
        "completion_rate": round(completion, 1),
        "unique_students": students,
        "drop_off_rate": drop_off,
        "avg_score": round(float(avg_score), 1) if avg_score is not None else None,
        "mastery_rate": mastery,
        "struggle_rate": struggle,
        "distractor_confusion": distractor_confusion,
        "concept_count": concept_count,
        "needs_review_share": needs_review_share,
    }


def _summarize_metric_pack(packs: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """avg/min/max/count for each benchmark metric across a peer set.

    A withheld metric (None) is left out; with nothing left the figures are None, never 0.
    """
    summary: Dict[str, Dict[str, Any]] = {}
    for k in _BENCHMARK_METRIC_KEYS:
        vals = [float(p[k]) for p in packs if p.get(k) is not None]
        if not vals:
            summary[k] = {"avg": None, "min": None, "max": None, "count": 0}
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

    Lectures that were withheld (None) are left out of each average; a course with nothing
    left to average gets None, never 0.
    """
    out: Dict[str, Any] = {}
    for k in _BENCHMARK_METRIC_KEYS:
        vals = [float(p[k]) for p in lecture_packs if p.get(k) is not None]
        out[k] = round(sum(vals) / len(vals), 1) if vals else None
    # unique_students is more meaningful as a sum across the course
    students = [int(p["unique_students"]) for p in lecture_packs if p.get("unique_students") is not None]
    out["unique_students"] = sum(students) if students else None
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
            metrics = {k: None for k in _BENCHMARK_METRIC_KEYS}
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
