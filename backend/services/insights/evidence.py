"""Layer-3 evidence — on-demand drill-down data for the Insight Garden.

Unlike the metric bundle (computed once per feed load), evidence is fetched
lazily: only when a professor opens a card's evidence drawer for a specific
slide. Each function returns a small, narrated-friendly payload —
never a raw table dump.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from backend.services import analytics_service

AI_QUERIES = "ai_queries"
CONFIDENCE_BREAKDOWN = "confidence_breakdown"

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
        # v4 reader questions reach owners only as themes over 5+ askers, never verbatim (spec §0).
        if ed.get("source") == "v4_reader":
            continue
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
    owner_id = analytics_service.lecture_owner_id(client, lecture_id)
    # People, not events: each person's latest rating, the owner's own reading left out.
    user_rating = analytics_service.people_ratings(conf_events, owner_id, slide_id).get(slide_id, {})

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
            if uid == owner_id:
                continue
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

    total = sum(quadrants.values())
    if total < analytics_service.MIN_PEOPLE:
        # Too few people to say anything: the empty shape the grid already renders as "not enough yet".
        quadrants = {k: 0 for k in quadrants}
        total = 0
    return {"kind": CONFIDENCE_BREAKDOWN, "quadrants": quadrants, "total": total}


def get_evidence(
    kind: str,
    lecture_id: str,
    *,
    slide_id: Optional[str] = None,
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
    raise ValueError(f"Unknown evidence kind: {kind}")
