"""Unit tests for the insight engine detectors (pure, no DB)."""
from backend.services.insights import schema
from backend.services.insights.detectors import (
    detect_confusion_hotspot,
    detect_silent_strugglers,
    detect_leaky_bucket,
    detect_confusion_block,
    detect_quiz_misalignment,
    detect_positive_resolution,
    detect_skipped_slide,
    detect_silent_misleader,
    detect_speed_bump,
    detect_calibration_gap,
    detect_overpacked,
)


def _slide(**overrides):
    base = {
        "slide_id": "s1",
        "slide_number": 1,
        "title": "Slide",
        "view_count": 10,
        "avg_dwell": 30.0,
        "median_dwell": 30.0,
        "dwell_p25": 20.0,
        "dwell_p75": 40.0,
        "dwell_cv": 0.3,
        "short_views": 0,
        "confusion_rate": 0.0,
        "quiz_success_rate": 90,
        "quiz_attempts": 10,
        "got_it": 10,
        "unsure": 0,
        "confused": 0,
        "ratings_total": 10,
        "ai_query_count": 0,
        "back_nav_count": 0,
        "back_nav_from_next": 0,
        "overconfident_count": 0,
        "got_it_quiz_total": 0,
        "overconfidence_rate": 0.0,
    }
    base.update(overrides)
    return base


def _bundle(slides, total_students=10, lecture_avg_dwell=30.0, lecture_median_dwell=30.0):
    return {
        "total_students": total_students,
        "lecture_avg_dwell": lecture_avg_dwell,
        "lecture_median_dwell": lecture_median_dwell,
        "slides": slides,
        "students": [],
    }


def test_clear_hotspot_is_flagged_and_acts():
    s = _slide(
        slide_id="s12", slide_number=12, avg_dwell=95.0, confusion_rate=45.0,
        got_it=3, unsure=2, confused=5, ai_query_count=6, back_nav_count=4,
    )
    out = detect_confusion_hotspot(_bundle([s]))
    assert len(out) == 1
    ins = out[0]
    assert ins["id"] == "confusion_hotspot:s12"
    assert ins["kind"] == schema.CONFUSION_HOTSPOT
    assert ins["attention"] == schema.ATTENTION_ACT
    assert ins["targetRef"] == {"slideId": "s12", "slideNumber": 12}
    assert ins["metrics"]["confused"] == 5


def test_confusion_only_hotspot_is_not_banded_calm():
    # Regression: a clearly-confusing slide with no help-seeking must still
    # read as at least "watch" — never calm/"healthy".
    s = _slide(
        slide_id="c8", slide_number=8, confusion_rate=23.0,
        got_it=27, unsure=14, confused=12, ratings_total=53, view_count=53,
        ai_query_count=0, back_nav_count=0, avg_dwell=30.0,
    )
    out = detect_confusion_hotspot(_bundle([s], total_students=53))
    assert len(out) == 1
    assert out[0]["attention"] in (schema.ATTENTION_WATCH, schema.ATTENTION_ACT)
    # Copy must not claim help-seeking that didn't happen.
    assert out[0]["headline"] == "A slide that's confusing students."


def test_low_confusion_slide_is_not_flagged():
    s = _slide(confusion_rate=5.0, confused=0, ai_query_count=0)
    assert detect_confusion_hotspot(_bundle([s])) == []


def test_min_sample_guard_drops_thin_signal():
    # 50% confused but only 2 ratings — below the min-sample guard.
    s = _slide(
        ratings_total=2, view_count=2, confusion_rate=50.0,
        got_it=1, unsure=0, confused=1, ai_query_count=1, back_nav_count=1,
    )
    assert detect_confusion_hotspot(_bundle([s])) == []


def test_severity_ordering_is_monotonic_in_confusion():
    mild = _slide(
        slide_id="mild", confusion_rate=25.0, confused=3, got_it=5, unsure=2,
        ai_query_count=1, back_nav_count=1,
    )
    severe = _slide(
        slide_id="severe", confusion_rate=60.0, confused=7, got_it=1, unsure=2,
        ai_query_count=8, back_nav_count=6, avg_dwell=90.0,
    )
    out = detect_confusion_hotspot(_bundle([mild, severe]))
    assert [i["id"].split(":")[1] for i in sorted(out, key=lambda i: -i["severity"])][0] == "severe"
    assert out  # both flagged


# ── Silent Strugglers ─────────────────────────────────────────────────────────

