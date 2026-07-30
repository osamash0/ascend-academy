"""
Event repository — all database access for learning events and analytics.
Provides typed query helpers so services don't embed raw PostgREST chains.
"""
from __future__ import annotations
import logging
from typing import Any
from supabase import Client

from backend.schemas.learning_events import validate_event

logger = logging.getLogger(__name__)


async def insert_event(client: Client, user_id: str, event_type: str, event_data: dict[str, Any]) -> None:
    """Write a ``learning_events`` row and, if it carries a lecture id,
    enqueue an out-of-band analytics-cache rollup for it.

    P5-1: validates `event_data` against the event registry
    (backend/schemas/learning_events.py) before writing. An unknown
    event_type raises `UnknownEventTypeError`; a payload that doesn't match
    its type's schema raises `pydantic.ValidationError`. Both are backed by
    the `event_type` CHECK constraint on the table itself, which is the only
    enforcement point for writers that don't go through this function (e.g.
    the frontend's direct-to-Supabase `logLearningEvent()`).

    P5-3: this used to call ``analytics_cache.invalidate(lecture_id)``
    *inline* here — a second synchronous Supabase round-trip (a DELETE)
    stacked directly on top of the event INSERT, on every single event
    write, duplicating what the DB's `trg_invalidate_analytics_cache`
    trigger (`supabase/migrations/20260503000017_analytics_cache.sql`)
    already does cheaply at the DB layer. That coupled write-path latency
    to analytics bookkeeping. The invalidation is now a fire-and-forget
    Arq job (``rollup_analytics_cache``, see
    ``backend.services.analytics_rollup``) enqueued *after* the row lands,
    never awaited by the caller before the response is built.
    """
    validate_event(event_type, event_data)
    client.table("learning_events").insert(
        {"user_id": user_id, "event_type": event_type, "event_data": event_data}
    ).execute()

    lecture_id = (event_data or {}).get("lectureId") or (event_data or {}).get("lecture_id")
    if not lecture_id:
        return
    try:
        # Imported lazily to avoid a circular import
        # (upload_service → … → core.database → …) at module load time.
        from backend.services.upload_service import get_arq_pool

        pool = await get_arq_pool()
        await pool.enqueue_job("rollup_analytics_cache", lecture_id=str(lecture_id))
    except Exception:
        # Never let a queue hiccup fail the event write — the rollup is a
        # cache-freshness nicety, not correctness. It's still observable
        # (logged) and, when the queue itself is up, self-heals via Arq's
        # own retry (max_tries) on the next enqueue.
        logger.warning(
            "Failed to enqueue rollup_analytics_cache for lecture_id=%s", lecture_id, exc_info=True
        )


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
