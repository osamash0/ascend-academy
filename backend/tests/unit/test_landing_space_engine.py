"""The engine's detectors, untouched, run on a Space's facts — and say nothing under the floor."""
from __future__ import annotations

from backend.services.insights.sources.space import LessonRow
from backend.services.insights.space_engine import MIN_READERS, lesson_bundle, lesson_insights, page_row, pages_of
from backend.services.insights.space_facts import LessonFacts, PageFacts

LESSON = LessonRow(id="l1", title="Normalization", order=1, pages=6)


def readers(n, prefix="r"):
    return {f"{prefix}{i}" for i in range(n)}


def calm_page(people):
    return PageFacts(readers=set(people), sittings=[40.0] * len(people), ratings={p: "got_it" for p in people})


def lesson(pages):
    lf = LessonFacts(LESSON)
    for n, pf in pages.items():
        lf.pages[n] = pf
        lf.readers |= pf.readers
    return lf


def test_a_page_row_carries_what_the_detectors_read():
    people = readers(10)
    pf = PageFacts(
        readers=set(people), sittings=[3.0, 40.0, 50.0], explain={"r0"}, ask={"r1", "r2"},
        ratings={"r0": "confused", "r1": "got_it"}, returners={"r3"}, from_next=1,
        pairs={"r1": ("got_it", False), "r4": ("got_it", True)},
    )
    row = page_row("l1", 3, pf)
    assert row["slide_number"] == 3 and row["view_count"] == 10 and row["short_views"] == 1
    assert row["confusion_rate"] == 50.0 and row["ratings_total"] == 2
    assert row["ai_query_count"] == 3 and row["back_nav_count"] == 1 and row["back_nav_from_next"] == 1
    assert (row["got_it_quiz_total"], row["overconfident_count"], row["overconfidence_rate"]) == (2, 1, 50.0)
    assert row["quiz_success_rate"] is None and row["quiz_attempts"] == 0


def test_someone_who_asked_or_turned_back_without_a_counted_read_is_not_a_reader_of_the_page():
    pf = PageFacts(
        readers={"r0", "r1"}, sittings=[40.0, 40.0],
        explain={"r0", "x1"}, ask={"r1", "x2"}, returners={"r0", "x3"},
    )
    row = page_row("l1", 2, pf)
    assert row["view_count"] == 2
    assert row["ai_query_count"] == 2 and row["back_nav_count"] == 1
    assert row["ai_query_count"] <= row["view_count"] and row["back_nav_count"] <= row["view_count"]


def test_a_page_where_many_ask_and_say_foggy_is_a_hotspot():
    people = readers(10)
    hot = PageFacts(
        readers=set(people), sittings=[40.0] * 10, ask=set(sorted(people)[:7]),
        ratings={p: ("confused" if i < 8 else "got_it") for i, p in enumerate(sorted(people))},
    )
    lf = lesson({1: calm_page(people), 2: calm_page(people), 3: hot, 4: calm_page(people)})
    found = lesson_insights(lf)
    assert any(i["kind"] == "confusion_hotspot" and pages_of(i) == [3] for i in found)
    assert lesson_bundle(lf)["total_students"] == 10


def test_nothing_is_said_about_a_page_fewer_than_five_people_read():
    people = readers(10)
    few = readers(MIN_READERS - 1, prefix="f")
    hot_but_few = PageFacts(readers=set(few), sittings=[40.0] * 4, ask=set(few), ratings={p: "confused" for p in few})
    lf = lesson({1: calm_page(people), 2: calm_page(people), 3: hot_but_few})
    assert not any(3 in pages_of(i) for i in lesson_insights(lf))


def test_a_lesson_fewer_than_five_people_read_says_nothing():
    few = readers(MIN_READERS - 1)
    hot = PageFacts(readers=set(few), sittings=[40.0] * 4, ask=set(few), ratings={p: "confused" for p in few})
    assert lesson_insights(lesson({1: hot})) == []


def test_people_never_enter_the_lesson_bundle():
    assert lesson_bundle(lesson({1: calm_page(readers(10))}))["students"] == []
