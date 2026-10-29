"""A Space's activity, read once: its Lessons, its members (never the owner), their last eight weeks."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.db
asyncpg = pytest.importorskip("asyncpg")


def _event(db_conn, user_id, event_type, data):
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.learning_events (user_id, event_type, event_data) VALUES (%s, %s, %s::jsonb)",
            (str(user_id), event_type, json.dumps(data)),
        )


async def test_a_space_reads_its_members_on_its_lessons_and_nothing_else(
    throwaway_db, db_conn, make_user, make_course, make_lecture, make_slide, make_course_enrollment,
):
    from backend.services.insights.sources.space import load_space_data

    tag = uuid.uuid4().hex[:6]
    owner = make_user(email=f"owner-{tag}@gmail.com")
    member = make_user(email=f"member-{tag}@gmail.com")
    outsider = make_user(email=f"outsider-{tag}@gmail.com")
    space = make_course(owner, title=f"DBS {tag}")
    other_space = make_course(owner, title=f"Other {tag}")
    first = make_lecture(owner, title="Normalization")
    second = make_lecture(owner, title="Joins")
    archived = make_lecture(owner, title="Old")
    elsewhere = make_lecture(owner, title="Elsewhere")
    with db_conn.cursor() as cur:
        cur.execute("UPDATE lectures SET course_id = %s, total_slides = 12 WHERE id IN (%s, %s, %s)",
                    (str(space), str(first), str(second), str(archived)))
        cur.execute("UPDATE lectures SET is_archived = true WHERE id = %s", (str(archived),))
        cur.execute("UPDATE lectures SET course_id = %s WHERE id = %s", (str(other_space), str(elsewhere)))
    slide = make_slide(first, slide_number=3)
    make_course_enrollment(member, space)
    make_course_enrollment(owner, space)  # an owner who joined their own Space is still not a member
    make_course_enrollment(outsider, other_space)

    view = {"lectureId": str(first), "slideId": str(slide), "duration_seconds": 30, "sessionId": "s",
            "timestamp": "2026-10-29T00:00:00Z"}
    _event(db_conn, member, "slide_view", view)
    _event(db_conn, owner, "slide_view", view)
    _event(db_conn, outsider, "slide_view", view)
    _event(db_conn, member, "slide_view", {**view, "lectureId": str(elsewhere)})
    _event(db_conn, member, "lecture_complete", {"lectureId": str(first), "sessionId": "s", "completed_at": "x"})

    data = await load_space_data(space, "DBS", str(owner))

    assert data.members == frozenset({str(member)})
    assert [(l.title, l.order, l.pages) for l in data.lessons] == [("Normalization", 1, 12), ("Joins", 2, 12)]
    assert [(e.user_id, e.type, e.data["lectureId"]) for e in data.events] == [(str(member), "slide_view", str(first))]
    assert data.slide_pages[str(slide)] == 3

    later = await load_space_data(space, "DBS", str(owner), now=datetime.now(timezone.utc) + timedelta(days=60))
    assert later.events == ()
