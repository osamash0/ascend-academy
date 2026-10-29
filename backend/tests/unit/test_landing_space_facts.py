"""Which events count, decided once: sittings, the latest check-in, the first try, the old reader's slides."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from backend.services.insights.sources.space import Event, LessonRow, SpaceData
from backend.services.insights.space_facts import first_tries, lesson_facts

T0 = datetime(2026, 10, 20, 10, 0, tzinfo=timezone.utc)
L1 = "lesson-1"


def ev(user, event_type, minute=0, **data):
    return Event(user_id=user, type=event_type, data={"lectureId": L1, **data}, at=T0 + timedelta(minutes=minute))


def space(*events, slide_pages=None, question_pages=None):
    return SpaceData(
        space_id="space", name="DBS", owner_id="owner", members=frozenset({"a", "b", "c"}),
        lessons=(LessonRow(id=L1, title="Normalization", order=1, pages=12),),
        events=tuple(events), slide_pages=slide_pages or {}, question_pages=question_pages or {},
        now=T0 + timedelta(days=1),
    )


def test_a_sitting_is_one_persons_session_on_one_page_and_a_tab_left_open_is_not_reading():
    facts = lesson_facts(space(
        ev("a", "slide_view", 0, page=3, duration_seconds=20, sessionId="s1"),
        ev("a", "slide_view", 5, page=3, duration_seconds=15, sessionId="s1"),
        ev("a", "slide_view", 9, page=3, duration_seconds=30, sessionId="s2"),
        ev("b", "slide_view", 1, page=3, duration_seconds=2000, sessionId="s3"),
    ))[L1]
    page = facts.pages[3]
    assert sorted(page.sittings) == [30.0, 35.0]
    assert page.readers == {"a", "b"} and facts.readers == {"a", "b"}


def test_a_page_no_reader_could_name_is_forged_and_makes_no_page():
    # A member's own insert can say any page; the reader API stops at 2000, so a page past that was never read.
    facts = lesson_facts(space(
        ev("a", "slide_view", 0, page=3, duration_seconds=20, sessionId="s1"),
        ev("a", "slide_view", 1, page=2_000_000_000, duration_seconds=20, sessionId="s1"),
        ev("b", "ai_tutor_query", 2, page=2_000_000_000, kind="ask", query="x"),
        ev("b", "confidence_rating", 3, page=2_001, rating="confused"),
    ))[L1]
    assert set(facts.pages) == {3}


def test_the_latest_check_in_counts_and_the_old_reader_is_placed_by_its_slide():
    facts = lesson_facts(space(
        ev("a", "confidence_rating", 0, page=9, idea="Joins", rating="confused"),
        ev("a", "confidence_rating", 4, page=9, idea="Joins", rating="got_it"),
        ev("b", "confidence_rating", 1, slideId="slide-9", rating="unsure"),
        slide_pages={"slide-9": 9},
    ))[L1]
    assert facts.pages[9].ratings == {"a": "got_it", "b": "unsure"}


def test_help_is_explain_or_ask_and_only_asked_questions_are_kept_for_themes():
    facts = lesson_facts(space(
        ev("a", "ai_tutor_query", 0, page=12, kind="explain", query=""),
        ev("b", "ai_tutor_query", 1, page=12, kind="ask", query="Why BCNF?"),
        ev("c", "ai_tutor_query", 2, slideId="slide-12", query="Old reader question"),
        slide_pages={"slide-12": 12},
    ))[L1]
    page = facts.pages[12]
    assert page.explain == {"a"} and page.ask == {"b", "c"}
    assert page.ask_texts == ["Why BCNF?", "Old reader question"]


def test_turning_back_lands_on_the_page_turned_to():
    facts = lesson_facts(space(
        ev("a", "slide_back_navigation", 0, fromPage=8, toPage=7),
        ev("b", "slide_back_navigation", 1, fromPage=12, toPage=7),
        ev("a", "slide_back_navigation", 2, fromPage=8, toPage=7),
    ))[L1]
    assert facts.pages[7].returners == {"a", "b"} and facts.pages[7].from_next == {"a"}


def test_only_the_first_try_at_a_question_counts_and_the_teach_back_is_not_a_try():
    data = space(
        ev("a", "checkpoint_attempt", 0, page=9, idea="Joins", kind="choice", questionId=1, correct=False),
        ev("a", "checkpoint_attempt", 3, page=9, idea="Joins", kind="choice", questionId=1, correct=True),
        ev("a", "checkpoint_attempt", 4, page=9, idea="Joins", kind="choice", questionId=2, correct=True),
        ev("a", "checkpoint_attempt", 5, page=4, idea="Joins", kind="teach", correct=True),
        ev("b", "quiz_attempt", 6, questionId="q1", correct=True),
        ev("b", "quiz_attempt", 7, questionId="q1", correct=False),
        question_pages={"q1": 5},
    )
    tries = sorted((t.user_id, t.page, t.source, t.correct) for t in first_tries(data))
    assert tries == [("a", 9, "checkpoint", False), ("a", 9, "checkpoint", True), ("b", 5, "practice", True)]
    assert len(lesson_facts(data)[L1].pages[9].tries) == 2


def test_a_served_checkpoint_numbers_its_questions_from_one_so_the_same_number_on_another_page_is_another_question():
    data = space(
        ev("a", "checkpoint_attempt", 0, page=9, idea="Joins", kind="choice", questionId=1, correct=True),
        ev("a", "checkpoint_attempt", 1, page=10, idea="Joins", kind="choice", questionId=1, correct=False),
    )
    tries = sorted((t.page, t.correct) for t in first_tries(data))
    assert tries == [(9, True), (10, False)]


def test_a_check_in_is_paired_with_that_ideas_checkpoint_on_the_check_ins_page():
    facts = lesson_facts(space(
        ev("a", "confidence_rating", 0, page=4, idea="Joins", rating="got_it"),
        ev("a", "checkpoint_attempt", 1, page=9, idea="Joins", kind="choice", questionId=1, correct=False),
        ev("b", "confidence_rating", 0, page=4, idea="Joins", rating="confused"),
        ev("b", "checkpoint_attempt", 1, page=9, idea="Joins", kind="choice", questionId=1, correct=True),
        ev("c", "confidence_rating", 0, page=4, idea="Joins", rating="got_it"),
    ))[L1]
    assert facts.pages[4].pairs == {"a": ("got_it", False), "b": ("confused", True)}


def test_helped_is_anyone_who_explained_asked_was_foggy_or_came_back():
    facts = lesson_facts(space(
        ev("a", "ai_tutor_query", 0, page=2, kind="explain", query=""),
        ev("b", "confidence_rating", 0, page=2, rating="confused"),
        ev("c", "slide_back_navigation", 0, fromPage=5, toPage=2),
    ))[L1]
    assert facts.pages[2].helped == {"a", "b", "c"}
