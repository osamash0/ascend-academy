"""Insight wire-contract: kinds, attention bands, and the dict shape.

Insights are serialized as plain dicts with **camelCase** keys so they match
the frontend `Insight` TypeScript interface one-to-one (no snake/camel
translation layer). Detectors build insights via :func:`make_insight`.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# ── Insight kinds (the catalog; v1 ships confusion_hotspot) ──────────────────
CONFUSION_HOTSPOT = "confusion_hotspot"
SILENT_MISLEADER = "silent_misleader"
SKIPPED_SLIDE = "skipped_slide"
SPEED_BUMP = "speed_bump"
OVERPACKED = "overpacked"
SILENT_STRUGGLERS = "silent_strugglers"
LEAKY_BUCKET = "leaky_bucket"
CONFUSION_BLOCK = "confusion_block"
QUIZ_MISALIGNMENT = "quiz_misalignment"
CALIBRATION_GAP = "calibration_gap"
HEALTHY = "healthy"

# ── Scopes ───────────────────────────────────────────────────────────────────
SCOPE_SLIDE = "slide"
SCOPE_STUDENT = "student"
SCOPE_QUIZ = "quiz"
SCOPE_LECTURE = "lecture"

# ── Attention bands (drive the teal → sand → coral palette) ──────────────────
ATTENTION_CALM = "calm"
ATTENTION_WATCH = "watch"
ATTENTION_ACT = "act"

_WATCH_FLOOR = 0.33
_ACT_FLOOR = 0.66


def band(severity: float) -> str:
    """Map a 0..1 severity to an attention band."""
    if severity >= _ACT_FLOOR:
        return ATTENTION_ACT
    if severity >= _WATCH_FLOOR:
        return ATTENTION_WATCH
    return ATTENTION_CALM


def clamp01(x: float) -> float:
    """Clamp to the [0, 1] range."""
    if x < 0:
        return 0.0
    if x > 1:
        return 1.0
    return float(x)


def make_insight(
    *,
    id: str,
    kind: str,
    scope: str,
    severity: float,
    headline: str,
    summary: str,
    interpretation: str = "",
    target_ref: Optional[Dict[str, Any]] = None,
    cue: Optional[Dict[str, Any]] = None,
    metrics: Optional[Dict[str, Any]] = None,
    detail: Optional[Dict[str, Any]] = None,
    evidence_kinds: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Build a serialized insight dict with camelCase keys (frontend contract).

    ``metrics`` is a flat map of scalars (for cues/tiles); ``detail`` carries
    richer kind-specific structures (e.g. a student list or slide range) for
    the Layer-2 visualization.
    """
    sev = clamp01(severity)
    return {
        "id": id,
        "kind": kind,
        "scope": scope,
        "severity": round(sev, 4),
        "attention": band(sev),
        "headline": headline,
        "summary": summary,
        "interpretation": interpretation,
        "targetRef": target_ref or {},
        "cue": cue or {},
        "metrics": metrics or {},
        "detail": detail or {},
        "evidenceKinds": evidence_kinds or [],
    }