def _student(**o):
    base = {"student_id": "u", "student_name": "S", "progress_percentage": 100,
            "quiz_score": 90, "typology": "x", "ai_interactions": 0, "revisions": 0}
    base.update(o)
    return base


def test_silent_strugglers_flags_low_progress_no_help():
    students = [
        _student(student_id="a", student_name="A", progress_percentage=20, quiz_score=30, ai_interactions=0),
        _student(student_id="b", student_name="B", progress_percentage=100, quiz_score=95, ai_interactions=2),
        _student(student_id="c", student_name="C", progress_percentage=30, quiz_score=80, ai_interactions=0),
    ]
    out = detect_silent_strugglers({"total_students": 3, "students": students, "slides": []})
    assert len(out) == 1
    assert out[0]["metrics"]["flaggedCount"] == 2
    assert {s["name"] for s in out[0]["detail"]["students"]} == {"A", "C"}


def test_silent_strugglers_skips_tiny_cohort():
    students = [_student(progress_percentage=10, quiz_score=10, ai_interactions=0)]
    assert detect_silent_strugglers({"total_students": 1, "students": students, "slides": []}) == []


def test_silent_strugglers_ignores_students_who_asked_for_help():
    students = [_student(progress_percentage=10, quiz_score=10, ai_interactions=4)] * 3
    assert detect_silent_strugglers({"total_students": 3, "students": students, "slides": []}) == []


# ── Leaky Bucket ──────────────────────────────────────────────────────────────

def test_leaky_bucket_finds_worst_drop():
    slides = [
        _slide(slide_id="s1", slide_number=1, view_count=10),
        _slide(slide_id="s2", slide_number=2, view_count=4),   # 60% drop
        _slide(slide_id="s3", slide_number=3, view_count=3),   # 25% drop
    ]
    out = detect_leaky_bucket(_bundle(slides))
    assert len(out) == 1
    assert out[0]["targetRef"]["slideNumber"] == 1
    assert round(out[0]["metrics"]["attritionPct"]) == 60


def test_leaky_bucket_ignores_small_attrition():
    slides = [_slide(slide_id="s1", slide_number=1, view_count=10), _slide(slide_id="s2", slide_number=2, view_count=9)]
    assert detect_leaky_bucket(_bundle(slides)) == []


# ── Confusion Block ───────────────────────────────────────────────────────────

def test_confusion_block_detects_contiguous_run():
    slides = [
        _slide(slide_id="s1", slide_number=1, confusion_rate=5, confused=0, got_it=10),
        _slide(slide_id="s2", slide_number=2, confusion_rate=30, confused=3, got_it=4, unsure=3, ratings_total=10),
        _slide(slide_id="s3", slide_number=3, confusion_rate=35, confused=4, got_it=3, unsure=3, ratings_total=10),
    ]
    out = detect_confusion_block(_bundle(slides))
    assert len(out) == 1
    assert out[0]["metrics"]["startSlide"] == 2 and out[0]["metrics"]["endSlide"] == 3


def test_confusion_block_requires_two_consecutive():
    slides = [
        _slide(slide_id="s1", slide_number=1, confusion_rate=40, confused=4, got_it=4, unsure=2, ratings_total=10),
        _slide(slide_id="s2", slide_number=2, confusion_rate=5, confused=0, got_it=10),
    ]
    assert detect_confusion_block(_bundle(slides)) == []


# ── Quiz Misalignment & Positive ──────────────────────────────────────────────

def test_quiz_misalignment_flags_easy_slide_hard_quiz():
    # Low confusion, not overconfident (got_it not high), normal dwell, yet failed.
    s = _slide(confusion_rate=3.0, quiz_success_rate=35, quiz_attempts=8, avg_dwell=18.0,
               got_it=4, unsure=6, confused=0, ratings_total=10)
    out = detect_quiz_misalignment(_bundle([s]))
    assert len(out) == 1
    assert out[0]["kind"] == schema.QUIZ_MISALIGNMENT


def test_quiz_misalignment_skipped_when_slide_was_confusing():
    s = _slide(confusion_rate=40.0, quiz_success_rate=35, quiz_attempts=8)
    assert detect_quiz_misalignment(_bundle([s])) == []


def test_quiz_misalignment_defers_to_silent_misleader_when_overconfident():
    # High got_it + failed quiz is a Silent Misleader, not a misalignment.
    s = _slide(confusion_rate=3.0, quiz_success_rate=35, quiz_attempts=8,
               got_it=9, unsure=1, confused=0, ratings_total=10)
    assert detect_quiz_misalignment(_bundle([s])) == []


