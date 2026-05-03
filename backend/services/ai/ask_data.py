"""Ask Your Data — natural-language analytics query for professors.

We never let the LLM write SQL. Instead it picks one of a fixed list of
"intents" and returns structured parameters. Each intent maps to an
existing analytics_service function. The shaped result (table + summary
+ optional chart series) is sent back to the frontend.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from backend.services import analytics_service
from backend.services.ai.orchestrator import generate_text, parse_json_response

logger = logging.getLogger(__name__)


# ── Intent catalog ────────────────────────────────────────────────────────────

INTENTS: Dict[str, Dict[str, Any]] = {
    "top_dropoff_slides": {
        "description": "Rank slides by drop-off rate (highest first).",
        "params": {"limit": "int 1-20, default 5", "order": "'highest' or 'lowest', default 'highest'"},
        "examples": [
            "Which slide had the highest drop-off rate?",
            "Show me the 3 slides where students drop off the most",
            "Where do students leave the lecture?",
        ],
    },
    "worst_quiz_questions": {
        "description": "Rank quiz questions by lowest correct rate.",
        "params": {"limit": "int 1-20, default 3", "order": "'lowest' or 'highest', default 'lowest'"},
        "examples": [
            "Which 3 quiz questions had the lowest correct rate?",
            "What questions are students failing most?",
            "Easiest quiz questions",
        ],
    },
    "struggling_students": {
        "description": "List students whose quiz accuracy is below a threshold.",
        "params": {"max_accuracy_percent": "int 0-100, default 40"},
        "examples": [
            "Show me students who answered less than 40% of quiz questions",
            "Who is failing the quizzes?",
            "Students under 50% accuracy",
        ],
    },
    "completion_count": {
        "description": "How many students finished the lecture, total students, completion rate.",
        "params": {},
        "examples": [
            "How many students finished the lecture?",
            "What's the completion rate?",
            "How many people are done?",
        ],
    },
    "confusion_topics": {
        "description": "Rank slides by confusion rate (most students rated 'confused').",
        "params": {"limit": "int 1-20, default 5"},
        "examples": [
            "What concepts are students most confused about?",
            "Where are students confused?",
            "Show the most confusing slides",
        ],
    },
    "ai_query_themes": {
        "description": "Recent student questions to the AI tutor for this lecture.",
        "params": {"limit": "int 1-30, default 10"},
        "examples": [
            "What are students asking the AI tutor?",
            "Recent AI tutor questions",
            "Show recent tutor queries",
        ],
    },
}


SAFE_FALLBACK_TEXT = (
    "I can only answer questions about this lecture's analytics — slides, "
    "quizzes, students, or concepts. Try one of the suggested questions below."
)


# ── Public schema ─────────────────────────────────────────────────────────────

def list_suggested_questions() -> List[str]:
    """Curated chips shown on empty state."""
    return [
        "Which slide had the highest drop-off rate?",
        "Which 3 quiz questions had the lowest correct rate?",
        "Show me students who answered less than 40% of quiz questions",
        "How many students finished the lecture?",
        "What concepts are students most confused about?",
    ]


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
    return f"""You classify a professor's natural-language question about lecture analytics
into ONE of the supported intents below. You NEVER answer the question.
You NEVER invent a new intent. You output ONLY a JSON object.

Supported intents:
{intent_block}

If the question is unrelated to lecture analytics, unsafe, asks for writes,
asks about anything outside slides/quizzes/students/concepts/AI queries, or
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
    """Return {intent, params}. Falls back to 'unknown' on parse failure."""
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
            logger.warning("ask_data classify_intent attempt %d failed: %s", attempt + 1, e)
    return {"intent": "unknown", "params": {}}


# ── Param validation helpers ─────────────────────────────────────────────────

def _clamp_int(val: Any, *, default: int, lo: int, hi: int) -> int:
    try:
        n = int(val)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


# ── Intent executors ─────────────────────────────────────────────────────────

