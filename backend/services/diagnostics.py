"""Routing diagnostics — pure helpers for the diagnostics endpoint.

Kept dependency-free (no Supabase, no FastAPI) so the rules can be unit
tested without spinning up the app.  The diagnostics endpoint composes
this module with cache lookups to produce its response.
"""
from __future__ import annotations

from typing import Any, Dict, List


# Heuristic thresholds — intentionally loose so the panel surfaces
# *suspected* misclassifications for a human to review, not certainties.
SKIP_IMAGE_COVERAGE_THRESHOLD = 0.10   # blank-tagged but image-heavy → likely diagram
TEXT_ALPHA_RATIO_THRESHOLD    = 0.30   # text-routed but garbage chars → likely scan


def flag_suspicious(per_slide: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Identify slides whose route looks mismatched against their layout.

    Each input row is expected to have ``slide_index``, ``route`` and
    ``layout_features``.  Two rules:

      * SKIP slide with image_coverage > 0.10 → "skip_with_images"
        Probably a diagram-only slide that tripped the blank-page
        heuristic because it has < 5 words.
      * TEXT slide with alpha_ratio < 0.30 → "text_with_low_alpha"
        Probably a scanned page that should have gone VISION but
        sidestepped it (e.g. via the math override or a no-vision model).

    Returns a list of ``{slide_index, reason}`` dicts.  Rows missing the
    required fields are silently ignored — diagnostics must never crash
    on an old or partially-stamped cache row.
    """
    flags: List[Dict[str, Any]] = []
    for row in per_slide or []:
        if not isinstance(row, dict):
            continue
        try:
            idx = int(row.get("slide_index"))
        except (TypeError, ValueError):
            continue

        route = (row.get("route") or "").lower()
        features = row.get("layout_features") or {}
        if not isinstance(features, dict):
            continue

        image_coverage = _safe_float(features.get("image_coverage"))
        alpha_ratio = _safe_float(features.get("alpha_ratio"))

        if route == "skip" and image_coverage is not None and image_coverage > SKIP_IMAGE_COVERAGE_THRESHOLD:
            flags.append({"slide_index": idx, "reason": "skip_with_images"})
            continue

        if route == "text" and alpha_ratio is not None and alpha_ratio < TEXT_ALPHA_RATIO_THRESHOLD:
            flags.append({"slide_index": idx, "reason": "text_with_low_alpha"})
            continue

    return flags


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