def test_positive_resolution_surfaces_productive_struggle():
    s = _slide(confusion_rate=30.0, quiz_success_rate=85, quiz_attempts=8, confused=3, got_it=4, unsure=3, ratings_total=10)
    out = detect_positive_resolution(_bundle([s]))
    assert len(out) == 1
    assert out[0]["kind"] == schema.HEALTHY
    assert out[0]["attention"] == schema.ATTENTION_CALM


# ── Phase 3: Skipped Slide ────────────────────────────────────────────────────

def test_skipped_slide_flags_very_short_median_dwell():
    s = _slide(slide_id="sk", slide_number=2, median_dwell=2.0, short_views=8, confusion_rate=2.0)
    out = detect_skipped_slide(_bundle([s]))
    assert len(out) == 1 and out[0]["kind"] == schema.SKIPPED_SLIDE


def test_skipped_slide_not_flagged_when_confusing():
    # Short dwell but confusing → it's hard, not skipped.
    s = _slide(median_dwell=2.0, confusion_rate=40.0, confused=5, got_it=2, unsure=3)
    assert detect_skipped_slide(_bundle([s])) == []


def test_skipped_slide_respects_min_views():
    s = _slide(median_dwell=2.0, view_count=2)
    assert detect_skipped_slide(_bundle([s])) == []


# ── Phase 3: Silent Misleader ─────────────────────────────────────────────────

def test_silent_misleader_flags_confident_but_failing():
    s = _slide(slide_id="ml", slide_number=3, got_it=9, unsure=1, confused=0, ratings_total=10,
               quiz_success_rate=35, quiz_attempts=8, got_it_quiz_total=0)
    out = detect_silent_misleader(_bundle([s]))
    assert len(out) == 1 and out[0]["kind"] == schema.SILENT_MISLEADER


def test_silent_misleader_defers_to_calibration_when_pairs_present():
    s = _slide(got_it=9, unsure=1, ratings_total=10, quiz_success_rate=35, quiz_attempts=8,
               got_it_quiz_total=5, overconfident_count=4, overconfidence_rate=80.0)
    assert detect_silent_misleader(_bundle([s])) == []


# ── Phase 3: Speed Bump ───────────────────────────────────────────────────────

def test_speed_bump_flags_backtrack_from_next_with_dwell_spike():
    s = _slide(slide_id="bp", slide_number=4, median_dwell=60.0, back_nav_from_next=4,
               confusion_rate=10.0, got_it=7, unsure=3, ratings_total=10)
    out = detect_speed_bump(_bundle([s]))
    assert len(out) == 1 and out[0]["kind"] == schema.SPEED_BUMP


def test_speed_bump_needs_dwell_spike():
    # Backtracks but no dwell spike (at lecture median) → not a speed bump.
    s = _slide(median_dwell=30.0, back_nav_from_next=4, confusion_rate=10.0)
    assert detect_speed_bump(_bundle([s])) == []


# ── Phase 3: Calibration Gap ──────────────────────────────────────────────────

def test_calibration_gap_flags_overconfidence():
    s = _slide(slide_id="cg", slide_number=5, got_it_quiz_total=8, overconfident_count=5,
               overconfidence_rate=62.5)
    out = detect_calibration_gap(_bundle([s]))
    assert len(out) == 1 and out[0]["kind"] == schema.CALIBRATION_GAP


def test_calibration_gap_respects_min_pairs():
    s = _slide(got_it_quiz_total=2, overconfident_count=2, overconfidence_rate=100.0)
    assert detect_calibration_gap(_bundle([s])) == []


# ── Phase 3: Overpacked & mutual exclusion ────────────────────────────────────

def test_overpacked_flags_overload_fingerprint():
    s = _slide(slide_id="op", slide_number=6, confusion_rate=45.0, median_dwell=80.0,
               dwell_cv=1.2, ai_query_count=6, confused=5, got_it=2, unsure=3, ratings_total=10)
    out = detect_overpacked(_bundle([s]))
    assert len(out) == 1 and out[0]["kind"] == schema.OVERPACKED


def test_overpacked_preempts_confusion_hotspot():
    s = _slide(slide_id="op", slide_number=6, confusion_rate=45.0, median_dwell=80.0,
               dwell_cv=1.2, ai_query_count=6, confused=5, got_it=2, unsure=3, ratings_total=10)
    # Same slide must not also be a Confusion Hotspot.
    assert detect_confusion_hotspot(_bundle([s])) == []
