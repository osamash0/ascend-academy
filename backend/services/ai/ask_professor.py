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
        "Where is quiz performance the weakest?",
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

    # Each lecture's owner: their own reading never counts
    owners = {
        row["id"]: row.get("professor_id")
        for row in analytics_service._fetch_all_in(
            lambda: client.table("lectures").select("id, professor_id"), "id", lecture_ids)
    }

    # One query for all progress rows across all lectures
    progress_rows = analytics_service._fetch_all_in(
        lambda: client.table("student_progress").select(
            "lecture_id, user_id, completed_at, quiz_score, total_questions_answered"
        ),
        "lecture_id",
        lecture_ids,
    )

    # Aggregate per lecture in Python (no extra network calls), over people
    by_lecture: Dict[str, Dict[str, Any]] = {}
    for row in progress_rows:
        lid = row.get("lecture_id")
        uid = row.get("user_id")
        if not lid or not uid or analytics_service._same_person(uid, owners.get(lid)):
            continue
        agg = by_lecture.setdefault(lid, {"people": set(), "completed": set(), "quiz_scores": {}})
        uid = str(uid)
        agg["people"].add(uid)
        if row.get("completed_at"):
            agg["completed"].add(uid)
        if (row.get("total_questions_answered") or 0) > 0:
            agg["quiz_scores"][uid] = row.get("quiz_score") or 0

    # A lecture under MIN_PEOPLE people says nothing: None, never 0 (callers read None as "no data")
    floor = analytics_service.MIN_PEOPLE
    result: Dict[str, Dict[str, Any]] = {}
    for lid in lecture_ids:
        agg = by_lecture.get(lid)
        if not agg or len(agg["people"]) < floor:
            result[lid] = {"total_students": None, "completion_rate": None, "average_score": None}
            continue
        total = len(agg["people"])
        scores = list(agg["quiz_scores"].values())
        result[lid] = {
            "total_students": total,
            "completion_rate": round(len(agg["completed"]) / total * 100, 1),
            "average_score": round(sum(scores) / len(scores), 1) if len(scores) >= floor else None,
        }
    return result


def _bulk_fetch_confidence(
    lecture_ids: List[str], token: str
) -> Dict[str, List[Dict[str, Any]]]:
    """Per lecture, the slides at least MIN_PEOPLE people rated, as {slide_number, confusion_rate, total}.

    Counts people, never events: each person's latest check-in on a slide counts once, the
    lecture's owner never counts, and a slide fewer than MIN_PEOPLE people rated is absent
    (`analytics_service._floored_counts`, the same floor as the per-lecture views). `total` is
    the number of people who rated it.

    Round-trips: lecture owners and slide metadata in one IN query each, then the
    confidence_rating events (PostgREST has no JSON-path IN filter, so they are scoped to these
    lectures' slides in Python).
    """
    if not lecture_ids:
        return {}

    client = analytics_service.get_auth_client(token)
    lecture_set = set(lecture_ids)

    owners = {
        row["id"]: row.get("professor_id")
        for row in analytics_service._fetch_all_in(
            lambda: client.table("lectures").select("id, professor_id"), "id", lecture_ids)
    }

    # Fetch slide metadata for all lectures in one query
    slide_rows = analytics_service._fetch_all_in(
        lambda: client.table("slides").select("id, lecture_id, slide_number"),
        "lecture_id",
        lecture_ids,
    )
    slide_meta: Dict[str, Dict[str, Any]] = {r["id"]: r for r in slide_rows}

    if not slide_meta:
        return {lid: [] for lid in lecture_ids}

    # Oldest first, so each person's latest rating is the one that counts.
    all_events = analytics_service._fetch_all(
        client.table("learning_events")
        .select("user_id, event_data, created_at")
        .eq("event_type", "confidence_rating")
        .order("created_at")
    )

    events_by_lecture: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for ev in all_events:
        sid = (ev.get("event_data") or {}).get("slideId")
        lid = slide_meta.get(sid, {}).get("lecture_id")
        if lid in lecture_set:
            events_by_lecture[lid].append(ev)

    result: Dict[str, List[Dict[str, Any]]] = {}
    for lid in lecture_ids:
        counts_by_slide = analytics_service._floored_counts(events_by_lecture.get(lid, []), owners.get(lid))
        rows = []
        for sid, counts in counts_by_slide.items():
            total = sum(counts.values())
            rows.append({
                "slide_number": slide_meta.get(sid, {}).get("slide_number", 0),
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
        if students == 0 or ov.get("average_score") is None:
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


def _exec_most_confusing_slides(lectures, token, params) -> Dict[str, Any]:
    limit = _clamp_int(params.get("limit"), default=5, lo=1, hi=20)
    if not lectures:
        return {"answer_text": "No confidence ratings yet — nothing to flag as confusing.", "table": [], "chart": None}

    lec_titles = {l["id"]: l.get("title", "Untitled") for l in lectures}
    all_confidence = _bulk_fetch_confidence([l["id"] for l in lectures], token)

    rows = []
    for lid, slides in all_confidence.items():
        for r in slides:
            # People who rated it; under the floor a slide says nothing.
            if int(r.get("total") or 0) < analytics_service.MIN_PEOPLE:
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
    scored = [float(o["average_score"]) for o in active if o.get("average_score") is not None]
    avg_score = round(sum(scored) / len(scored), 1) if scored else None
    table = [
        {"metric": "Lectures", "value": total_lectures},
        {"metric": "Lectures with activity", "value": len(active)},
        {"metric": "Total enrollments", "value": enrollments},
        {"metric": "Average completion", "value": f"{avg_completion}%"},
    ]
    answer = f"Across {len(active)} active lecture(s): {avg_completion:.0f}% average completion"
    if avg_score is not None:
        table.append({"metric": "Average quiz score", "value": f"{avg_score}%"})
        answer += f" and {avg_score:.0f}% average quiz score"
    answer += f", reaching {enrollments} enrollments."
    return {"answer_text": answer, "table": table, "chart": None}


_EXECUTORS = {
    "lectures_by_dropoff": _exec_lectures_by_dropoff,
    "lectures_by_quiz_performance": _exec_lectures_by_quiz_performance,
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
                f"{ov.get('completion_rate', 0)}% completion"
                + (f", {ov['average_score']}% avg quiz score" if ov.get("average_score") is not None else "")
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
        # Never echo the exception: provider bodies and budget figures are
        # for the log line above, not the chat.
        return "Sorry — I couldn't answer that just now. Please try again in a moment."
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
