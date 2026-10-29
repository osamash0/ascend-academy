"""The three figures: readers this week, pages landing, checkpoints cleared first try — with eight weeks."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from backend.services.insights.figures import figures
from backend.services.insights.sources.space import Event, LessonRow, SpaceData

NOW = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
L1 = "l1"


def ev(user, event_type, days_ago, **data):
    return Event(user_id=user, type=event_type, data={"lectureId": L1, **data}, at=NOW - timedelta(days=days_ago))


def space(*events):
    return SpaceData(
        space_id="s", name="DBS", owner_id="o", members=frozenset(f"m{i}" for i in range(20)),
        lessons=(LessonRow(id=L1, title="N", order=1, pages=12),), events=tuple(events),
        slide_pages={}, question_pages={}, now=NOW,
    )


def read(user, days_ago, page=1):
    return ev(user, "slide_view", days_ago, page=page, duration_seconds=30, sessionId=user)


def test_reading_counts_members_who_read_each_week():
    data = space(*[read(f"m{i}", 1) for i in range(6)], *[read(f"m{i}", 9) for i in range(3)], read("m0", 2))
    reading = figures(data, 5)["reading"]
    assert reading == {"value": 6, "history": [0, 0, 0, 0, 0, 0, 3, 6]}


def test_under_the_floor_only_reading_is_real():
    out = figures(space(*[read(f"m{i}", 1) for i in range(4)]), 5)
    assert out["reading"]["value"] == 4
    assert out["landing"] == {"value": 0, "history": []} and out["cleared"] == {"value": 0, "history": []}


def test_a_page_lands_when_fewer_than_one_in_five_of_its_readers_needed_it():
    week = [read(f"m{i}", 1, page=1) for i in range(10)] + [read(f"m{i}", 1, page=2) for i in range(10)]
    help_on_2 = [ev(f"m{i}", "ai_tutor_query", 1, page=2, kind="ask", query="?") for i in range(3)]
    one_on_1 = [ev("m0", "confidence_rating", 1, page=1, rating="confused")]
    out = figures(space(*week, *help_on_2, *one_on_1), 5)
    assert out["landing"]["value"] == 50 and len(out["landing"]["history"]) == 8


def test_cleared_is_first_tries_at_checkpoint_questions_once_enough_people_tried():
    reads = [read(f"m{i}", 1) for i in range(6)]
    tries = [
        ev(f"m{i}", "checkpoint_attempt", 1, page=9, idea="J", kind="choice", questionId=1, correct=i < 4)
        for i in range(5)
    ]
    retry = [ev("m4", "checkpoint_attempt", 0, page=9, idea="J", kind="choice", questionId=1, correct=True)]
    teach = [ev("m5", "checkpoint_attempt", 1, page=4, idea="J", kind="teach", correct=False)]
    assert figures(space(*reads, *tries, *retry, *teach), 5)["cleared"]["value"] == 80
