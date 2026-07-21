"""
Event repository — all database access for learning events and analytics.
Provides typed query helpers so services don't embed raw PostgREST chains.
"""
from __future__ import annotations
from typing import Any
from supabase import Client

from backend.schemas.learning_events import validate_event


def insert_event(client: Client, user_id: str, event_type: str, event_data: dict[str, Any]) -> None:
    """Insert a learning_events row via the shared backend write boundary.

    Validates `event_data` against the P5-1 event registry
    (backend/schemas/learning_events.py) before writing. An unknown
    event_type raises `UnknownEventTypeError`; a payload that doesn't match
    its type's schema raises `pydantic.ValidationError`. Both are backed by
    the `event_type` CHECK constraint on the table itself, which is the only
    enforcement point for writers that don't go through this function (e.g.
    the frontend's direct-to-Supabase `logLearningEvent()`).
    """
    validate_event(event_type, event_data)
    client.table("learning_events").insert(
        {"user_id": user_id, "event_type": event_type, "event_data": event_data}
    ).execute()
    # Cheap "mark dirty" for the per-lecture analytics cache so the next
    # dashboard load recomputes against fresh data. Imported lazily to
    # avoid a circular import (analytics_cache → core.database → …).
    lecture_id = (event_data or {}).get("lectureId") or (event_data or {}).get("lecture_id")
    if lecture_id:
        try:
            from backend.services import analytics_cache
            analytics_cache.invalidate(str(lecture_id))
        except Exception:
            pass


def get_events_for_lecture(
    client: Client,
    event_type: str,
    lecture_id: str,
    limit: int = 5000,
) -> list[dict[str, Any]]:
    """Fetch all events of a given type that contain the lecture_id in event_data."""
    return (
        client.table("learning_events")
        .select("event_data")
        .eq("event_type", event_type)
        .contains("event_data", {"lectureId": lecture_id})
        .limit(limit)
        .execute()
        .data
        or []
    )


def get_student_progress_for_lecture(
    client: Client,
    lecture_id: str,
    limit: int = 2000,
) -> list[dict[str, Any]]:
    return (
        client.table("student_progress")
        .select("user_id, completed_at, quiz_score, correct_answers, total_questions_answered, completed_slides")
        .eq("lecture_id", lecture_id)
        .limit(limit)
        .execute()
        .data
        or []
    )


def get_mind_map(client: Client, lecture_id: str) -> dict[str, Any] | None:
    res = (
        client.table("lecture_mind_maps")
        .select("tree_data")
        .eq("lecture_id", lecture_id)
        .single()
        .execute()
    )
    return res.data


def upsert_mind_map(client: Client, lecture_id: str, tree_data: dict[str, Any]) -> None:
    client.table("lecture_mind_maps").upsert(
        {"lecture_id": lecture_id, "tree_data": tree_data},
        on_conflict="lecture_id",
    ).execute()
