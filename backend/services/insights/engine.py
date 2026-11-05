"""Insight engine — gather the bundle, run detectors, rank by severity."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from backend.services import analytics_service
from backend.services.insights import copy, detectors, schema
from backend.services.insights.bundle import build_metric_bundle

logger = logging.getLogger(__name__)


def _slide_numbers(insight: Dict[str, Any], numbers_in_order: List[Any]) -> set:
    """Every slide an insight speaks about, by slide number (a drop-off also speaks of the next slide)."""
    found = set()
    target = insight.get("targetRef") or {}
    if target.get("slideNumber") is not None:
        found.add(target["slideNumber"])
    metrics = insight.get("metrics") or {}
    if metrics.get("startSlide") is not None and metrics.get("endSlide") is not None:
        found.update(n for n in numbers_in_order if metrics["startSlide"] <= n <= metrics["endSlide"])
    for row in (insight.get("detail") or {}).get("slides") or []:
        if row.get("slideNumber") is not None:
            found.add(row["slideNumber"])
    if insight.get("kind") == schema.LEAKY_BUCKET and target.get("slideNumber") in numbers_in_order:
        i = numbers_in_order.index(target["slideNumber"])
        if i + 1 < len(numbers_in_order):
            found.add(numbers_in_order[i + 1])
    return found


def _enough(slide: Dict[str, Any], *keys: str) -> bool:
    return all(int(slide.get(k) or 0) >= analytics_service.MIN_PEOPLE for k in keys)


#: What each kind of finding is a share or a rate OF, so that base must itself be 5+ people.
#: A slide's viewers are checked for every kind; these are the extra bases. The quiz kinds read
#: a success rate that the bundle only carries when 5+ people tried the slide (else None).
_OWN_BASE = {
    schema.CALIBRATION_GAP: lambda s: _enough(s, "got_it_quiz_total"),           # confident people who also took the quiz
    schema.CONFUSION_HOTSPOT: lambda s: _enough(s, "ratings_total"),             # people who rated the page
    schema.OVERPACKED: lambda s: _enough(s, "ratings_total"),
    schema.CONFUSION_BLOCK: lambda s: _enough(s, "ratings_total"),
    schema.SILENT_MISLEADER: lambda s: _enough(s, "ratings_total") and s.get("quiz_success_rate") is not None,
    schema.QUIZ_MISALIGNMENT: lambda s: s.get("quiz_success_rate") is not None,  # people who tried the quiz
    schema.HEALTHY: lambda s: s.get("quiz_success_rate") is not None,
}


def _keep_the_floor(insights: List[Dict[str, Any]], bundle: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Drop any insight about a slide (or a stretch of slides) that fewer than MIN_PEOPLE people viewed,
    or whose own base (the people a share is a share of) is under MIN_PEOPLE.

    The detectors read unfloored per-slide counts; what a slide too few people saw, rated or
    answered says about them is not served. A slide is judged by the bundle's people counts (the
    owner left out); an insight about no slide at all stays.
    """
    by_number = {s.get("slide_number"): s for s in bundle.get("slides", []) if s.get("slide_number") is not None}
    ordered = sorted(by_number)
    kept = []
    for insight in insights:
        numbers = _slide_numbers(insight, ordered)
        own = _OWN_BASE.get(insight.get("kind"))
        ok = True
        for n in numbers:
            slide = by_number.get(n)
            if slide is None or not _enough(slide, "view_count") or (own is not None and not own(slide)):
                ok = False
                break
        if ok:
            kept.append(insight)
    return kept


#: Metrics that are a count of PEOPLE (the bundle counts distinct people, the owner out). A count of 1 to 4
#: people is never shown, so each becomes None; the front end renders None as a dash.
_PEOPLE_COUNT_KEYS = {
    schema.SPEED_BUMP: ("backtracksFromNext",),
    schema.SKIPPED_SLIDE: ("shortViews",),
    schema.OVERPACKED: ("aiQueryCount",),
    schema.CONFUSION_HOTSPOT: ("aiQueryCount", "backNavCount"),
    schema.CALIBRATION_GAP: ("overconfidentCount",),
}

#: Kinds whose cue is that count: with it withheld the cue is dropped, never printed as "None".
_COUNT_CUE = {schema.SPEED_BUMP: "backtracksFromNext"}


def _withheld(value: Any) -> Any:
    return None if isinstance(value, int) and not isinstance(value, bool) and 0 < value < analytics_service.MIN_PEOPLE else value


def _withhold_small_counts(insight: Dict[str, Any], bundle: Dict[str, Any]) -> Dict[str, Any]:
    """Set every people count of 1 to 4 on this insight to None, and rebuild text that printed one."""
    keys = _PEOPLE_COUNT_KEYS.get(insight.get("kind"), ())
    if not keys:
        return insight
    for container in (insight.get("metrics") or {}, insight.get("detail") or {}):
        for k in keys:
            if k in container:
                container[k] = _withheld(container[k])
    cue_key = _COUNT_CUE.get(insight["kind"])
    if cue_key and (insight.get("metrics") or {}).get(cue_key) is None:
        insight["cue"] = {}
    if insight["kind"] == schema.CONFUSION_HOTSPOT:
        # The summary names how many asked and went back; say only what has 5+ people behind it.
        number = (insight.get("targetRef") or {}).get("slideNumber")
        slide = next((s for s in bundle.get("slides", []) if s.get("slide_number") == number), None)
        if slide is not None:
            shown = {k: (v if v is not None and v >= analytics_service.MIN_PEOPLE else 0)
                     for k, v in ((k, slide.get(k)) for k in ("ai_query_count", "back_nav_count"))}
            headline, summary, interpretation = copy.confusion_hotspot_copy({**slide, **shown})
            insight.update(headline=headline, summary=summary, interpretation=interpretation)
    return insight


def build_insights(lecture_id: str, token: Optional[str] = None) -> List[Dict[str, Any]]:
    """Build the ranked insight feed for a lecture.

    Returns a list of insight dicts (frontend `Insight` shape), sorted by
    severity descending. An empty list means nothing crossed a detector's
    gates — the UI renders the calm "healthy" state.
    """
    bundle = build_metric_bundle(lecture_id, token)

    insights: List[Dict[str, Any]] = []
    for detect in detectors.DETECTORS:
        if detect is detectors.detect_silent_strugglers:
            continue  # no learner is ever listed one by one (decided 2026-11-05); the detector stays, unused here
        try:
            insights.extend(detect(bundle))
        except Exception:
            # A single misbehaving detector must never sink the whole feed.
            logger.exception("insight detector failed: %s", getattr(detect, "__name__", detect))

    insights = [_withhold_small_counts(i, bundle) for i in _keep_the_floor(insights, bundle)]
    insights.sort(key=lambda i: i.get("severity", 0.0), reverse=True)
    return insights
