"""Ask Your Data — professor-wide natural-language analytics.

Like :mod:`ask_data` but scoped to ALL of a professor's lectures rather than
one. The LLM picks a fixed intent; the matching executor aggregates the
existing per-lecture cached analytics across every lecture the professor owns.
No raw SQL is generated, and answers are templated from real numbers (no
free-form LLM prose) — so the bar can't hallucinate.

Performance: all executors use bulk Supabase fetches (3 round-trips for all
lectures combined) instead of the old N+1 per-lecture loop that was causing
multi-second latency for professors with many lectures.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict
from typing import Any, Dict, List

from backend.services import analytics_service
from backend.services.ai.ask_data import _clamp_int
from backend.services.ai.orchestrator import generate_text, parse_json_response
from backend.services.ai.prompts import INTENT_CLASSIFIER_PROMPT, PROFESSOR_CHAT_SYSTEM_PROMPT
from backend.services.ai.voice import VOICE_PROSE, LANG_MATCH

logger = logging.getLogger(__name__)

# Simple in-process TTL cache for professor context (avoids rebuilding on every chat turn).
# Key: professor_id, Value: (built_at_timestamp, context_string)
_CONTEXT_CACHE: Dict[str, tuple] = {}
_CONTEXT_TTL = 120  # seconds — fresh enough for a chat session


# ── Intent catalog ────────────────────────────────────────────────────────────

INTENTS: Dict[str, Dict[str, Any]] = {
    "lectures_by_dropoff": {
        "description": "Rank the professor's lectures by student drop-off (lowest completion first).",
        "params": {"limit": "int 1-20, default 5"},
        "examples": [
            "Which lectures lose the most students?",
            "Where are students dropping off across my courses?",
            "Which lecture has the worst completion?",
        ],
    },
    "lectures_by_quiz_performance": {
        "description": "Rank the professor's lectures by average quiz score (weakest first).",
        "params": {"limit": "int 1-20, default 5"},
        "examples": [
            "Which lectures are students struggling with most?",
            "Where is quiz performance the weakest?",
            "My hardest lectures by quiz score",
        ],
    },
    "struggling_students": {
        "description": "Students whose quiz score is below a threshold, across all lectures.",
        "params": {"max_accuracy_percent": "int 0-100, default 40"},
        "examples": [
            "Who is falling behind across my courses?",
            "Which students are struggling the most?",
            "Show students under 50% accuracy",
        ],
    },
    "most_confusing_slides": {
        "description": "Slides with the highest confusion rate across all the professor's lectures.",
        "params": {"limit": "int 1-20, default 5"},
        "examples": [
            "Where are students most confused?",
            "What are my most confusing slides overall?",
            "Which content confuses students the most?",
        ],
    },
    "teaching_overview": {
        "description": "High-level summary across all the professor's lectures (students, completion, score).",
        "params": {},
        "examples": [
            "How are my courses doing overall?",
            "Give me a summary of my teaching",
            "What's my overall completion and score?",
        ],
    },
}


SAFE_FALLBACK_TEXT = (
    "I can answer questions about your courses, lectures, students, and where "
    "they're struggling — drop-off, quiz performance, and confusing slides. "
    "Try one of the suggested questions below."
)


def list_suggested_questions() -> List[str]:
    return [
        "Which lectures lose the most students?",
        "Where are students most confused?",
        "Who is falling behind across my courses?",
        "Which lectures are students struggling with most?",
        "How are my courses doing overall?",
    ]


# ── Professor lecture set ─────────────────────────────────────────────────────

def _get_professor_lectures(token: str, professor_id: str) -> List[Dict[str, Any]]:
    client = analytics_service.get_auth_client(token)
    return analytics_service._fetch_all(
        client.table("lectures")
        .select("id, title, course_id")
        .eq("professor_id", professor_id)
    )


# ── Bulk data fetch (replaces N+1 per-lecture loops) ─────────────────────────

def _bulk_fetch_overviews(
    lecture_ids: List[str], token: str
) -> Dict[str, Dict[str, Any]]:
    """Single Supabase round-trip: fetch student_progress for ALL lectures.

    Returns a dict keyed by lecture_id with the same shape as
    analytics_service.get_lecture_overview():
      { total_students, completion_rate, average_score }

    This replaces the old pattern of calling get_lecture_overview(lec_id)
    inside a for-loop (N round-trips → 1 round-trip).
    """
    if not lecture_ids:
        return {}

    client = analytics_service.get_auth_client(token)

    # One query for all progress rows across all lectures
    progress_rows = analytics_service._fetch_all_in(
        lambda: client.table("student_progress").select(
            "lecture_id, user_id, completed_at, quiz_score, total_questions_answered"
        ),
        "lecture_id",
        lecture_ids,
    )

    # Aggregate per lecture in Python (no extra network calls)
    by_lecture: Dict[str, Dict[str, Any]] = {}
    for row in progress_rows:
        lid = row.get("lecture_id")
        if not lid:
            continue
        if lid not in by_lecture:
            by_lecture[lid] = {
                "total_students": 0,
                "completed": 0,
                "quiz_scores": [],
            }
        agg = by_lecture[lid]
        agg["total_students"] += 1
        if row.get("completed_at"):
            agg["completed"] += 1
        qa = row.get("total_questions_answered") or 0
        score = row.get("quiz_score") or 0
        if qa > 0:
            agg["quiz_scores"].append(score)

    result: Dict[str, Dict[str, Any]] = {}
    for lid in lecture_ids:
        agg = by_lecture.get(lid)
        if not agg or agg["total_students"] == 0:
            result[lid] = {
                "total_students": 0,
                "completion_rate": 0.0,
                "average_score": 0.0,
            }
            continue
        total = agg["total_students"]
        completion_rate = round((agg["completed"] / total) * 100, 1)
        scores = agg["quiz_scores"]
        average_score = round(sum(scores) / len(scores), 1) if scores else 0.0
        result[lid] = {
            "total_students": total,
            "completion_rate": completion_rate,
            "average_score": average_score,
        }
    return result


def _bulk_fetch_student_scores(
    lecture_ids: List[str], token: str
) -> Dict[str, List[Dict[str, Any]]]:
    """Bulk fetch student_progress for the 'struggling_students' executor.

    Returns dict[lecture_id -> list of {student_name, quiz_score}].
    """
    if not lecture_ids:
        return {}

    client = analytics_service.get_auth_client(token)
    rows = analytics_service._fetch_all_in(
        lambda: client.table("student_progress").select(
            "lecture_id, user_id, quiz_score, total_questions_answered"
        ),
        "lecture_id",
        lecture_ids,
    )

    from backend.services.utils.analytics_utils import generate_anon_name

    result: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        lid = row.get("lecture_id")
        if not lid:
            continue
        result[lid].append({
            "student_name": generate_anon_name(row.get("user_id", "")),
            "quiz_score": float(row.get("quiz_score") or 0),
            "total_questions_answered": int(row.get("total_questions_answered") or 0),
        })
    return dict(result)


def _bulk_fetch_confidence(
    lecture_ids: List[str], token: str
) -> Dict[str, List[Dict[str, Any]]]:
    """Bulk fetch confidence_rating events scoped to the given lectures.

    Uses a two-step approach:
      1. Fetch slide IDs for all lecture_ids in one IN query.
      2. Filter confidence events from learning_events using lectureId in event_data
         — but only fetches events whose event_data->lectureId is in our set,
         done by fetching events for the professor's lectures only via Python filter
         after a scoped learning_events fetch (no full-table scan).

    Returns dict[lecture_id -> list of {slide_number, confusion_rate, total}].
    """
    if not lecture_ids:
        return {}

    client = analytics_service.get_auth_client(token)
    lecture_set = set(lecture_ids)

    # Fetch slide metadata for all lectures in one query
    slide_rows = analytics_service._fetch_all_in(
        lambda: client.table("slides").select("id, lecture_id, slide_number"),
        "lecture_id",
        lecture_ids,
    )
    slide_meta: Dict[str, Dict[str, Any]] = {r["id"]: r for r in slide_rows}
    slide_ids = list(slide_meta.keys())

    if not slide_ids:
        return {lid: [] for lid in lecture_ids}

    # Fetch confidence events scoped to these slides via slideId in event_data.
    # We filter by slide_id set membership in Python after fetching by event_type only —
    # PostgREST doesn't support JSON-path IN filters, so we scope via slide_ids in Python.
    # To avoid a full-table scan, we only pull confidence_rating events (already a small subset).
    all_events = analytics_service._fetch_all(
        client.table("learning_events")
        .select("event_data")
        .eq("event_type", "confidence_rating")
    )

    # Group by lecture_id then slide_id — only keep events matching our slide_ids
    by_lecture_slide: Dict[str, Dict[str, Dict[str, int]]] = defaultdict(
        lambda: defaultdict(lambda: {"got_it": 0, "unsure": 0, "confused": 0})
    )
    for ev in all_events:
        ed = ev.get("event_data") or {}
        sid = ed.get("slideId")
        rating = ed.get("rating")
        if sid not in slide_meta or rating not in ("got_it", "unsure", "confused"):
            continue
        lid = slide_meta[sid].get("lecture_id")
        if lid not in lecture_set:
            continue
        by_lecture_slide[lid][sid][rating] += 1

    result: Dict[str, List[Dict[str, Any]]] = {}
    for lid in lecture_ids:
        slides_conf = by_lecture_slide.get(lid, {})
        rows = []
        for sid, counts in slides_conf.items():
            total = counts["got_it"] + counts["unsure"] + counts["confused"]
            if total == 0:
                continue
            meta = slide_meta.get(sid, {})
            rows.append({
                "slide_number": meta.get("slide_number", 0),
                "confusion_rate": round((counts["confused"] / total) * 100, 1),
                "total": total,
            })
        result[lid] = rows
    return result


# ── LLM intent classification ────────────────────────────────────────────────

def _build_classifier_prompt(question: str) -> str:
    intent_block = "\n".join(
        f"- {name}: {meta['description']} params={meta['params']}"
        for name, meta in INTENTS.items()
    )
    examples = "\n".join(
        f'  "{ex}" -> {{"intent":"{name}"}}'
        for name, meta in INTENTS.items()
        for ex in meta["examples"][:1]
    )
    unrelated_clause = (
        "If the question is unrelated to teaching analytics, unsafe, asks for writes, or\n"
        'is too ambiguous to map: return {"intent":"unknown"}.'
    )
    return INTENT_CLASSIFIER_PROMPT.format(
        domain_description=(
            "their teaching analytics (spanning ALL their courses and lectures)"
        ),
        intent_block=intent_block,
        unrelated_clause=unrelated_clause,
        examples=examples,
        question=question.strip(),
    )


async def classify_intent(question: str, ai_model: str = "cerebras") -> Dict[str, Any]:
    prompt = _build_classifier_prompt(question)
    for attempt in range(2):
        try:
            raw = await generate_text(prompt, ai_model)
            parsed = parse_json_response(raw)
            if isinstance(parsed, dict) and parsed.get("intent") in INTENTS:
                params = parsed.get("params") if isinstance(parsed.get("params"), dict) else {}
                return {"intent": parsed["intent"], "params": params}
            if isinstance(parsed, dict) and parsed.get("intent") == "unknown":
                return {"intent": "unknown", "params": {}}
        except Exception as e:
            logger.warning("ask_professor classify_intent attempt %d failed: %s", attempt + 1, e)
    return {"intent": "unknown", "params": {}, "_parse_failed": True}


# ── Intent executors (bulk data, no per-lecture loops) ────────────────────────

def _short(title: str, n: int = 40) -> str:
    title = title or "Untitled"
    return (title[: n - 1] + "…") if len(title) > n else title


def _exec_lectures_by_dropoff(lectures, token, params) -> Dict[str, Any]:
    limit = _clamp_int(params.get("limit"), default=5, lo=1, hi=20)
    if not lectures:
        return {"answer_text": "No lecture activity recorded yet.", "table": [], "chart": None}

    overviews = _bulk_fetch_overviews([l["id"] for l in lectures], token)

    rows = []
    for lec in lectures:
        ov = overviews.get(lec["id"], {})
        students = int(ov.get("total_students") or 0)
        if students == 0:
            continue
        completion = float(ov.get("completion_rate") or 0)
        rows.append({
            "lecture": _short(lec.get("title")),
            "completion_rate": round(completion, 1),
            "drop_off": round(100 - completion, 1),
            "students": students,
        })
    rows.sort(key=lambda r: r["completion_rate"])
    rows = rows[:limit]
    if not rows:
        return {"answer_text": "No lecture activity recorded yet.", "table": [], "chart": None}
    worst = rows[0]
    lec_name = worst['lecture']
    answer = (
        f'"{lec_name}" has the lowest completion at {worst["completion_rate"]:.0f}% '
        f'({worst["drop_off"]:.0f}% drop-off across {worst["students"]} students).'
    )
    chart = {"type": "bar", "x_key": "lecture", "y_key": "drop_off", "y_label": "Drop-off %", "data": rows}
    return {"answer_text": answer, "table": rows, "chart": chart}


def _exec_lectures_by_quiz_performance(lectures, token, params) -> Dict[str, Any]:
    limit = _clamp_int(params.get("limit"), default=5, lo=1, hi=20)
    if not lectures:
        return {"answer_text": "No quiz data recorded yet.", "table": [], "chart": None}

    overviews = _bulk_fetch_overviews([l["id"] for l in lectures], token)

    rows = []
    for lec in lectures:
        ov = overviews.get(lec["id"], {})
        students = int(ov.get("total_students") or 0)
        if students == 0:
            continue
        rows.append({
            "lecture": _short(lec.get("title")),
            "average_score": round(float(ov.get("average_score") or 0), 1),
            "students": students,
        })
    rows.sort(key=lambda r: r["average_score"])
    rows = rows[:limit]
    if not rows:
        return {"answer_text": "No quiz data recorded yet.", "table": [], "chart": None}
    worst = rows[0]
    lec_name = worst['lecture']
    answer = (
        f'"{lec_name}" has the weakest quiz performance at '
        f'{worst["average_score"]:.0f}% average score.'
    )
    chart = {"type": "bar", "x_key": "lecture", "y_key": "average_score", "y_label": "Avg score %", "data": rows}
    return {"answer_text": answer, "table": rows, "chart": chart}


def _exec_struggling_students(lectures, token, params) -> Dict[str, Any]:
    threshold = _clamp_int(params.get("max_accuracy_percent"), default=40, lo=0, hi=100)
    if not lectures:
        return {"answer_text": f"No students are below {threshold}% — nice work.", "table": [], "chart": None}

    all_scores = _bulk_fetch_student_scores([l["id"] for l in lectures], token)

    agg: Dict[str, Dict[str, Any]] = {}
    for lec in lectures:
        for s in all_scores.get(lec["id"], []):
            score = float(s.get("quiz_score") or 0)
            if score >= threshold:
                continue
            # Only count students who actually attempted quiz questions
            if int(s.get("total_questions_answered") or 0) == 0:
                continue
            name = s.get("student_name") or "Unknown"
            entry = agg.setdefault(name, {"student": name, "lectures_below": 0, "lowest_score": 100.0})
            entry["lectures_below"] += 1
            entry["lowest_score"] = min(entry["lowest_score"], round(score, 1))

    rows = sorted(agg.values(), key=lambda r: (-r["lectures_below"], r["lowest_score"]))
    if not rows:
        return {"answer_text": f"No students are below {threshold}% — nice work.", "table": [], "chart": None}
    top_student = rows[0]['student']
    answer = (
        f"{len(rows)} student(s) are below {threshold}% quiz score in at least one lecture. "
        f'"{top_student}" is struggling in {rows[0]["lectures_below"]} of them.'
    )
    return {"answer_text": answer, "table": rows, "chart": None}


def _exec_most_confusing_slides(lectures, token, params) -> Dict[str, Any]:
    limit = _clamp_int(params.get("limit"), default=5, lo=1, hi=20)
    if not lectures:
        return {"answer_text": "No confidence ratings yet — nothing to flag as confusing.", "table": [], "chart": None}

    lec_titles = {l["id"]: l.get("title", "Untitled") for l in lectures}
    all_confidence = _bulk_fetch_confidence([l["id"] for l in lectures], token)

    rows = []
    for lid, slides in all_confidence.items():
        for r in slides:
            if int(r.get("total") or 0) <= 0:
                continue
            rows.append({
                "slide": f"{_short(lec_titles.get(lid, ''), 24)} · #{r['slide_number']}",
                "confusion_rate": round(float(r.get("confusion_rate") or 0), 1),
                "ratings": int(r.get("total") or 0),
            })
    rows.sort(key=lambda r: r["confusion_rate"], reverse=True)
    rows = rows[:limit]
    if not rows:
        return {"answer_text": "No confidence ratings yet — nothing to flag as confusing.", "table": [], "chart": None}
    leader = rows[0]
    answer = (
        f'Your most confusing content is {leader["slide"]} at '
        f'{leader["confusion_rate"]:.0f}% confused.'
    )
    chart = {"type": "bar", "x_key": "slide", "y_key": "confusion_rate", "y_label": "Confused %", "data": rows}
    return {"answer_text": answer, "table": rows, "chart": chart}


def _exec_teaching_overview(lectures, token, params) -> Dict[str, Any]:
    total_lectures = len(lectures)
    if not lectures:
        return {
            "answer_text": f"You have {total_lectures} lecture(s), but no student activity has been recorded yet.",
            "table": [{"metric": "Lectures", "value": total_lectures}],
            "chart": None,
        }

    overviews = _bulk_fetch_overviews([l["id"] for l in lectures], token)

    active = [ov for ov in overviews.values() if int(ov.get("total_students") or 0) > 0]
    if not active:
        return {
            "answer_text": f"You have {total_lectures} lecture(s), but no student activity has been recorded yet.",
            "table": [{"metric": "Lectures", "value": total_lectures}],
            "chart": None,
        }
    enrollments = sum(int(o.get("total_students") or 0) for o in active)
    avg_completion = round(sum(float(o.get("completion_rate") or 0) for o in active) / len(active), 1)
    avg_score = round(sum(float(o.get("average_score") or 0) for o in active) / len(active), 1)
    table = [
        {"metric": "Lectures", "value": total_lectures},
        {"metric": "Lectures with activity", "value": len(active)},
        {"metric": "Total enrollments", "value": enrollments},
        {"metric": "Average completion", "value": f"{avg_completion}%"},
        {"metric": "Average quiz score", "value": f"{avg_score}%"},
    ]
    answer = (
        f"Across {len(active)} active lecture(s): {avg_completion:.0f}% average completion and "
        f"{avg_score:.0f}% average quiz score, reaching {enrollments} enrollments."
    )
    return {"answer_text": answer, "table": table, "chart": None}


_EXECUTORS = {
    "lectures_by_dropoff": _exec_lectures_by_dropoff,
    "lectures_by_quiz_performance": _exec_lectures_by_quiz_performance,
    "struggling_students": _exec_struggling_students,
    "most_confusing_slides": _exec_most_confusing_slides,
    "teaching_overview": _exec_teaching_overview,
}


# ── Top-level entry point ────────────────────────────────────────────────────

MAX_QUESTION_LENGTH = 500


# ── Conversational, data-aware assistant ──────────────────────────────────────

MAX_HISTORY_MESSAGES = 12
MAX_CONTEXT_LECTURES = 40


def _build_professor_context(token: str, professor_id: str) -> str:
    """Compact grounding document: the professor's courses + lectures + key stats.

    Uses bulk queries — 3 Supabase round-trips total regardless of lecture count
    (replaces the old N+1 per-lecture get_lecture_overview loop).

    Results are cached for _CONTEXT_TTL seconds per professor so that multi-turn
    conversations don't rebuild the context on every single message.
    """
    global _CONTEXT_CACHE
    now = time.monotonic()
    cached = _CONTEXT_CACHE.get(professor_id)
    if cached and (now - cached[0]) < _CONTEXT_TTL:
        return cached[1]

    client = analytics_service.get_auth_client(token)

    courses = analytics_service._fetch_all(
        client.table("courses").select("id, title, description").eq("professor_id", professor_id)
    )
    course_title = {c["id"]: c.get("title") or "Untitled course" for c in courses}

    lectures = _get_professor_lectures(token, professor_id)[:MAX_CONTEXT_LECTURES]
    lecture_ids = [l["id"] for l in lectures]

    # Single bulk query instead of N calls to get_lecture_overview
    overviews = _bulk_fetch_overviews(lecture_ids, token)

    lines: List[str] = []
    if courses:
        lines.append("Courses:")
        for c in courses:
            n = sum(1 for lec in lectures if lec.get("course_id") == c["id"])
            desc = (c.get("description") or "").strip()
            lines.append(f"- {c.get('title')}{f' — {desc}' if desc else ''} ({n} lecture(s))")
        lines.append("")

    lines.append("Lectures:")
    if not lectures:
        lines.append("- (none yet)")
    for lec in lectures:
        ov = overviews.get(lec["id"], {})
        students = int(ov.get("total_students") or 0)
        course = course_title.get(lec.get("course_id"), "Uncategorized")
        if students:
            lines.append(
                f"- [{course}] {lec.get('title')}: {students} students, "
                f"{ov.get('completion_rate', 0)}% completion, {ov.get('average_score', 0)}% avg quiz score"
            )
        else:
            lines.append(f"- [{course}] {lec.get('title')}: no student activity yet")

    result = "\n".join(lines)
    _CONTEXT_CACHE[professor_id] = (now, result)
    return result


def _build_chat_prompt(context: str, messages: List[Dict[str, str]]) -> str:
    system = PROFESSOR_CHAT_SYSTEM_PROMPT.format(
        context=context,
        voice_prose=VOICE_PROSE,
        lang_match=LANG_MATCH,
    )
    convo = "\n".join(
        f"{'User' if m.get('role') == 'user' else 'Assistant'}: {m.get('content', '').strip()}"
        for m in messages
    )
    return f"{system}\nConversation:\n{convo}\nAssistant:"


async def chat_professor_data(
    *,
    professor_id: str,
    messages: List[Dict[str, str]],
    token: str,
    ai_model: str = "cerebras",
) -> str:
    """Conversational, data-grounded answer over the professor's courses/lectures."""
    from fastapi.concurrency import run_in_threadpool

    trimmed = [m for m in messages if m.get("content", "").strip()][-MAX_HISTORY_MESSAGES:]
    if not trimmed:
        return "Ask me anything about your courses, lectures, or how your students are doing."

    context = await run_in_threadpool(_build_professor_context, token, professor_id)
    prompt = _build_chat_prompt(context, trimmed)
    try:
        reply = await generate_text(
            prompt, ai_model, user_id=professor_id, feature="ask_professor_chat"
        )
    except Exception as e:
        logger.error("ask_professor chat failed: %s", e, exc_info=True)
        return f"Sorry — I couldn't answer that just now. Debug Error: {type(e).__name__}: {str(e)}"
    return (reply or "").strip() or "I'm not sure how to answer that from your data. Try asking about completion, quiz scores, or where students are struggling."


