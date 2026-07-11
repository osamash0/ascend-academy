"""Insight detectors — one pure function per kind (bundle in, insights out).

Pure and side-effect-free so they're trivially unit-testable with synthetic
bundles. v1 ships :func:`detect_confusion_hotspot`; further kinds are added
here as the catalog is built out.
"""
from __future__ import annotations

from typing import Any, Dict, List

from backend.services.insights import copy, schema

# ── Confusion Hotspot thresholds / weights ───────────────────────────────────
# A slide must clear these gates before it can be flagged at all.
_MIN_RATINGS = 3            # min-sample guard: ignore slides with too little signal
_CONFUSION_FLOOR = 20.0     # % "confused" below which it's not a hotspot

# Confusion level that saturates the primary signal (50% confused = full).
_CONFUSION_FULL = 50.0

# Rates (per viewer) that count as "high" — used to normalize to 0..1.
_QUERY_RATE_NORM = 0.5
_BACKNAV_RATE_NORM = 0.3

# Confusion is the PRIMARY driver of severity; help-seeking, backtracking and
# long dwell add urgency on top of it (additive, not averaged — so a slide
# that's purely confusing still ranks as a real problem).
_W_QUERY = 0.5
_W_BACKNAV = 0.4
_W_DWELL = 0.25

# ── Overpacked (cognitive overload) — shared gate ─────────────────────────────
# Overpacked is a *specific cause* of confusion (overload), so it pre-empts the
# generic Confusion Hotspot for the same slide. The two are mutually exclusive.
_OVERPACK_CONFUSION_FLOOR = 30.0
_OVERPACK_DWELL_MULT = 1.5      # median dwell this many × the lecture median = "long"
_OVERPACK_QUERY_RATE = 0.3      # AI queries per viewer
_OVERPACK_CV = 0.8              # dwell coefficient of variation = "erratic"
_OVERPACK_MIN_VIEWS = 5


def _is_overpacked(slide: Dict[str, Any], lecture_median_dwell: float) -> bool:
    """Overload fingerprint: high confusion + long, erratic dwell + heavy help-seeking."""
    if lecture_median_dwell <= 0:
        return False
    view_count = int(slide.get("view_count") or 0)
    if view_count < _OVERPACK_MIN_VIEWS:
        return False
    if float(slide.get("confusion_rate") or 0) < _OVERPACK_CONFUSION_FLOOR:
        return False
    median_dwell = float(slide.get("median_dwell") or 0)
    if median_dwell < lecture_median_dwell * _OVERPACK_DWELL_MULT:
        return False
    query_rate = slide.get("ai_query_count", 0) / max(view_count, 1)
    erratic = float(slide.get("dwell_cv") or 0) >= _OVERPACK_CV
    return query_rate >= _OVERPACK_QUERY_RATE or erratic


