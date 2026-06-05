"""Ask Your Data — professor-wide natural-language analytics.

Like :mod:`ask_data` but scoped to ALL of a professor's lectures rather than
one. The LLM picks a fixed intent; the matching executor aggregates the
existing per-lecture cached analytics across every lecture the professor owns.
No raw SQL is generated, and answers are templated from real numbers (no
free-form LLM prose) — so the bar can't hallucinate.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from backend.services import analytics_service
from backend.services.ai.ask_data import _clamp_int
from backend.services.ai.orchestrator import generate_text, parse_json_response

logger = logging.getLogger(__name__)


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
    return f"""You classify a professor's natural-language question about their teaching
analytics (spanning ALL their courses and lectures) into ONE of the supported
intents below. You NEVER answer the question. You NEVER invent a new intent.
You output ONLY a JSON object.

Supported intents:
{intent_block}

If the question is unrelated to teaching analytics, unsafe, asks for writes, or
is too ambiguous to map: return {{"intent":"unknown"}}.

Examples:
{examples}
  "delete all students" -> {{"intent":"unknown"}}
  "what's the weather today" -> {{"intent":"unknown"}}

Respond with ONLY a JSON object of the form:
{{"intent":"<intent_name>","params":{{...optional...}}}}

Question: "{question.strip()}"
JSON:"""


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


# ── Intent executors (iterate the professor's lectures) ───────────────────────

def _short(title: str, n: int = 40) -> str:
    title = title or "Untitled"
    return (title[: n - 1] + "…") if len(title) > n else title


def _exec_lectures_by_dropoff(lectures, token, params) -> Dict[str, Any]:
    limit = _clamp_int(params.get("limit"), default=5, lo=1, hi=20)
    rows = []
    for lec in lectures:
        ov = analytics_service.get_lecture_overview(lec["id"], token)
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
    answer = (
        f"“{worst['lecture']}” has the lowest completion at {worst['completion_rate']:.0f}% "
        f"({worst['drop_off']:.0f}% drop-off across {worst['students']} students)."
    )
    chart = {"type": "bar", "x_key": "lecture", "y_key": "drop_off", "y_label": "Drop-off %", "data": rows}
    return {"answer_text": answer, "table": rows, "chart": chart}


def _exec_lectures_by_quiz_performance(lectures, token, params) -> Dict[str, Any]:
    limit = _clamp_int(params.get("limit"), default=5, lo=1, hi=20)
    rows = []
    for lec in lectures:
        ov = analytics_service.get_lecture_overview(lec["id"], token)
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
    answer = (
        f"“{worst['lecture']}” has the weakest quiz performance at "
        f"{worst['average_score']:.0f}% average score."
    )
    chart = {"type": "bar", "x_key": "lecture", "y_key": "average_score", "y_label": "Avg score %", "data": rows}
    return {"answer_text": answer, "table": rows, "chart": chart}


def _exec_struggling_students(lectures, token, params) -> Dict[str, Any]:
    threshold = _clamp_int(params.get("max_accuracy_percent"), default=40, lo=0, hi=100)
    # Aggregate by anonymized student name (deterministic per user id).
    agg: Dict[str, Dict[str, Any]] = {}
    for lec in lectures:
        for s in analytics_service.get_student_performance(lec["id"], token):
            score = float(s.get("quiz_score") or 0)
            if score >= threshold:
                continue
            name = s.get("student_name") or (s.get("student_id", "")[:8])
            entry = agg.setdefault(name, {"student": name, "lectures_below": 0, "lowest_score": 100.0})
            entry["lectures_below"] += 1
            entry["lowest_score"] = min(entry["lowest_score"], round(score, 1))
    rows = sorted(agg.values(), key=lambda r: (-r["lectures_below"], r["lowest_score"]))
    if not rows:
        return {"answer_text": f"No students are below {threshold}% — nice work.", "table": [], "chart": None}
    answer = (
        f"{len(rows)} student(s) are below {threshold}% quiz score in at least one lecture. "
        f"“{rows[0]['student']}” is struggling in {rows[0]['lectures_below']} of them."
    )
    return {"answer_text": answer, "table": rows, "chart": None}


def _exec_most_confusing_slides(lectures, token, params) -> Dict[str, Any]:
    limit = _clamp_int(params.get("limit"), default=5, lo=1, hi=20)
    rows = []
    for lec in lectures:
        for r in analytics_service.get_confidence_by_slide(lec["id"], token):
            if int(r.get("total") or 0) <= 0:
                continue
            rows.append({
                "slide": f"{_short(lec.get('title'), 24)} · #{r['slide_number']}",
                "confusion_rate": round(float(r.get("confusion_rate") or 0), 1),
                "ratings": int(r.get("total") or 0),
            })
    rows.sort(key=lambda r: r["confusion_rate"], reverse=True)
    rows = rows[:limit]
    if not rows:
        return {"answer_text": "No confidence ratings yet — nothing to flag as confusing.", "table": [], "chart": None}
    leader = rows[0]
    answer = (
        f"Your most confusing content is {leader['slide']} at "
        f"{leader['confusion_rate']:.0f}% confused."
    )
    chart = {"type": "bar", "x_key": "slide", "y_key": "confusion_rate", "y_label": "Confused %", "data": rows}
    return {"answer_text": answer, "table": rows, "chart": chart}


def _exec_teaching_overview(lectures, token, params) -> Dict[str, Any]:
    active = []
    for lec in lectures:
        ov = analytics_service.get_lecture_overview(lec["id"], token)
        if int(ov.get("total_students") or 0) > 0:
            active.append(ov)
    total_lectures = len(lectures)
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

    Real numbers only — the LLM is instructed to answer strictly from this.
    """
    client = analytics_service.get_auth_client(token)

    courses = analytics_service._fetch_all(
        client.table("courses").select("id, title, description").eq("professor_id", professor_id)
    )
    course_title = {c["id"]: c.get("title") or "Untitled course" for c in courses}

    lectures = _get_professor_lectures(token, professor_id)[:MAX_CONTEXT_LECTURES]

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
        ov = analytics_service.get_lecture_overview(lec["id"], token)
        students = int(ov.get("total_students") or 0)
        course = course_title.get(lec.get("course_id"), "Uncategorized")
        if students:
            lines.append(
                f"- [{course}] {lec.get('title')}: {students} students, "
                f"{ov.get('completion_rate', 0)}% completion, {ov.get('average_score', 0)}% avg quiz score"
            )
        else:
            lines.append(f"- [{course}] {lec.get('title')}: no student activity yet")

    return "\n".join(lines)