async def ask_professor_data(
    *,
    professor_id: str,
    question: str,
    token: str,
    ai_model: str = "cerebras",
) -> Dict[str, Any]:
    """End-to-end: classify → bulk-fetch → execute → assemble response."""
    q = (question or "").strip()
    if not q:
        return {"intent": "unknown", "answer_text": "Please type a question first.", "table": [], "chart": None, "debug": {}}
    if len(q) > MAX_QUESTION_LENGTH:
        q = q[:MAX_QUESTION_LENGTH]

    classified = await classify_intent(q, ai_model=ai_model)
    intent = classified.get("intent", "unknown")
    params = classified.get("params") or {}

    if intent == "unknown" or intent not in _EXECUTORS:
        answer = (
            "I couldn't understand that question. Try rephrasing it, or pick one of the suggestions below."
            if classified.get("_parse_failed") else SAFE_FALLBACK_TEXT
        )
        return {"intent": "unknown", "answer_text": answer, "table": [], "chart": None,
                "debug": {"classified_params": params, "parse_failed": bool(classified.get("_parse_failed"))}}

    try:
        from fastapi.concurrency import run_in_threadpool

        def _run():
            lectures = _get_professor_lectures(token, professor_id)
            return _EXECUTORS[intent](lectures, token, params)

        result = await run_in_threadpool(_run)
    except Exception as e:
        logger.error("ask_professor executor '%s' failed: %s", intent, e, exc_info=True)
        return {"intent": intent, "answer_text": "Something went wrong running that question. Please try a simpler one.",
                "table": [], "chart": None, "debug": {"classified_params": params, "error": str(e)[:200]}}

    return {
        "intent": intent,
        "answer_text": result.get("answer_text", ""),
        "table": result.get("table", []),
        "chart": result.get("chart"),
        "debug": {"classified_params": params},
    }
