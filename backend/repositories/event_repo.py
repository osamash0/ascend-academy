"""
Event repository — all database access for learning events and analytics.
Provides typed query helpers so services don't embed raw PostgREST chains.
"""
from __future__ import annotations
from typing import Any
from supabase import Client


def insert_event(client: Client, user_id: str, event_type: str, event_data: dict[str, Any]) -> None:
    client.table("learning_events").insert(
        {"user_id": user_id, "event_type": event_type, "event_data": event_data}
    ).execute()


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
        .select("map_data")
        .eq("lecture_id", lecture_id)
        .single()
        .execute()
    )
    return res.data


def upsert_mind_map(client: Client, lecture_id: str, map_data: dict[str, Any]) -> None:
    client.table("lecture_mind_maps").upsert(
        {"lecture_id": lecture_id, "map_data": map_data},
        on_conflict="lecture_id",
    ).execute()
