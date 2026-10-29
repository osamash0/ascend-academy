"""How it's landing — the owner's view of a Space, computed on the server.

Who may open it is decided first (`assert_space_owner`); then the Space's
activity is read once, folded into facts, run through the insight engine,
floored and translated into the `Landing` shape. Nothing in the payload
names a member or quotes one (spec §0). Cached per Space for five minutes.
`accent` and each Lesson's `color` are left to the app (Plan 3 draws them from
the Lesson's order until a sampled hue is stored at ingest); `questions` arrive
with the questions channel (Plan 4).
"""
from __future__ import annotations

from typing import Any, Optional
from uuid import UUID

from backend.core.database import get_db_connection
from backend.domain.authorization import assert_space_owner
from backend.services import analytics_cache
from backend.services.insights.figures import figures
from backend.services.insights.landing_map import collapse_healthy, help_index, lesson_light, rank, to_landing
from backend.services.insights.people import journey, strugglers
from backend.services.insights.sources.space import SpaceData, load_space_data
from backend.services.insights.space_engine import MIN_READERS, lesson_insights
from backend.services.insights.space_facts import LessonFacts, lesson_facts
from backend.services.insights.themes import themes_for
from backend.services.v4_personal import is_personal

_SPACE_SQL = """
SELECT c.id, c.title, c.professor_id,
       EXISTS (SELECT 1 FROM course_enrollments e
               WHERE e.course_id = c.id AND e.user_id = $2::uuid) AS is_member
FROM courses c
WHERE c.id = $1
"""


async def space_row(space_id: UUID, user_id: str) -> Optional[dict[str, Any]]:
    """The Space's owner and whether the caller belongs to it; None for the
    caller's personal Space (no owner's view) or a Space that does not exist."""
    if is_personal(space_id, user_id):
        return None
    async with await get_db_connection() as conn:
        row = await conn.fetchrow(_SPACE_SQL, space_id, user_id)
    return dict(row) if row else None


LANDING_VERSION = "landing-v1"
LANDING_TTL = 300
#: Themes are made for at most this many pages per Space at a time, the most-asked first.
THEMES_PAGES = 5


async def get_landing(space_id: UUID, user_id: str, lang: str) -> dict[str, Any]:
    """The owner's view of their Space; 403 for a member, 404 for anyone else."""
    row = await space_row(space_id, user_id)
    assert_space_owner(row, user_id)

    async def compute() -> dict[str, Any]:
        data = await load_space_data(space_id, row["title"] or "", str(row["professor_id"]))
        return await landing_from(data, lang)

    return await analytics_cache.get_or_compute_async(
        str(space_id), "landing", compute, params={"lang": lang, "v": LANDING_VERSION}, ttl_seconds=LANDING_TTL
    )


def _within(found: list[dict[str, Any]], pages: int) -> list[dict[str, Any]]:
    """Findings about pages the Lesson has. Events are members' own inserts, so a few of them
    could otherwise place a card on page 1999 of a four-page Lesson; unknown pages (0) filter nothing."""
    if pages <= 0:
        return found
    return [i for i in found if i.get("last", i.get("page", 0)) <= pages]


async def landing_from(data: SpaceData, lang: str) -> dict[str, Any]:
    """The `Landing` payload (without `accent` and `lessons[].color`) from a Space's activity."""
    facts = lesson_facts(data)
    readers = len(set().union(*(lf.readers for lf in facts.values())))
    above = readers >= MIN_READERS
    helps = help_index(facts)

    lessons: list[dict[str, Any]] = []
    found_all: list[dict[str, Any]] = []
    for lesson in data.lessons:
        lf = facts[lesson.id]
        found: list[dict[str, Any]] = []
        if above:
            mapped = [x for x in (to_landing(i, lf) for i in lesson_insights(lf)) if x]
            found = collapse_healthy(_within(mapped, lesson.pages), lesson.id)
        found_all += found
        entry: dict[str, Any] = {
            "id": lesson.id,
            "title": lesson.title,
            "order": lesson.order,
            "pages": lesson.pages,
            "readers": len(lf.readers),
            "light": lesson_light(found, len(lf.readers)) if above else "few",
        }
        if above and len(lf.readers) >= MIN_READERS:
            entry["help"] = helps[lesson.id]
        lessons.append(entry)

    ranked = rank(found_all, {lesson.id: len(facts[lesson.id].readers) for lesson in data.lessons})
    themes = await _themes(data, facts, lang) if above else []
    lit = {(t["lessonId"], t["page"]) for t in themes}
    for insight in ranked:
        if insight["kind"] == "confusion_hotspot":
            insight["themes"] = (insight["lessonId"], insight.get("page")) in lit

    return {
        "spaceId": data.space_id,
        "spaceName": data.name,
        "members": len(data.members),
        "readers": readers,
        "floor": MIN_READERS,
        "figures": figures(data, MIN_READERS),
        "lessons": lessons,
        "insights": ranked,
        "questions": [],
        "themes": themes,
    }


async def _themes(data: SpaceData, facts: dict[str, LessonFacts], lang: str) -> list[dict[str, Any]]:
    """Themes for the most-asked-about pages (at least the floor's worth of askers)."""
    hot = sorted(
        (
            (len(pf.ask), lf.lesson.id, page, pf)
            for lf in facts.values()
            for page, pf in lf.pages.items()
            if len(pf.ask) >= MIN_READERS
        ),
        key=lambda x: x[0],
        reverse=True,
    )[:THEMES_PAGES]
    out: list[dict[str, Any]] = []
    for askers, lesson_id, page, pf in hot:
        found = await themes_for(
            space_id=data.space_id, owner_id=data.owner_id, lesson_id=lesson_id,
            page=page, texts=pf.ask_texts, askers=askers, lang=lang,
        )
        if found:
            out.append({"lessonId": lesson_id, "page": page, "askers": askers, "themes": found})
    return out


async def get_people(space_id: UUID, user_id: str, salt: str) -> dict[str, Any]:
    """Strugglers by per-Space pseudonym (flag-only; not cached)."""
    row = await space_row(space_id, user_id)
    assert_space_owner(row, user_id)
    data = await load_space_data(space_id, row["title"] or "", str(row["professor_id"]))
    return {"strugglers": strugglers(data, salt)}


async def get_journey(space_id: UUID, user_id: str, salt: str, person: str, lesson_id: str) -> Optional[list]:
    """One pseudonym's way through one Lesson (flag-only); None when not found."""
    row = await space_row(space_id, user_id)
    assert_space_owner(row, user_id)
    data = await load_space_data(space_id, row["title"] or "", str(row["professor_id"]))
    return journey(data, salt, person, lesson_id)
