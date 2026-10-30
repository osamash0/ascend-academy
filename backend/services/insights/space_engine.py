"""The insight engine, run on a Space instead of one lecture's RLS view.

The detectors are untouched (spec §1.1): this builds the bundle shape
`bundle.build_metric_bundle` builds, from a Lesson's facts. A page is one
bundle row; its "views" are the people who read it. Then the floor: a
Lesson read by fewer than `MIN_READERS` people says nothing, and no finding
may be about a page fewer than `MIN_READERS` people read (spec B3). People
never enter the bundle: Strugglers is not run here.
"""
from __future__ import annotations

import logging
import statistics
from typing import Any

from backend.services.insights import detectors
from backend.services.insights.bundle import _safe_cv, _safe_median, _safe_quartiles
from backend.services.insights.space_facts import SHORT_VIEW, LessonFacts, PageFacts

logger = logging.getLogger(__name__)

#: People a page, and a Lesson, needs before anything is said about it.
MIN_READERS = 5


def page_row(lesson_id: str, page: int, f: PageFacts) -> dict[str, Any]:
    """One page as the detectors read a slide.

    The people gate: a share the door prints is taken over raters, tryers or clicked
    pairs, not over readers, so each of those counts only the page's readers and says
    nothing until there are `MIN_READERS` of them. Under it, the row holds no ratings,
    no tries and no pairs (the detectors then find nothing to say about them).
    """
    dwell = f.sittings
    p25, p75 = _safe_quartiles(dwell)
    ratings = [r for u, r in f.ratings.items() if u in f.readers]
    if len(ratings) < MIN_READERS:
        ratings = []
    tries = [t for t in f.tries if t.user_id in f.readers]
    if len({t.user_id for t in tries}) < MIN_READERS:
        tries = []
    clicked = [cleared for u, (rating, cleared) in f.pairs.items() if rating == "got_it" and u in f.readers]
    if len(clicked) < MIN_READERS:
        clicked = []
    counts = {r: sum(1 for v in ratings if v == r) for r in ("got_it", "unsure", "confused")}
    rated = sum(counts.values())
    right = sum(1 for t in tries if t.correct)
    missed = sum(1 for cleared in clicked if not cleared)
    return {
        "slide_id": f"{lesson_id}:{page}",
        "slide_number": page,
        "title": str(page),
        "view_count": len(f.readers),
        "avg_dwell": round(statistics.fmean(dwell), 1) if dwell else 0.0,
        "median_dwell": round(_safe_median(dwell), 1),
        "dwell_p25": round(p25, 1),
        "dwell_p75": round(p75, 1),
        "dwell_cv": round(_safe_cv(dwell), 2),
        "short_views": sum(1 for d in dwell if d < SHORT_VIEW),
        "confusion_rate": round(counts["confused"] / rated * 100, 1) if rated else 0.0,
        "quiz_success_rate": round(right / len(tries) * 100, 1) if tries else None,
        "quiz_attempts": len(tries),
        "got_it": counts["got_it"],
        "unsure": counts["unsure"],
        "confused": counts["confused"],
        "ratings_total": rated,
        # Detector rates divide these by view_count: someone who asked or turned
        # back without a counted read is not a reader of this page.
        "ai_query_count": len((f.explain | f.ask) & f.readers),
        "back_nav_count": len(f.returners & f.readers),
        "back_nav_from_next": len(f.from_next & f.readers),
        "overconfident_count": missed,
        "got_it_quiz_total": len(clicked),
        "overconfidence_rate": round(missed / len(clicked) * 100, 1) if clicked else 0.0,
    }


def lesson_bundle(lf: LessonFacts) -> dict[str, Any]:
    """The bundle the detectors read, for one Lesson. Every page anyone read is a row."""
    rows = [page_row(lf.lesson.id, n, pf) for n, pf in sorted(lf.pages.items()) if pf.readers]
    avgs = [r["avg_dwell"] for r in rows if r["avg_dwell"] > 0]
    medians = [r["median_dwell"] for r in rows if r["median_dwell"] > 0]
    return {
        "lecture_id": lf.lesson.id,
        "total_students": len(lf.readers),
        "lecture_avg_dwell": round(statistics.fmean(avgs), 1) if avgs else 0.0,
        "lecture_median_dwell": round(_safe_median(medians), 1),
        "slides": rows,
        "students": [],
    }


def pages_of(insight: dict[str, Any]) -> list[int]:
    """The pages an engine finding is about."""
    metrics = insight.get("metrics") or {}
    if insight.get("kind") == "confusion_block":
        first, last = metrics.get("startSlide"), metrics.get("endSlide")
        return list(range(int(first), int(last) + 1)) if first and last else []
    n = (insight.get("targetRef") or {}).get("slideNumber") or metrics.get("slideNumber")
    return [int(n)] if n else []


def _drop_persists(lf: LessonFacts, page: int) -> bool:
    """A drop after `page` is people stopping only if no later page wins readers back (else it was skipped)."""
    after = len(lf.pages.get(page + 1, PageFacts()).readers)
    return all(len(pf.readers) <= after for n, pf in lf.pages.items() if n > page + 1)


def lesson_insights(lf: LessonFacts) -> list[dict[str, Any]]:
    """Every finding the detectors make on one Lesson, floored."""
    if len(lf.readers) < MIN_READERS:
        return []
    bundle = lesson_bundle(lf)
    found: list[dict[str, Any]] = []
    for detect in detectors.DETECTORS:
        if detect is detectors.detect_silent_strugglers:
            continue  # person-level: never in the owner's view (spec §0)
        try:
            found.extend(detect(bundle))
        except Exception:
            logger.exception("landing: detector failed: %s", getattr(detect, "__name__", detect))

    def above_floor(insight: dict[str, Any]) -> bool:
        pages = pages_of(insight)
        return bool(pages) and all(len(lf.pages.get(p, PageFacts()).readers) >= MIN_READERS for p in pages)

    def kept(insight: dict[str, Any]) -> bool:
        if insight.get("kind") == "leaky_bucket":
            return _drop_persists(lf, pages_of(insight)[0])
        return True

    return [i for i in found if above_floor(i) and kept(i)]