def _exec_top_dropoff_slides(lecture_id: str, token: str, params: Dict[str, Any]) -> Dict[str, Any]:
    limit = _clamp_int(params.get("limit"), default=5, lo=1, hi=20)
    order = (params.get("order") or "highest").lower()
    slides = analytics_service.get_slide_analytics(lecture_id, token)
    rows = sorted(slides, key=lambda s: s.get("drop_off_rate", 0.0),
                  reverse=(order != "lowest"))[:limit]
    table = [
        {"slide": f"#{r['slide_number']} — {r['title']}",
         "drop_off_rate": r.get("drop_off_rate", 0.0),
         "views": r.get("view_count", 0)}
        for r in rows
    ]
    if not rows:
        return {"answer_text": "No slide drop-off data is available yet.", "table": [], "chart": None}
    leader = rows[0]
    answer = (
        f"Slide #{leader['slide_number']} — \"{leader['title']}\" has the "
        f"{'highest' if order != 'lowest' else 'lowest'} drop-off rate at "
        f"{leader.get('drop_off_rate', 0):.0f}%."
    )
    chart = {
        "type": "bar",
        "x_key": "slide",
        "y_key": "drop_off_rate",
        "y_label": "Drop-off %",
        "data": table,
    }
    return {"answer_text": answer, "table": table, "chart": chart}


def _exec_worst_quiz_questions(lecture_id: str, token: str, params: Dict[str, Any]) -> Dict[str, Any]:
    limit = _clamp_int(params.get("limit"), default=3, lo=1, hi=20)
    order = (params.get("order") or "lowest").lower()
    qs = analytics_service.get_quiz_analytics(lecture_id, token)
    qs = [q for q in qs if q.get("attempts", 0) > 0]
    rows = sorted(qs, key=lambda q: q.get("success_rate", 0.0),
                  reverse=(order == "highest"))[:limit]
    table = [
        {"question": (r["question_text"][:90] + "…") if len(r["question_text"]) > 90 else r["question_text"],
         "success_rate": r.get("success_rate", 0.0),
         "attempts": r.get("attempts", 0)}
        for r in rows
    ]
    if not rows:
        return {"answer_text": "No quiz attempts have been recorded yet.", "table": [], "chart": None}
    direction = "lowest" if order != "highest" else "highest"
    answer = (
        f"The {len(rows)} {direction}-scoring quiz question(s) range from "
        f"{rows[0].get('success_rate', 0):.0f}% to {rows[-1].get('success_rate', 0):.0f}% correct."
    )
    chart = {
        "type": "bar",
        "x_key": "question",
        "y_key": "success_rate",
        "y_label": "Correct %",
        "data": table,
    }
    return {"answer_text": answer, "table": table, "chart": chart}


def _exec_struggling_students(lecture_id: str, token: str, params: Dict[str, Any]) -> Dict[str, Any]:
    threshold = _clamp_int(params.get("max_accuracy_percent"), default=40, lo=0, hi=100)
    students = analytics_service.get_student_performance(lecture_id, token)
    rows = [s for s in students if (s.get("quiz_score") or 0) < threshold]
    table = [
        {"student": s.get("student_name") or s.get("student_id", "")[:8],
         "quiz_score": s.get("quiz_score", 0),
         "progress": s.get("progress_percentage", 0)}
        for s in rows
    ]
    if not rows:
        answer = f"No students are below {threshold}% quiz accuracy — nice work."
    else:
        answer = f"{len(rows)} student(s) are below {threshold}% quiz accuracy."
    return {"answer_text": answer, "table": table, "chart": None}


def _exec_completion_count(lecture_id: str, token: str, params: Dict[str, Any]) -> Dict[str, Any]:
    overview = analytics_service.get_lecture_overview(lecture_id, token)
    total = overview.get("total_students", 0)
    rate = overview.get("completion_rate", 0)
    completed = round(total * rate / 100) if total else 0
    table = [
        {"metric": "Students started", "value": total},
        {"metric": "Students completed", "value": completed},
        {"metric": "Completion rate", "value": f"{rate}%"},
        {"metric": "Average score", "value": f"{overview.get('average_score', 0)}%"},
    ]
    answer = (
        f"{completed} of {total} students have finished the lecture "
        f"({rate}% completion rate)."
        if total else "No student progress recorded yet."
    )
    return {"answer_text": answer, "table": table, "chart": None}


