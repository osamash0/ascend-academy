"""From engine findings to what the door is told: its numbers, its pages, its order, its light."""
from __future__ import annotations

from backend.services.insights.landing_map import (
    collapse_healthy, grid, help_index, help_share, lesson_light, rank, to_landing,
)
from backend.services.insights.sources.space import LessonRow
from backend.services.insights.space_facts import LessonFacts, PageFacts


def people(n, prefix="r"):
    return {f"{prefix}{i}" for i in range(n)}


def facts(pages, lesson_id="l1", count=6):
    lf = LessonFacts(LessonRow(id=lesson_id, title="Normalization", order=1, pages=count))
    for n, pf in pages.items():
        lf.pages[n] = pf
        lf.readers |= pf.readers
    return lf


def engine(kind, page=None, severity=0.8, attention="act", **metrics):
    return {
        "id": f"{kind}:x", "kind": kind, "severity": severity, "attention": attention,
        "targetRef": {"slideNumber": page} if page else {}, "metrics": {**metrics, **({"slideNumber": page} if page else {})},
    }


def test_a_hotspot_tells_how_many_people_asked_and_how_many_said_foggy():
    pf = PageFacts(readers=people(10), explain={"r0", "r1"}, ask={"r1", "r2", "r3"})
    out = to_landing(engine("confusion_hotspot", 3, confusionRate=61.4), facts({3: pf}))
    assert out == {
        "id": "l1:confusion_hotspot:x", "kind": "confusion_hotspot", "attention": "act", "severity": 0.8,
        "lessonId": "l1", "page": 3, "metrics": {"askers": 4, "foggy": 61},
    }


def test_someone_who_asked_without_reading_the_page_is_not_counted_among_its_askers():
    pf = PageFacts(readers=people(10), explain={"r0"}, ask={"r1", "ghost"})
    out = to_landing(engine("confusion_hotspot", 3, confusionRate=50.0), facts({3: pf}))
    assert out["metrics"]["askers"] == 2


def test_a_calibration_gap_tells_its_share_and_carries_its_grid():
    pairs = {f"r{i}": ("got_it", i >= 3) for i in range(5)} | {"r5": ("confused", True)}
    pf = PageFacts(readers=people(10), pairs=pairs)
    out = to_landing(engine("calibration_gap", 9, overconfidenceRate=60.0), facts({9: pf}))
    assert out["metrics"] == {"pct": 60}
    assert out["grid"] == {"clickedCleared": 2, "clickedMissed": 3, "foggyCleared": 1, "foggyMissed": 0}


def test_a_silent_misleader_is_never_told_even_with_a_full_grid():
    # Its "then N% of them missed" is over clicked pairs. With the people gate the detector fires
    # only on fewer than five of them (five or more is a calibration_gap, honestly paired), so
    # the share would always stand for one to four people. The door never says it.
    paired = {f"r{i}": ("got_it", i >= 3) for i in range(5)} | {"r5": ("confused", True)}
    for pf in (
        PageFacts(readers=people(10), pairs=paired),
        PageFacts(readers=people(10), pairs={"r0": ("got_it", True), "r1": ("got_it", False)}),
        PageFacts(readers=people(10)),
    ):
        assert to_landing(engine("silent_misleader", 9, gotItPct=78.0, quizSuccessRate=40.0), facts({9: pf})) is None


def test_a_grid_counts_only_the_pages_readers():
    pairs = {f"r{i}": ("got_it", False) for i in range(4)} | {"ghost": ("got_it", True)}
    assert grid(PageFacts(readers=people(10), pairs=pairs)) is None
    pairs["r4"] = ("confused", True)
    assert grid(PageFacts(readers=people(10), pairs=pairs)) == {
        "clickedCleared": 0, "clickedMissed": 4, "foggyCleared": 1, "foggyMissed": 0,
    }


def test_each_kind_sends_the_numbers_its_copy_reads():
    lf = facts({4: PageFacts(readers=people(10))})
    assert to_landing(engine("skipped_slide", 4, medianDwellSeconds=3.4), lf)["metrics"] == {"seconds": 3}
    assert to_landing(engine("speed_bump", 4, backtracksFromNext=7), lf)["metrics"] == {"backs": 7}
    assert to_landing(
        engine("overpacked", 4, medianDwellSeconds=90.0, lectureMedianDwellSeconds=40.0), lf
    )["metrics"] == {"ratio": 2.2}
    assert to_landing(engine("leaky_bucket", 4, attritionPct=31.6), lf)["metrics"] == {"pct": 32}
    assert to_landing(engine("quiz_misalignment", 4, quizSuccessRate=41.2), lf)["metrics"] == {"pct": 41}
    assert to_landing(engine("calibration_gap", 4, overconfidenceRate=55.5), lf)["metrics"] == {"pct": 56}


