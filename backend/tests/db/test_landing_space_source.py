"""A Space's activity, read once: its Lessons, its members (never the owner), their last eight weeks."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.db
asyncpg = pytest.importorskip("asyncpg")


def _event(db_conn, user_id, event_type, data, seconds_ago=0):
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.learning_events (user_id, event_type, event_data, created_at) "
            "VALUES (%s, %s, %s::jsonb, now() - make_interval(secs => %s))",
            (str(user_id), event_type, json.dumps(data), seconds_ago),
        )


def _space_with_a_member(db_conn, make_user, make_course, make_lecture, make_course_enrollment):
    tag = uuid.uuid4().hex[:6]
    owner = make_user(email=f"owner-{tag}@gmail.com")
    member = make_user(email=f"member-{tag}@gmail.com")
    space = make_course(owner, title=f"DBS {tag}")
    lesson = make_lecture(owner, title="Normalization")
    with db_conn.cursor() as cur:
        cur.execute("UPDATE lectures SET course_id = %s, total_slides = 12 WHERE id = %s", (str(space), str(lesson)))
    make_course_enrollment(member, space)
    return owner, member, space, lesson


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


async def test_an_event_brings_only_what_the_engine_reads_and_no_long_text(
    throwaway_db, db_conn, make_user, make_course, make_lecture, make_course_enrollment,
):
    # A member writes their own events: any key, any length. The read takes only the engine's keys, cut short.
    from backend.services.insights.sources.space import load_space_data

    owner, member, space, lesson = _space_with_a_member(db_conn, make_user, make_course, make_lecture, make_course_enrollment)
    lid = str(lesson)
    _event(db_conn, member, "ai_tutor_query", {
        "lectureId": lid, "page": 3, "kind": "ask", "query": "q" * 10_000,
        "sessionId": "s" * 500, "secret": "never read", "blob": ["x"] * 1000,
    }, seconds_ago=30)
    _event(db_conn, member, "confidence_rating", {
        "lectureId": lid, "page": 3, "rating": "confused", "idea": "i" * 500, "query": "not a question",
    }, seconds_ago=20)
    _event(db_conn, member, "checkpoint_attempt", {
        "lectureId": lid, "page": 3, "idea": "Joins", "kind": "choice", "questionId": 1, "correct": True,
        "slideId": None,
    }, seconds_ago=10)

    data = await load_space_data(space, "DBS", str(owner))
    ask, rating, check = data.events

    assert len(ask.data["query"]) == 300 and len(ask.data["sessionId"]) == 64
    assert "secret" not in ask.data and "blob" not in ask.data
    assert "query" not in rating.data and len(rating.data["idea"]) == 60
    # JSON types are kept: a page is a number, a result a boolean; a null is no key at all.
    assert ask.data["page"] == 3 and check.data["questionId"] == 1 and check.data["correct"] is True
    assert "slideId" not in check.data
    assert set(check.data) == {"lectureId", "page", "idea", "kind", "questionId", "correct"}


async def test_a_value_no_reader_could_write_is_not_read_and_breaks_nothing(
    throwaway_db, db_conn, make_user, make_course, make_lecture, make_course_enrollment,
):
    # Python will not parse an integer of more than 4300 digits: one such page would fail the owner's
    # whole view. A kept key longer than any real id or number is a member's own insert, and is dropped.
    from backend.services.insights.sources.space import load_space_data

    owner, member, space, lesson = _space_with_a_member(db_conn, make_user, make_course, make_lecture, make_course_enrollment)
    raw = '{"lectureId": "%s", "page": %s, "slideId": "%s", "duration_seconds": 30}' % (lesson, "1" * 5000, "s" * 5000)
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.learning_events (user_id, event_type, event_data) VALUES (%s, 'slide_view', %s::jsonb)",
            (str(member), raw),
        )

    data = await load_space_data(space, "DBS", str(owner))

    (view,) = data.events
    assert view.data == {"lectureId": str(lesson), "duration_seconds": 30}


async def test_the_read_stops_at_its_cap_keeping_the_newest_oldest_first(
    throwaway_db, db_conn, make_user, make_course, make_lecture, make_course_enrollment, monkeypatch, caplog,
):
    import backend.services.insights.sources.space as source

    owner, member, space, lesson = _space_with_a_member(db_conn, make_user, make_course, make_lecture, make_course_enrollment)
    for page, ago in ((1, 30), (2, 20), (3, 10)):
        _event(db_conn, member, "slide_view",
               {"lectureId": str(lesson), "page": page, "duration_seconds": 30, "sessionId": "s"}, seconds_ago=ago)
    monkeypatch.setattr(source, "EVENT_CAP", 2)

    with caplog.at_level("WARNING", logger=source.__name__):
        data = await source.load_space_data(space, "DBS", str(owner))

    assert [e.data["page"] for e in data.events] == [2, 3]
    assert "cap" in caplog.text


async def test_lessons_added_at_one_moment_keep_one_order_in_the_space_and_its_landing(
    throwaway_db, db_conn, make_user, make_course, make_course_enrollment,
):
    # A batch upload adds Lessons in one statement: the same created_at. Both reads break the tie by id.
    import backend.services.v4_spaces_service as spaces
    from backend.services.insights.sources.space import load_space_data

    tag = uuid.uuid4().hex[:6]
    owner = make_user(email=f"owner-{tag}@gmail.com")
    member = make_user(email=f"member-{tag}@gmail.com")
    space = make_course(owner, title=f"DBS {tag}")
    make_course_enrollment(member, space)
    low, high = sorted(uuid.uuid4() for _ in range(2))
    with db_conn.cursor() as cur:
        for lid, title in ((high, "Added first, id last"), (low, "Added second, id first")):
            cur.execute(
                "INSERT INTO public.lectures (id, title, professor_id, total_slides, course_id, created_at) "
                "VALUES (%s, %s, %s, 4, %s, '2026-10-01T10:00:00Z')",
                (str(lid), title, str(owner), str(space)),
            )

    data = await load_space_data(space, "DBS", str(owner))
    world = await spaces.get_world(str(member))

    assert [(l.id, l.order) for l in data.lessons] == [(str(low), 1), (str(high), 2)]
    assert [(l["id"], l["order"]) for l in world["lessons"] if l["spaceId"] == str(space)] == [(str(low), 1), (str(high), 2)]