def _exec_confusion_topics(lecture_id: str, token: str, params: Dict[str, Any]) -> Dict[str, Any]:
    limit = _clamp_int(params.get("limit"), default=5, lo=1, hi=20)
    rows_raw = analytics_service.get_confidence_by_slide(lecture_id, token)
    rows_raw = [r for r in rows_raw if r.get("total", 0) > 0]
    rows = sorted(rows_raw, key=lambda r: r.get("confusion_rate", 0.0), reverse=True)[:limit]
    table = [
        {"slide": f"#{r['slide_number']} — {r['title']}",
         "confusion_rate": r.get("confusion_rate", 0.0),
         "ratings": r.get("total", 0)}
        for r in rows
    ]
    if not rows:
        return {"answer_text": "No confidence ratings yet — nothing to flag as confusing.",
                "table": [], "chart": None}
    leader = rows[0]
    answer = (
        f"Slide #{leader['slide_number']} — \"{leader['title']}\" is the most "
        f"confusing so far ({leader.get('confusion_rate', 0):.0f}% rated 'confused')."
    )
    chart = {
        "type": "bar",
        "x_key": "slide",
        "y_key": "confusion_rate",
        "y_label": "Confused %",
        "data": table,
    }
    return {"answer_text": answer, "table": table, "chart": chart}


def _exec_ai_query_themes(lecture_id: str, token: str, params: Dict[str, Any]) -> Dict[str, Any]:
    limit = _clamp_int(params.get("limit"), default=10, lo=1, hi=30)
    feed = analytics_service.get_ai_query_feed(lecture_id, token)[:limit]
    table = [
        {"slide": item.get("slide_title", ""),
         "question": (item.get("query_text", "")[:140] + "…")
                     if len(item.get("query_text", "")) > 140 else item.get("query_text", "")}
        for item in feed
    ]
    if not feed:
        return {"answer_text": "No AI tutor questions have been asked in this lecture yet.",
                "table": [], "chart": None}
    return {
        "answer_text": f"Here are the {len(feed)} most recent AI tutor question(s) from your students.",
        "table": table,
        "chart": None,
    }


_EXECUTORS = {
    "top_dropoff_slides": _exec_top_dropoff_slides,
    "worst_quiz_questions": _exec_worst_quiz_questions,
    "struggling_students": _exec_struggling_students,
    "completion_count": _exec_completion_count,
    "confusion_topics": _exec_confusion_topics,
    "ai_query_themes": _exec_ai_query_themes,
}


# ── Top-level entry point ────────────────────────────────────────────────────

MAX_QUESTION_LENGTH = 500


async def ask_lecture_data(
    *,
    lecture_id: str,
    question: str,
    token: str,
    ai_model: str = "cerebras",
) -> Dict[str, Any]:
    """End-to-end: classify → execute → assemble structured response.

    Returns:
      {
        intent,
        answer_text,
        table:  list[dict] | [],
        chart:  {type,x_key,y_key,y_label,data} | None,
        debug:  {classified_params}
      }
    """
    q = (question or "").strip()
    if not q:
        return {
            "intent": "unknown",
            "answer_text": "Please type a question first.",
            "table": [], "chart": None, "debug": {},
        }
    if len(q) > MAX_QUESTION_LENGTH:
        q = q[:MAX_QUESTION_LENGTH]

    classified = await classify_intent(q, ai_model=ai_model)
    intent = classified.get("intent", "unknown")
    params = classified.get("params") or {}

    if intent == "unknown" or intent not in _EXECUTORS:
        return {
            "intent": "unknown",
            "answer_text": SAFE_FALLBACK_TEXT,
            "table": [],
            "chart": None,
            "debug": {"classified_params": params},
        }

    try:
        result = _EXECUTORS[intent](lecture_id, token, params)
    except Exception as e:
        logger.error("ask_data executor '%s' failed: %s", intent, e, exc_info=True)
        return {
            "intent": intent,
            "answer_text": "Something went wrong while running that question. Please try a simpler one.",
            "table": [],
            "chart": None,
            "debug": {"classified_params": params, "error": str(e)[:200]},
        }

    return {
        "intent": intent,
        "answer_text": result.get("answer_text", ""),
        "table": result.get("table", []),
        "chart": result.get("chart"),
        "debug": {"classified_params": params},
    }