def test_a_stretch_is_told_by_its_first_and_last_page():
    lf = facts({n: PageFacts(readers=people(10)) for n in (2, 3, 4)})
    block = {"id": "confusion_block:2-4", "kind": "confusion_block", "severity": 0.5, "attention": "watch",
             "targetRef": {}, "metrics": {"startSlide": 2, "endSlide": 4, "avgConfusion": 40.0}}
    out = to_landing(block, lf)
    assert (out["first"], out["last"], "page" in out, out["metrics"]) == (2, 4, False, {})


def test_people_are_never_told():
    assert to_landing({"id": "silent_strugglers", "kind": "silent_strugglers", "severity": 0.9,
                       "attention": "act", "targetRef": {}, "metrics": {}}, facts({})) is None


def test_the_engines_english_never_reaches_the_door():
    # Spec B5: the backend sends kinds and numbers only. A finding as make_insight
    # builds it carries English and more; none of it may pass through.
    finding = engine("speed_bump", 4, backtracksFromNext=7)
    finding |= {
        "headline": "Students keep going back to slide 4", "summary": "Seven went back.",
        "interpretation": "The next page leans on this one.", "detail": {"students": [{"name": "Ada"}]},
        "cue": {"metric": {"label": "backtracks", "value": "7"}}, "scope": "slide",
    }
    out = to_landing(finding, facts({4: PageFacts(readers=people(10))}))
    assert set(out) == {"id", "kind", "attention", "severity", "lessonId", "page", "metrics"}
    assert "headline" not in out


def test_a_lesson_is_landing_once_and_only_when_nothing_in_it_wants_the_owner():
    calm = [{"id": "l1:healthy:a", "kind": "healthy", "attention": "calm", "severity": 0.12, "lessonId": "l1", "page": 2, "metrics": {}}]
    assert collapse_healthy(calm, "l1") == [
        {"id": "l1:healthy", "kind": "healthy", "attention": "calm", "severity": 0.12, "lessonId": "l1", "metrics": {}}
    ]
    loud = {"id": "l1:x", "kind": "speed_bump", "attention": "watch", "severity": 0.5, "lessonId": "l1", "page": 4, "metrics": {}}
    assert collapse_healthy(calm + [loud], "l1") == [loud]


def test_a_lessons_light_is_its_loudest_finding_or_few_under_the_floor():
    found = [{"attention": "watch"}, {"attention": "act"}]
    assert lesson_light(found, 10) == "act"
    assert lesson_light([], 10) == "calm"
    assert lesson_light(found, 4) == "few"


def test_findings_are_ranked_by_band_then_by_how_many_people_they_touch():
    a = {"lessonId": "small", "attention": "act", "severity": 0.7}
    b = {"lessonId": "big", "attention": "act", "severity": 0.68}
    c = {"lessonId": "big", "attention": "watch", "severity": 0.6}
    assert rank([c, a, b], {"small": 6, "big": 120}) == [b, a, c]


def test_help_is_the_share_of_readers_who_needed_the_page_never_brighter_than_half_of_them():
    quiet = PageFacts(readers=people(10), explain={"r0"})
    loud = PageFacts(readers=people(10), ask=people(4), returners={"r9"})
    few = PageFacts(readers=people(3), ask=people(3))
    lf = facts({1: quiet, 2: loud, 3: few}, count=4)
    assert help_share(quiet) == 0.1 and help_share(few) == 0.0
    assert help_index({"l1": lf}) == {"l1": [0.2, 1.0, 0.0, 0.0]}


def test_a_page_beyond_the_lessons_pages_does_not_lengthen_its_help():
    lf = facts({1: PageFacts(readers=people(10), explain={"r0"}), 1_999: PageFacts(readers=people(10), ask=people(6))}, count=4)
    assert len(help_index({"l1": lf})["l1"]) == 4


def test_a_hidden_page_beyond_the_lessons_pages_does_not_dim_the_shown_ones():
    # Five people who all "needed" page 9 of a four-page Lesson (their own inserts) set no scale.
    shown = {1: PageFacts(readers=people(10), explain={"r0"}), 2: PageFacts(readers=people(10), ask=people(4))}
    alone = help_index({"l1": facts(shown, count=4)})
    hidden = PageFacts(readers=people(5, prefix="h"), ask=people(5, prefix="h"))
    assert help_index({"l1": facts({**shown, 9: hidden}, count=4)}) == alone == {"l1": [0.2, 0.8, 0.0, 0.0]}


def test_a_lesson_without_a_page_count_is_as_long_as_its_highest_page_read():
    lf = facts({2: PageFacts(readers=people(10), explain={"r0"}), 5: PageFacts(readers=people(10))}, count=0)
    assert len(help_index({"l1": lf})["l1"]) == 5


def test_a_grid_needs_five_pairs():
    four = PageFacts(readers=people(10), pairs={f"r{i}": ("got_it", True) for i in range(4)})
    assert grid(four) is None
