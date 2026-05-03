"""Slide-level recommendation rubric.

Pure helper that turns a slide's existing analytics signals
(drop-off %, confusion %, quiz success %, view count) into a
human-readable label plus the list of contributing reason codes.

All thresholds live as module-level constants so they're trivial to
tune without touching call sites or tests. The rubric is intentionally
opinionated and transparent — every reason code maps 1:1 to a
visible explanation in the UI.
"""
from __future__ import annotations

from typing import List, Tuple, Optional

# ── Tunable thresholds ───────────────────────────────────────────────────────
MIN_VIEWS_FOR_LABEL = 5            # below this, we report "insufficient_data"

DROPOFF_HIGH = 25.0                # > this % is a "needs_review" signal
DROPOFF_LOW = 5.0                  # ≤ this % counts toward "outstanding"

CONFUSION_HIGH = 30.0
CONFUSION_LOW = 10.0

QUIZ_SUCCESS_LOW = 50.0            # < this % is a "needs_review" signal
QUIZ_SUCCESS_HIGH = 85.0           # ≥ this % counts toward "outstanding"


Label = str  # one of: "needs_review" | "satisfactory" | "outstanding" | "insufficient_data"


def compute_slide_recommendation(
    *,
    drop_off_rate: float,
    confusion_rate: float,
    quiz_success_rate: Optional[float],
    view_count: int,
    quiz_attempts: int = 0,
) -> Tuple[Label, List[str]]:
    """Return (label, reasons) for a single slide.

    quiz_success_rate may be None when the slide has no quiz; in that
    case it neither penalizes nor rewards the label.
    """
    if view_count < MIN_VIEWS_FOR_LABEL:
        return "insufficient_data", ["low_view_count"]

    reasons: List[str] = []

    # Negative signals → "needs_review"
    if drop_off_rate > DROPOFF_HIGH:
        reasons.append("high_dropoff")
    if confusion_rate > CONFUSION_HIGH:
        reasons.append("high_confusion")
    if quiz_attempts > 0 and quiz_success_rate is not None and quiz_success_rate < QUIZ_SUCCESS_LOW:
        reasons.append("low_quiz_success")

    if reasons:
        return "needs_review", reasons

    # Positive signals → "outstanding" requires every available metric to be strong.
    strong_dropoff = drop_off_rate <= DROPOFF_LOW
    strong_confusion = confusion_rate <= CONFUSION_LOW
    has_quiz = quiz_attempts > 0 and quiz_success_rate is not None
    strong_quiz = (not has_quiz) or (quiz_success_rate or 0) >= QUIZ_SUCCESS_HIGH

    if strong_dropoff and strong_confusion and strong_quiz:
        positives = ["low_dropoff", "low_confusion"]
        if has_quiz:
            positives.append("high_quiz_success")
        return "outstanding", positives

    return "satisfactory", []
