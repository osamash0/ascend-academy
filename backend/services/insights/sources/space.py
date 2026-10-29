"""A Space's activity, read once on the server for the owner's view.

Everything the owner's view says is computed from what this returns: the
Space's Lessons, its members (the owner left out, whatever their rows say)
and those members' learning events on those Lessons over the last eight
weeks. Service-role SQL, never the owner's own session: the owner never
reads a member's rows, only the aggregates built from them (spec §0).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from backend.core.database import get_db_connection

#: How far back the owner's view looks: its figures draw eight weeks.
WINDOW_DAYS = 56

#: The events the engine reads. Luna writes none of these; her checks stay hers.
EVENT_TYPES = (
    "slide_view",
    "slide_back_navigation",
    "confidence_rating",
    "ai_tutor_query",
    "quiz_attempt",
    "checkpoint_attempt",
)


@dataclass(frozen=True)
class LessonRow:
    id: str
    title: str
    #: 1-based, in the order the Lessons were added (as the Space lists them).
    order: int
    #: Pages in the Lesson's document; 0 when unknown.
    pages: int


@dataclass(frozen=True)
class Event:
    user_id: str
    type: str
    data: dict[str, Any]
    at: datetime


@dataclass(frozen=True)
class SpaceData:
    space_id: str
    name: str
    owner_id: str
    members: frozenset[str]
    lessons: tuple[LessonRow, ...]
    #: Oldest first.
    events: tuple[Event, ...]
    #: slides.id → page, for events that name a slide and no page (the old reader).
    slide_pages: dict[str, int]
    #: quiz_questions.id → the page its slide is on.
    question_pages: dict[str, int]
    now: datetime


_MEMBERS_SQL = """
SELECT e.user_id::text AS user_id
FROM course_enrollments e
JOIN courses c ON c.id = e.course_id
WHERE e.course_id = $1 AND e.user_id <> c.professor_id
"""

_LESSONS_SQL = """
SELECT l.id::text AS id, l.title, COALESCE(l.total_slides, 0) AS pages
FROM lectures l
WHERE l.course_id = $1
  AND NOT COALESCE(l.is_archived, false)
  AND COALESCE(l.visibility, 'course') = 'course'
ORDER BY l.created_at
"""

_SLIDES_SQL = "SELECT id::text AS id, slide_number FROM slides WHERE lecture_id = ANY($1::uuid[])"

_QUESTIONS_SQL = """
SELECT q.id::text AS id, s.slide_number
FROM quiz_questions q
JOIN slides s ON s.id = q.slide_id
WHERE s.lecture_id = ANY($1::uuid[])
"""

_EVENTS_SQL = """
SELECT user_id::text AS user_id, event_type, event_data, created_at
FROM learning_events
WHERE created_at >= $1
  AND created_at <= $2
  AND event_type = ANY($3::text[])
  AND user_id = ANY($4::uuid[])
  AND event_data->>'lectureId' = ANY($5::text[])
ORDER BY created_at
"""


def _json(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    return value if isinstance(value, dict) else {}


async def load_space_data(
    space_id: UUID, name: str, owner_id: str, *, now: Optional[datetime] = None
) -> SpaceData:
    """Read the Space once. ``now`` fixes the window's end (tests move it)."""
    now = now or datetime.now(timezone.utc)
    slide_pages: dict[str, int] = {}
    question_pages: dict[str, int] = {}
    events: tuple[Event, ...] = ()
    async with await get_db_connection() as conn:
        members = frozenset(r["user_id"] for r in await conn.fetch(_MEMBERS_SQL, space_id)) - {owner_id}
        lessons = tuple(
            LessonRow(id=r["id"], title=r["title"] or "", order=i + 1, pages=int(r["pages"] or 0))
            for i, r in enumerate(await conn.fetch(_LESSONS_SQL, space_id))
        )
        ids = [lesson.id for lesson in lessons]
        if ids:
            slide_pages = {
                r["id"]: int(r["slide_number"])
                for r in await conn.fetch(_SLIDES_SQL, ids)
                if r["slide_number"] is not None
            }
            question_pages = {
                r["id"]: int(r["slide_number"])
                for r in await conn.fetch(_QUESTIONS_SQL, ids)
                if r["slide_number"] is not None
            }
        if ids and members:
            rows = await conn.fetch(
                _EVENTS_SQL, now - timedelta(days=WINDOW_DAYS), now, list(EVENT_TYPES), list(members), ids
            )
            events = tuple(
                Event(user_id=r["user_id"], type=r["event_type"], data=_json(r["event_data"]), at=r["created_at"])
                for r in rows
            )
    return SpaceData(
        space_id=str(space_id),
        name=name,
        owner_id=owner_id,
        members=members,
        lessons=lessons,
        events=events,
        slide_pages=slide_pages,
        question_pages=question_pages,
        now=now,
    )