def detect_confusion_hotspot(bundle: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Flag slides where many students are confused AND actively struggling
    (help-seeking, backtracking, long dwell)."""
    total_students = int(bundle.get("total_students") or 0)
    lecture_avg_dwell = float(bundle.get("lecture_avg_dwell") or 0.0)
    lecture_median_dwell = float(bundle.get("lecture_median_dwell") or 0.0)
    insights: List[Dict[str, Any]] = []

    for s in bundle.get("slides", []):
        ratings_total = int(s.get("ratings_total") or 0)
        confusion_rate = float(s.get("confusion_rate") or 0.0)

        # Gates: enough signal, and genuinely confusing.
        if ratings_total < _MIN_RATINGS or confusion_rate < _CONFUSION_FLOOR:
            continue
        # Overpacked pre-empts the generic hotspot for the same slide.
        if _is_overpacked(s, lecture_median_dwell):
            continue

        denom = max(int(s.get("view_count") or 0), ratings_total, 1)
        query_rate = s.get("ai_query_count", 0) / denom
        backnav_rate = s.get("back_nav_count", 0) / denom

        conf_c = schema.clamp01(confusion_rate / _CONFUSION_FULL)
        query_c = schema.clamp01(query_rate / _QUERY_RATE_NORM)
        backnav_c = schema.clamp01(backnav_rate / _BACKNAV_RATE_NORM)
        dwell_c = (
            schema.clamp01((s.get("avg_dwell", 0.0) / lecture_avg_dwell) - 1.0)
            if lecture_avg_dwell > 0
            else 0.0
        )

        magnitude = schema.clamp01(
            conf_c + _W_QUERY * query_c + _W_BACKNAV * backnav_c + _W_DWELL * dwell_c
        )

        # Reach modulates (but never zeroes) severity, so a real problem in a
        # small cohort still surfaces.
        reach = schema.clamp01(denom / total_students) if total_students > 0 else 1.0
        severity = magnitude * (0.7 + 0.3 * reach)

        headline, summary, interpretation = copy.confusion_hotspot_copy(s)
        insights.append(
            schema.make_insight(
                id=f"{schema.CONFUSION_HOTSPOT}:{s['slide_id']}",
                kind=schema.CONFUSION_HOTSPOT,
                scope=schema.SCOPE_SLIDE,
                severity=severity,
                headline=headline,
                summary=summary,
                interpretation=interpretation,
                target_ref={"slideId": s["slide_id"], "slideNumber": s["slide_number"]},
                cue={"metric": {"label": "confused", "value": f"{round(confusion_rate)}%"}},
                metrics={
                    "slideNumber": s["slide_number"],
                    "confusionRate": round(confusion_rate, 1),
                    "gotIt": s.get("got_it", 0),
                    "unsure": s.get("unsure", 0),
                    "confused": s.get("confused", 0),
                    "ratingsTotal": ratings_total,
                    "aiQueryCount": s.get("ai_query_count", 0),
                    "backNavCount": s.get("back_nav_count", 0),
                    "avgDwellSeconds": round(s.get("avg_dwell", 0.0), 1),
                    "lectureAvgDwellSeconds": round(lecture_avg_dwell, 1),
                    "viewCount": s.get("view_count", 0),
                },
                evidence_kinds=["ai_queries", "confidence_breakdown"],
            )
        )

    return insights


# ── Silent Strugglers ─────────────────────────────────────────────────────────
_STRUGGLER_PROGRESS_FLOOR = 40.0   # % progress below which a student looks stalled
_STRUGGLER_SCORE_FLOOR = 50.0      # quiz score below which they look at-risk
_STRUGGLER_MIN_COHORT = 3          # don't flag in tiny cohorts


def detect_silent_strugglers(bundle: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Flag students who are disengaging or underperforming without asking for help."""
    total = int(bundle.get("total_students") or 0)
    students = bundle.get("students", []) or []
    if total < _STRUGGLER_MIN_COHORT:
        return []

    flagged = [
        s for s in students
        if int(s.get("ai_interactions") or 0) == 0
        and (
            float(s.get("progress_percentage") or 0) < _STRUGGLER_PROGRESS_FLOOR
            or float(s.get("quiz_score") or 0) < _STRUGGLER_SCORE_FLOOR
        )
    ]
    if not flagged:
        return []

    reach = schema.clamp01(len(flagged) / total)
    severity = 0.35 + 0.65 * reach

    headline, summary, interpretation = copy.silent_strugglers_copy(len(flagged))
    detail_students = sorted(
        flagged, key=lambda s: float(s.get("quiz_score") or 0)
    )[:8]
    return [
        schema.make_insight(
            id="silent_strugglers",
            kind=schema.SILENT_STRUGGLERS,
            scope=schema.SCOPE_STUDENT,
            severity=severity,
            headline=headline,
            summary=summary,
            interpretation=interpretation,
            cue={"metric": {"label": "at risk", "value": str(len(flagged))}},
            metrics={"flaggedCount": len(flagged), "totalStudents": total},
            detail={
                "students": [
                    {
                        "studentId": s.get("student_id"),
                        "name": s.get("student_name", "Student"),
                        "progress": int(s.get("progress_percentage") or 0),
                        "quizScore": int(s.get("quiz_score") or 0),
                        "aiInteractions": int(s.get("ai_interactions") or 0),
                    }
                    for s in detail_students
                ]
            },
            evidence_kinds=["student_journey"],
        )
    ]


# ── Leaky Bucket (drop-off slope) ─────────────────────────────────────────────
_LEAKY_ATTRITION_FLOOR = 0.20      # >20% slide-to-slide attrition is the "leak"
_LEAKY_MIN_PRIOR_VIEWS = 3


def detect_leaky_bucket(bundle: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Find the slide where the lecture sheds the most students."""
    slides = sorted(bundle.get("slides", []), key=lambda s: s.get("slide_number") or 0)
    worst = None  # (attrition, prev_slide, next_slide)
    for prev, nxt in zip(slides, slides[1:]):
        pv = int(prev.get("view_count") or 0)
        nv = int(nxt.get("view_count") or 0)
        if pv < _LEAKY_MIN_PRIOR_VIEWS:
            continue
        attrition = 1.0 - (nv / pv)
        if attrition >= _LEAKY_ATTRITION_FLOOR and (worst is None or attrition > worst[0]):
            worst = (attrition, prev, nxt)

    if worst is None:
        return []

    attrition, prev, _ = worst
    severity = schema.clamp01(attrition / 0.5)
    headline, summary, interpretation = copy.leaky_bucket_copy(prev["slide_number"], attrition * 100)
    return [
        schema.make_insight(
            id=f"{schema.LEAKY_BUCKET}:{prev['slide_id']}",
            kind=schema.LEAKY_BUCKET,
            scope=schema.SCOPE_LECTURE,
            severity=severity,
            headline=headline,
            summary=summary,
            interpretation=interpretation,
            target_ref={"slideId": prev["slide_id"], "slideNumber": prev["slide_number"]},
            cue={"metric": {"label": "drop-off", "value": f"{round(attrition * 100)}%"}},
            metrics={
                "slideNumber": prev["slide_number"],
                "attritionPct": round(attrition * 100, 1),
                "viewsBefore": prev.get("view_count", 0),
            },
        )
    ]


# ── Confusion Block (contiguous high-confusion run) ───────────────────────────
_BLOCK_CONFUSION_FLOOR = 25.0
_BLOCK_MIN_RATINGS = 3


def detect_confusion_block(bundle: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Flag a contiguous stretch of slides that all run high on confusion."""
    slides = sorted(bundle.get("slides", []), key=lambda s: s.get("slide_number") or 0)

    best_run: List[Dict[str, Any]] = []
    run: List[Dict[str, Any]] = []
    for s in slides:
        qualifies = (
            int(s.get("ratings_total") or 0) >= _BLOCK_MIN_RATINGS
            and float(s.get("confusion_rate") or 0) >= _BLOCK_CONFUSION_FLOOR
        )
        if qualifies:
            run.append(s)
            if len(run) > len(best_run):
                best_run = run[:]
        else:
            run = []

    if len(best_run) < 2:
        return []

    avg_conf = sum(float(s["confusion_rate"]) for s in best_run) / len(best_run)
    start, end = best_run[0]["slide_number"], best_run[-1]["slide_number"]
    severity = schema.clamp01(avg_conf / _CONFUSION_FULL * 0.9 + 0.05 * (len(best_run) - 2))

    headline, summary, interpretation = copy.confusion_block_copy(start, end, avg_conf)
    return [
        schema.make_insight(
            id=f"{schema.CONFUSION_BLOCK}:{start}-{end}",
            kind=schema.CONFUSION_BLOCK,
            scope=schema.SCOPE_LECTURE,
            severity=severity,
            headline=headline,
            summary=summary,
            interpretation=interpretation,
            cue={"metric": {"label": "slides", "value": f"{start}–{end}"}},
            metrics={"startSlide": start, "endSlide": end, "avgConfusion": round(avg_conf, 1)},
            detail={
                "slides": [
                    {"slideNumber": s["slide_number"], "title": s["title"], "confusionRate": round(float(s["confusion_rate"]), 1)}
                    for s in best_run
                ]
            },
        )
    ]


# ── Quiz Misalignment ─────────────────────────────────────────────────────────
_MISALIGN_SUCCESS_CEIL = 50.0      # passed below this = hard quiz item
_MISALIGN_CONFUSION_CEIL = 15.0    # but slide looked easy
_MISALIGN_MIN_ATTEMPTS = 3


def detect_quiz_misalignment(bundle: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Flag slides that looked easy (low confusion, normal pace) yet failed the quiz."""
    lecture_avg_dwell = float(bundle.get("lecture_avg_dwell") or 0.0)
    out: List[Dict[str, Any]] = []
    for s in bundle.get("slides", []):
        success = s.get("quiz_success_rate")
        attempts = int(s.get("quiz_attempts") or 0)
        if success is None or attempts < _MISALIGN_MIN_ATTEMPTS:
            continue
        confusion = float(s.get("confusion_rate") or 0)
        long_dwell = lecture_avg_dwell > 0 and s.get("avg_dwell", 0.0) > lecture_avg_dwell * 1.2
        if float(success) >= _MISALIGN_SUCCESS_CEIL or confusion >= _MISALIGN_CONFUSION_CEIL or long_dwell:
            continue
        # A confident-but-failing slide is a Silent Misleader, not a misalignment.
        ratings_total = int(s.get("ratings_total") or 0)
        got_it_pct = (s.get("got_it", 0) / ratings_total * 100) if ratings_total > 0 else 0.0
        if got_it_pct >= _MISLEADER_GOTIT_FLOOR:
            continue

        severity = schema.clamp01((_MISALIGN_SUCCESS_CEIL - float(success)) / _MISALIGN_SUCCESS_CEIL * 0.8 + 0.2)
        headline, summary, interpretation = copy.quiz_misalignment_copy(s["slide_number"], float(success))
        out.append(
            schema.make_insight(
                id=f"{schema.QUIZ_MISALIGNMENT}:{s['slide_id']}",
                kind=schema.QUIZ_MISALIGNMENT,
                scope=schema.SCOPE_QUIZ,
                severity=severity,
                headline=headline,
                summary=summary,
                interpretation=interpretation,
                target_ref={"slideId": s["slide_id"], "slideNumber": s["slide_number"]},
                cue={"metric": {"label": "first-try pass", "value": f"{round(float(success))}%"}},
                metrics={
                    "slideNumber": s["slide_number"],
                    "quizSuccessRate": round(float(success), 1),
                    "confusionRate": round(confusion, 1),
                    "quizAttempts": attempts,
                },
            )
        )
    return out


# ── Positive: productive struggle resolved ────────────────────────────────────
_POSITIVE_CONFUSION_FLOOR = 25.0
_POSITIVE_SUCCESS_FLOOR = 75.0
_POSITIVE_MIN_ATTEMPTS = 3


def detect_positive_resolution(bundle: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Surface the occasional win: a slide that drew confusion but students still mastered."""
    out: List[Dict[str, Any]] = []
    for s in bundle.get("slides", []):
        success = s.get("quiz_success_rate")
        attempts = int(s.get("quiz_attempts") or 0)
        if success is None or attempts < _POSITIVE_MIN_ATTEMPTS:
            continue
        if float(s.get("confusion_rate") or 0) < _POSITIVE_CONFUSION_FLOOR or float(success) < _POSITIVE_SUCCESS_FLOOR:
            continue

        # Intentionally low, fixed severity → calm band, sorts to the bottom.
        headline, summary, interpretation = copy.positive_resolution_copy(s["slide_number"], float(success))
        out.append(
            schema.make_insight(
                id=f"{schema.HEALTHY}:{s['slide_id']}",
                kind=schema.HEALTHY,
                scope=schema.SCOPE_SLIDE,
                severity=0.12,
                headline=headline,
                summary=summary,
                interpretation=interpretation,
                target_ref={"slideId": s["slide_id"], "slideNumber": s["slide_number"]},
                cue={"metric": {"label": "passed", "value": f"{round(float(success))}%"}},
                metrics={
                    "slideNumber": s["slide_number"],
                    "quizSuccessRate": round(float(success), 1),
                    "confusionRate": round(float(s.get("confusion_rate") or 0), 1),
                },
            )
        )
    return out


# ── Skipped Slide ─────────────────────────────────────────────────────────────
_SKIP_DWELL_CEIL = 5.0       # median dwell (s) below which a slide is "skimmed"
_SKIP_MIN_VIEWS = 5
_SKIP_CONFUSION_CEIL = 20.0  # a confusing slide isn't "skipped", it's hard


def detect_skipped_slide(bundle: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Flag slides students breeze past in seconds (median dwell very low)."""
    total_students = int(bundle.get("total_students") or 0)
    out: List[Dict[str, Any]] = []
    for s in bundle.get("slides", []):
        median_dwell = float(s.get("median_dwell") or 0)
        view_count = int(s.get("view_count") or 0)
        if median_dwell <= 0 or view_count < _SKIP_MIN_VIEWS:
            continue
        if median_dwell >= _SKIP_DWELL_CEIL or float(s.get("confusion_rate") or 0) >= _SKIP_CONFUSION_CEIL:
            continue

        reach = schema.clamp01(view_count / total_students) if total_students > 0 else 1.0
        severity = schema.clamp01((_SKIP_DWELL_CEIL - median_dwell) / _SKIP_DWELL_CEIL) * (0.4 + 0.3 * reach)
        headline, summary, interpretation = copy.skipped_slide_copy(s["slide_number"], median_dwell)
        out.append(
            schema.make_insight(
                id=f"{schema.SKIPPED_SLIDE}:{s['slide_id']}",
                kind=schema.SKIPPED_SLIDE,
                scope=schema.SCOPE_SLIDE,
                severity=severity,
                headline=headline,
                summary=summary,
                interpretation=interpretation,
                target_ref={"slideId": s["slide_id"], "slideNumber": s["slide_number"]},
                cue={"metric": {"label": "median time", "value": f"{round(median_dwell)}s"}},
                metrics={
                    "slideNumber": s["slide_number"],
                    "medianDwellSeconds": round(median_dwell, 1),
                    "shortViews": s.get("short_views", 0),
                    "viewCount": view_count,
                },
            )
        )
    return out


# ── Silent Misleader (illusion of knowing — aggregate fallback) ───────────────
_MISLEADER_GOTIT_FLOOR = 60.0      # % who rated "got it"
_MISLEADER_SUCCESS_CEIL = 50.0     # yet passed below this
_MISLEADER_MIN_RATINGS = 3
_MISLEADER_MIN_ATTEMPTS = 3


def detect_silent_misleader(bundle: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Slides where most students felt confident but failed the quiz.

    Aggregate version — used only when there aren't enough per-student
    confidence×quiz pairs for the (more precise) Calibration Gap to fire.
    """
    total_students = int(bundle.get("total_students") or 0)
    out: List[Dict[str, Any]] = []
    for s in bundle.get("slides", []):
        ratings_total = int(s.get("ratings_total") or 0)
        success = s.get("quiz_success_rate")
        attempts = int(s.get("quiz_attempts") or 0)
        if ratings_total < _MISLEADER_MIN_RATINGS or success is None or attempts < _MISLEADER_MIN_ATTEMPTS:
            continue
        got_it_pct = s.get("got_it", 0) / ratings_total * 100
        if got_it_pct < _MISLEADER_GOTIT_FLOOR or float(success) >= _MISLEADER_SUCCESS_CEIL:
            continue
        # Defer to Calibration Gap when we have the per-student pairing.
        if int(s.get("got_it_quiz_total") or 0) >= _CALIB_MIN_PAIRS:
            continue

        reach = schema.clamp01(ratings_total / total_students) if total_students > 0 else 1.0
        magnitude = schema.clamp01((_MISLEADER_SUCCESS_CEIL - float(success)) / _MISLEADER_SUCCESS_CEIL * 0.6 + got_it_pct / 100 * 0.4)
        severity = magnitude * (0.7 + 0.3 * reach)
        headline, summary, interpretation = copy.silent_misleader_copy(s["slide_number"], got_it_pct, float(success))
        out.append(
            schema.make_insight(
                id=f"{schema.SILENT_MISLEADER}:{s['slide_id']}",
                kind=schema.SILENT_MISLEADER,
                scope=schema.SCOPE_SLIDE,
                severity=severity,
                headline=headline,
                summary=summary,
                interpretation=interpretation,
                target_ref={"slideId": s["slide_id"], "slideNumber": s["slide_number"]},
                cue={"metric": {"label": "felt sure", "value": f"{round(got_it_pct)}%"}},
                metrics={
                    "slideNumber": s["slide_number"],
                    "gotItPct": round(got_it_pct, 1),
                    "quizSuccessRate": round(float(success), 1),
                    "ratingsTotal": ratings_total,
                    "quizAttempts": attempts,
                },
                evidence_kinds=["confidence_breakdown"],
            )
        )
    return out


# ── Speed Bump (missing transitional link) ────────────────────────────────────
_BUMP_MIN_RETURNS = 2          # students backtracking from the next slide
_BUMP_DWELL_MULT = 1.3
_BUMP_CONFUSION_CEIL = 30.0
_BUMP_MIN_VIEWS = 5


def detect_speed_bump(bundle: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Understandable-looking slides that the *next* slide reveals a gap in."""
    lecture_median = float(bundle.get("lecture_median_dwell") or 0.0)
    out: List[Dict[str, Any]] = []
    for s in bundle.get("slides", []):
        returns = int(s.get("back_nav_from_next") or 0)
        view_count = int(s.get("view_count") or 0)
        if returns < _BUMP_MIN_RETURNS or view_count < _BUMP_MIN_VIEWS:
            continue
        if float(s.get("confusion_rate") or 0) >= _BUMP_CONFUSION_CEIL:
            continue
        median_dwell = float(s.get("median_dwell") or 0)
        dwell_spike = lecture_median > 0 and median_dwell >= lecture_median * _BUMP_DWELL_MULT
        if not dwell_spike:
            continue

        return_rate = returns / max(view_count, 1)
        dwell_factor = schema.clamp01(median_dwell / lecture_median - 1.0) if lecture_median > 0 else 0.0
        severity = schema.clamp01(return_rate / 0.25) * (0.6 + 0.4 * dwell_factor)
        headline, summary, interpretation = copy.speed_bump_copy(s["slide_number"])
        out.append(
            schema.make_insight(
                id=f"{schema.SPEED_BUMP}:{s['slide_id']}",
                kind=schema.SPEED_BUMP,
                scope=schema.SCOPE_SLIDE,
                severity=severity,
                headline=headline,
                summary=summary,
                interpretation=interpretation,
                target_ref={"slideId": s["slide_id"], "slideNumber": s["slide_number"]},
                cue={"metric": {"label": "backtracks", "value": f"{returns}"}},
                metrics={
                    "slideNumber": s["slide_number"],
                    "backtracksFromNext": returns,
                    "medianDwellSeconds": round(median_dwell, 1),
                    "lectureMedianDwellSeconds": round(lecture_median, 1),
                    "viewCount": view_count,
                },
            )
        )
    return out


# ── Calibration Gap (got-it-but-wrong, per student) ───────────────────────────
_CALIB_MIN_PAIRS = 3           # confident students who took the linked quiz
_CALIB_OVERCONF_FLOOR = 35.0   # % of them who were wrong


def detect_calibration_gap(bundle: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Slides where students who said 'got it' then failed the linked quiz."""
    total_students = int(bundle.get("total_students") or 0)
    out: List[Dict[str, Any]] = []
    for s in bundle.get("slides", []):
        pairs = int(s.get("got_it_quiz_total") or 0)
        rate = float(s.get("overconfidence_rate") or 0.0)
        if pairs < _CALIB_MIN_PAIRS or rate < _CALIB_OVERCONF_FLOOR:
            continue

        reach = schema.clamp01(pairs / total_students) if total_students > 0 else 1.0
        severity = schema.clamp01(rate / 100.0) * (0.6 + 0.4 * reach)
        headline, summary, interpretation = copy.calibration_gap_copy(s["slide_number"], rate)
        out.append(
            schema.make_insight(
                id=f"{schema.CALIBRATION_GAP}:{s['slide_id']}",
                kind=schema.CALIBRATION_GAP,
                scope=schema.SCOPE_SLIDE,
                severity=severity,
                headline=headline,
                summary=summary,
                interpretation=interpretation,
                target_ref={"slideId": s["slide_id"], "slideNumber": s["slide_number"]},
                cue={"metric": {"label": "overconfident", "value": f"{round(rate)}%"}},
                metrics={
                    "slideNumber": s["slide_number"],
                    "overconfidenceRate": round(rate, 1),
                    "overconfidentCount": int(s.get("overconfident_count") or 0),
                    "confidentStudents": pairs,
                },
                evidence_kinds=["confidence_breakdown"],
            )
        )
    return out


# ── Overpacked (cognitive overload) ───────────────────────────────────────────
def detect_overpacked(bundle: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Slides carrying too much at once: high confusion + long, erratic dwell + heavy queries."""
    total_students = int(bundle.get("total_students") or 0)
    lecture_median = float(bundle.get("lecture_median_dwell") or 0.0)
    out: List[Dict[str, Any]] = []
    for s in bundle.get("slides", []):
        if not _is_overpacked(s, lecture_median):
            continue
        confusion = float(s.get("confusion_rate") or 0)
        view_count = int(s.get("view_count") or 0)
        dwell_factor = schema.clamp01(float(s.get("median_dwell") or 0) / lecture_median - 1.0) if lecture_median > 0 else 0.0
        reach = schema.clamp01(view_count / total_students) if total_students > 0 else 1.0
        magnitude = schema.clamp01(confusion / _CONFUSION_FULL * 0.7 + dwell_factor * 0.3)
        severity = magnitude * (0.7 + 0.3 * reach)
        headline, summary, interpretation = copy.overpacked_copy(s["slide_number"])
        out.append(
            schema.make_insight(
                id=f"{schema.OVERPACKED}:{s['slide_id']}",
                kind=schema.OVERPACKED,
                scope=schema.SCOPE_SLIDE,
                severity=severity,
                headline=headline,
                summary=summary,
                interpretation=interpretation,
                target_ref={"slideId": s["slide_id"], "slideNumber": s["slide_number"]},
                cue={"metric": {"label": "confused", "value": f"{round(confusion)}%"}},
                metrics={
                    "slideNumber": s["slide_number"],
                    "confusionRate": round(confusion, 1),
                    "medianDwellSeconds": round(float(s.get("median_dwell") or 0), 1),
                    "lectureMedianDwellSeconds": round(lecture_median, 1),
                    "dwellCv": round(float(s.get("dwell_cv") or 0), 2),
                    "aiQueryCount": s.get("ai_query_count", 0),
                    "viewCount": view_count,
                },
            )
        )
    return out


# Registry of active detectors. Extend as catalog kinds ship.
DETECTORS = [
    detect_confusion_hotspot,
    detect_overpacked,
    detect_silent_strugglers,
    detect_leaky_bucket,
    detect_confusion_block,
    detect_skipped_slide,
    detect_silent_misleader,
    detect_speed_bump,
    detect_calibration_gap,
    detect_quiz_misalignment,
    detect_positive_resolution,
]