def _build_chat_prompt(context: str, messages: List[Dict[str, str]]) -> str:
    system = f"""You are the analytics assistant for a professor on the Ascend learning platform.
You help them understand their own teaching: their courses, lectures, students,
engagement, completion, quiz performance, and where students struggle.

The professor's current data (this is everything you know — there is no other source):
{context}

Rules:
- Answer ONLY from the data above and the conversation so far.
- If the data doesn't contain the answer, say so briefly and suggest what they can ask
  (e.g. drop-off, completion, quiz scores, struggling students, confusing slides).
- Never invent lectures, courses, students, or numbers that aren't in the data.
- Be concise, warm, and direct. Refer to lectures/courses by name. Plain language, no markdown headers.
"""
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
        reply = await generate_text(prompt, ai_model)
    except Exception as e:
        logger.error("ask_professor chat failed: %s", e, exc_info=True)
        return "Sorry — I couldn't answer that just now. Please try again."
    return (reply or "").strip() or "I'm not sure how to answer that from your data. Try asking about completion, quiz scores, or where students are struggling."


async def ask_professor_data(
    *,
    professor_id: str,
    question: str,
    token: str,
    ai_model: str = "cerebras",
) -> Dict[str, Any]:
    """End-to-end: classify → fetch lectures → execute → assemble response."""
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
