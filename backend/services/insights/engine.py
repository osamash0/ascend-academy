"""Insight engine — gather the bundle, run detectors, rank by severity."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from backend.services import analytics_service
from backend.services.insights import detectors, schema
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


def _keep_the_floor(insights: List[Dict[str, Any]], bundle: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Drop any insight about a slide (or a stretch of slides) that fewer than MIN_PEOPLE people viewed.

    The detectors read unfloored per-slide counts; what a slide too few people saw says about
    them is not served. A slide is judged by the bundle's people-per-slide count (the owner left
    out); an insight about no slide at all stays.
    """
    viewers = {s.get("slide_number"): int(s.get("view_count") or 0) for s in bundle.get("slides", [])}
    ordered = sorted(n for n in viewers if n is not None)
    kept = []
    for insight in insights:
        slides = _slide_numbers(insight, ordered)
        if all(viewers.get(n, 0) >= analytics_service.MIN_PEOPLE for n in slides):
            kept.append(insight)
    return kept


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

    insights = _keep_the_floor(insights, bundle)
    insights.sort(key=lambda i: i.get("severity", 0.0), reverse=True)
    return insights
