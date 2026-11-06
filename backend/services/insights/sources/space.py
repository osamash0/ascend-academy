"""A Space's activity, read once on the server for the owner's view.

Everything the owner's view says is computed from what this returns: the
Space's Lessons, its members (the owner left out, whatever their rows say)
and those members' learning events on those Lessons over the last eight
weeks. Service-role SQL, never the owner's own session: the owner never
reads a member's rows, only the aggregates built from them (spec §0).
"""
from __future__ import annotations

import json
import logging
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from backend.core.database import get_db_connection

logger = logging.getLogger(__name__)

#: How far back the owner's view looks: its figures draw eight weeks.
WINDOW_DAYS = 56
#: The most events one read takes, the newest; past it the oldest are not read (and a warning says so).
EVENT_CAP = 200_000
#: The most events one member adds to a read, their newest. A member can write any number of their
#: own rows, so without this one account could push every other member's events out of the cap.
PER_MEMBER_CAP = 5_000
#: The most earlier questions one read takes (distinct questions, not events); past it a warning says so.
TRIED_CAP = 200_000

#: The highest page number a reader can name: the reader API's own bound
#: (`v4_reader._Reading.page le=2000`). An event is a member's own insert, so a
#: page beyond it is forged, not read; counting it would let one member size a list.
MAX_PAGE = 2000

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
    #: The `try_key` of every question a member answered *before* the window: not a first try inside it.
    tried_before: frozenset[tuple] = frozenset()


def valid_page(value: Any) -> Optional[int]:
    """A page number a reader could have named, else None."""
    return value if isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= MAX_PAGE else None


def try_key(user_id: str, event_type: str, d: dict[str, Any]) -> Optional[tuple]:
    """Which question an attempt answers, or None when it is no try (a teach-back, or not an attempt).

    One person, one Lesson, one question: the same key names the same question wherever it is
    read, inside the window (`first_tries`) or before it (`tried_before`), so the two never drift.
    """
    lesson = str(d.get("lectureId") or "")
    if event_type == "quiz_attempt":
        return (user_id, lesson, "q", str(d.get("questionId") or ""))
    if event_type == "checkpoint_attempt" and d.get("kind") != "teach":
        # A served checkpoint numbers its questions only 1 and 2, so the
        # number alone names no question: the page always goes in the key.
        question = d.get("questionId") if d.get("questionId") is not None else d.get("kind")
        return (user_id, lesson, "c", str(d.get("idea") or ""), valid_page(d.get("page")), str(question))
    return None


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
ORDER BY l.created_at, l.id
"""

_SLIDES_SQL = "SELECT id::text AS id, slide_number FROM slides WHERE lecture_id = ANY($1::uuid[])"

_QUESTIONS_SQL = """
SELECT q.id::text AS id, s.slide_number
FROM quiz_questions q
JOIN slides s ON s.id = q.slide_id
WHERE s.lecture_id = ANY($1::uuid[])
"""

# A member writes their own events: any key, any length. The read takes only the keys the
# engine reads, each bounded, so no payload can size what the owner's view holds.
#: Read as JSON (a number stays a number, a boolean a boolean). No real value is longer than an
#: id (36 characters); a longer one is no event's, and is dropped (Python will not even parse an
#: integer past 4300 digits, so one such page would otherwise fail the owner's whole view).
_KEPT = (
    "page", "slideId", "duration_seconds", "kind", "rating", "questionId", "correct",
    "fromPage", "toPage", "fromSlideId", "toSlideId",
)
_KEPT_MAX = 64
#: Free text, cut short: the session, the idea, and only from an `ai_tutor_query` the question.
_CUT = {"sessionId": 64, "idea": 60}
QUERY_MAX = 300

_EVENT_DATA = ",\n    ".join(
    ["'lectureId', event_data->'lectureId'"]
    + [f"'{k}', CASE WHEN length(event_data->>'{k}') <= {_KEPT_MAX} THEN event_data->'{k}' END" for k in _KEPT]
    + [f"'{k}', left(event_data->>'{k}', {n})" for k, n in _CUT.items()]
    + [f"'query', CASE WHEN event_type = 'ai_tutor_query' THEN left(event_data->>'query', {QUERY_MAX}) END"]
)

_EVENTS_SQL = f"""
WITH ranked AS (
  SELECT user_id, event_type, created_at, event_data,
         row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
  FROM learning_events
  WHERE created_at >= $1
    AND created_at <= $2
    AND event_type = ANY($3::text[])
    AND user_id = ANY($4::uuid[])
    AND event_data->>'lectureId' = ANY($5::text[])
)
SELECT user_id::text AS user_id, event_type, created_at,
  jsonb_strip_nulls(jsonb_build_object(
    {_EVENT_DATA}
  )) AS event_data
FROM ranked
WHERE rn <= $7
ORDER BY created_at DESC
LIMIT $6
"""

# Before the window: the same questions, answered earlier. Only the fields `try_key` reads, cut as the
# main read cuts them (so the keys agree), DISTINCT so a member's replays cost one row.
_TRIED_DATA = ",\n    ".join(
    ["'lectureId', event_data->'lectureId'"]
    + [f"'{k}', CASE WHEN length(event_data->>'{k}') <= {_KEPT_MAX} THEN event_data->'{k}' END" for k in ("page", "kind", "questionId")]
    + [f"'idea', left(event_data->>'idea', {_CUT['idea']})"]
)

_TRIED_SQL = f"""
SELECT DISTINCT user_id::text AS user_id, event_type,
  jsonb_strip_nulls(jsonb_build_object(
    {_TRIED_DATA}
  )) AS event_data
FROM learning_events
WHERE created_at < $1
  AND event_type = ANY($2::text[])
  AND user_id = ANY($3::uuid[])
  AND event_data->>'lectureId' = ANY($4::text[])
LIMIT $5
"""
TRIED_TYPES = ("quiz_attempt", "checkpoint_attempt")


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
    tried_before: frozenset[tuple] = frozenset()
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
                _EVENTS_SQL, now - timedelta(days=WINDOW_DAYS), now, list(EVENT_TYPES), list(members), ids,
                EVENT_CAP, PER_MEMBER_CAP,
            )
            if len(rows) >= EVENT_CAP:
                logger.warning("landing: space %s hit the event cap (%d); its oldest events are not read", space_id, EVENT_CAP)
            capped = sum(1 for n in Counter(r["user_id"] for r in rows).values() if n >= PER_MEMBER_CAP)
            if capped:
                logger.warning(
                    "landing: space %s: %d member(s) hit the per-member cap (%d); their oldest events are not read",
                    space_id, capped, PER_MEMBER_CAP,
                )
            # Read newest first so the cap keeps the newest; held oldest first.
            events = tuple(
                Event(user_id=r["user_id"], type=r["event_type"], data=_json(r["event_data"]), at=r["created_at"])
                for r in reversed(rows)
            )
            earlier = await conn.fetch(
                _TRIED_SQL, now - timedelta(days=WINDOW_DAYS), list(TRIED_TYPES), list(members), ids, TRIED_CAP
            )
            if len(earlier) >= TRIED_CAP:
                logger.warning("landing: space %s hit the earlier-tries cap (%d); some are not read", space_id, TRIED_CAP)
            tried_before = frozenset(
                k for r in earlier
                if (k := try_key(r["user_id"], r["event_type"], _json(r["event_data"]))) is not None
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
        tried_before=tried_before,
    )
