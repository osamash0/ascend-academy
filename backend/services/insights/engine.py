"""Insight engine — gather the bundle, run detectors, rank by severity."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from backend.services.insights import detectors
from backend.services.insights.bundle import build_metric_bundle

logger = logging.getLogger(__name__)


def build_insights(lecture_id: str, token: Optional[str] = None) -> List[Dict[str, Any]]:
    """Build the ranked insight feed for a lecture.

    Returns a list of insight dicts (frontend `Insight` shape), sorted by
    severity descending. An empty list means nothing crossed a detector's
    gates — the UI renders the calm "healthy" state.
    """
    bundle = build_metric_bundle(lecture_id, token)

    insights: List[Dict[str, Any]] = []
    for detect in detectors.DETECTORS:
        try:
            insights.extend(detect(bundle))
        except Exception:
            # A single misbehaving detector must never sink the whole feed.
            logger.exception("insight detector failed: %s", getattr(detect, "__name__", detect))

    insights.sort(key=lambda i: i.get("severity", 0.0), reverse=True)
    return insights
