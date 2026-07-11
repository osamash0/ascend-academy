"""Layer-3 evidence — on-demand drill-down data for the Insight Garden.

Unlike the metric bundle (computed once per feed load), evidence is fetched
lazily: only when a professor opens a card's evidence drawer for a specific
slide or student. Each function returns a small, narrated-friendly payload —
never a raw table dump.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from backend.services import analytics_service

AI_QUERIES = "ai_queries"
CONFIDENCE_BREAKDOWN = "confidence_breakdown"
STUDENT_JOURNEY = "student_journey"

_MAX_QUERIES = 30


def get_ai_queries_evidence(lecture_id: str, slide_id: str, token: Optional[str] = None) -> Dict[str, Any]:
    """The grouped list of what students actually asked the AI on this slide."""
    client = analytics_service.get_auth_client(token)
    events = analytics_service._fetch_all(
        client.table("learning_events")
        .select("event_data, created_at")
        .eq("event_type", "ai_tutor_query")
        .contains("event_data", {"lectureId": lecture_id})
        .order("created_at", desc=True)
    )

    queries: List[Dict[str, Any]] = []
    for e in events:
        ed = e.get("event_data") or {}
        if ed.get("slideId") != slide_id:
            continue
        query_text = (ed.get("query") or "").strip()
        if not query_text:
            continue
        response_text = (ed.get("response") or "").strip()
        queries.append(
            {
                "query": query_text,
                "response": response_text or None,
                "createdAt": e.get("created_at", ""),
            }
        )
        if len(queries) >= _MAX_QUERIES:
            break

    return {"kind": AI_QUERIES, "queries": queries, "totalCount": len(queries)}


def get_confidence_breakdown_evidence(lecture_id: str, slide_id: str, token: Optional[str] = None) -> Dict[str, Any]:
    """Confidence-accuracy 2x2 for one slide: did feeling sure predict getting it right?"""
    client = analytics_service.get_auth_client(token)

    quiz_questions = analytics_service._fetch_all(
        client.table("quiz_questions").select("id").eq("slide_id", slide_id)
    )
    qids = {q["id"] for q in quiz_questions}

    conf_events = analytics_service._fetch_all(
        client.table("learning_events")
        .select("user_id, event_data, created_at")
        .eq("event_type", "confidence_rating")
        .contains("event_data", {"lectureId": lecture_id})
        .order("created_at")
    )
    user_rating: Dict[str, str] = {}
    for ev in conf_events:  # ascending order → last write wins = latest rating
        ed = ev.get("event_data") or {}
        if ed.get("slideId") != slide_id:
            continue
        rating = ed.get("rating")
        if rating in ("got_it", "unsure", "confused"):
            user_rating[ev.get("user_id")] = rating

    user_correct: Dict[str, bool] = {}
    if qids:
        quiz_events = analytics_service._fetch_all(
            client.table("learning_events")
            .select("user_id, event_data, created_at")
            .eq("event_type", "quiz_attempt")
            .contains("event_data", {"lectureId": lecture_id})
            .order("created_at")
        )
        for ev in quiz_events:  # ascending order → first write wins = first attempt
            ed = ev.get("event_data") or {}
            if ed.get("questionId") not in qids:
                continue
            uid = ev.get("user_id")
            if uid not in user_correct:
                user_correct[uid] = bool(ed.get("correct"))

    quadrants = {"confidentCorrect": 0, "confidentWrong": 0, "unsureCorrect": 0, "unsureWrong": 0}
    for uid, rating in user_rating.items():
        if uid not in user_correct:
            continue
        confident = rating == "got_it"
        correct = user_correct[uid]
        key = ("confident" if confident else "unsure") + ("Correct" if correct else "Wrong")
        quadrants[key] += 1

    return {"kind": CONFIDENCE_BREAKDOWN, "quadrants": quadrants, "total": sum(quadrants.values())}


def get_student_journey_evidence(lecture_id: str, student_id: str, token: Optional[str] = None) -> Dict[str, Any]:
    """One student's slide-by-slide path: dwell, confidence, quiz result, AI help."""
    client = analytics_service.get_auth_client(token)

    slides = analytics_service._fetch_all(
        client.table("slides")
        .select("id, slide_number, title")
        .eq("lecture_id", lecture_id)
        .order("slide_number")
    )
    slide_ids = [s["id"] for s in slides]

    view_events = analytics_service._fetch_all(
        client.table("learning_events")
        .select("event_data")
        .eq("event_type", "slide_view")
        .eq("user_id", student_id)
        .contains("event_data", {"lectureId": lecture_id})
    )
    dwell_by_slide: Dict[str, float] = {}
    for ev in view_events:
        ed = ev.get("event_data") or {}
        sid = ed.get("slideId")
        dur = ed.get("duration_seconds")
        if sid and isinstance(dur, (int, float)):
            dwell_by_slide[sid] = dwell_by_slide.get(sid, 0.0) + float(dur)

    conf_events = analytics_service._fetch_all(
        client.table("learning_events")
        .select("event_data, created_at")
        .eq("event_type", "confidence_rating")
        .eq("user_id", student_id)
        .contains("event_data", {"lectureId": lecture_id})
        .order("created_at")
    )
    conf_by_slide: Dict[str, str] = {}
    for ev in conf_events:  # ascending → latest rating wins
        ed = ev.get("event_data") or {}
        sid = ed.get("slideId")
        if sid and ed.get("rating"):
            conf_by_slide[sid] = ed.get("rating")

    quiz_questions = (
        analytics_service._fetch_all_in(
            lambda: client.table("quiz_questions").select("id, slide_id"), "slide_id", slide_ids
        )
        if slide_ids
        else []
    )
    qid_to_slide = {q["id"]: q["slide_id"] for q in quiz_questions}

    quiz_events = analytics_service._fetch_all(
        client.table("learning_events")
        .select("event_data")
        .eq("event_type", "quiz_attempt")
        .eq("user_id", student_id)
        .contains("event_data", {"lectureId": lecture_id})
    )
    quiz_by_slide: Dict[str, bool] = {}
    for ev in quiz_events:  # first attempt only
        ed = ev.get("event_data") or {}
        sid = qid_to_slide.get(ed.get("questionId"))
        if sid and sid not in quiz_by_slide:
            quiz_by_slide[sid] = bool(ed.get("correct"))

    ai_events = analytics_service._fetch_all(
        client.table("learning_events")
        .select("event_data")
        .eq("event_type", "ai_tutor_query")
        .eq("user_id", student_id)
        .contains("event_data", {"lectureId": lecture_id})
    )
    ai_slides = {ev.get("event_data", {}).get("slideId") for ev in ai_events}

    steps = []
    for s in slides:
        sid = s["id"]
        steps.append(
            {
                "slideNumber": s["slide_number"],
                "title": s.get("title") or f"Slide {s['slide_number']}",
                "dwellSeconds": round(dwell_by_slide.get(sid, 0.0), 1),
                "confidence": conf_by_slide.get(sid),
                "quizCorrect": quiz_by_slide.get(sid),
                "askedAi": sid in ai_slides,
            }
        )

    return {"kind": STUDENT_JOURNEY, "steps": steps}


def get_evidence(
    kind: str,
    lecture_id: str,
    *,
    slide_id: Optional[str] = None,
    student_id: Optional[str] = None,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """Dispatch to the right evidence fetcher by kind."""
    if kind == AI_QUERIES:
        if not slide_id:
            raise ValueError("ai_queries evidence requires slideId")
        return get_ai_queries_evidence(lecture_id, slide_id, token)
    if kind == CONFIDENCE_BREAKDOWN:
        if not slide_id:
            raise ValueError("confidence_breakdown evidence requires slideId")
        return get_confidence_breakdown_evidence(lecture_id, slide_id, token)
    if kind == STUDENT_JOURNEY:
        if not student_id:
            raise ValueError("student_journey evidence requires studentId")
        return get_student_journey_evidence(lecture_id, student_id, token)
    raise ValueError(f"Unknown evidence kind: {kind}")
