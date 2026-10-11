"""Arc 8 semantic grounding measurement: held-out calibration, then one probe run.

Protocol (pre-registered in docs/superpowers/plans/2026-10-11-arc-8-semantic-grounding.md):
  1. The cosine threshold is fitted ONLY on the Arc 4 calibration pairs
     (backend/eval/data/grounding_calibration.py) with ``calibrate_threshold``.
  2. The probe (backend/eval/data/grounding_probe.py, disjoint decks) is scored
     once at that threshold; its scores never feed back into step 1.
  3. ``decide`` applies the pre-registered gate to the combined scorer.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True)
class Calibration:
    threshold: float
    grounded: tuple[float, ...]
    ungrounded: tuple[float, ...]
    gated: int = 0  # calibration answers decided by a deterministic gate, not scored

    @property
    def false_drops(self) -> int:
        return sum(1 for s in self.grounded if s < self.threshold)

    @property
    def false_keeps(self) -> int:
        return sum(1 for s in self.ungrounded if s >= self.threshold)

    @property
    def errors(self) -> int:
        return self.false_drops + self.false_keeps

    @property
    def scored(self) -> int:
        return len(self.grounded) + len(self.ungrounded)


def calibrate_threshold(grounded: Sequence[float], ungrounded: Sequence[float], gated: int = 0) -> Calibration:
    """Pre-registered rule: candidates are the midpoints between adjacent
    distinct scores; pick the fewest errors (grounded < t plus ungrounded >= t),
    then the widest gap around the midpoint (rounded to 1e-9), then the higher
    threshold. Sees calibration scores only."""
    if not grounded or not ungrounded:
        raise ValueError("calibration needs grounded and ungrounded scores")
    values = sorted(set(grounded) | set(ungrounded))
    if len(values) < 2:
        raise ValueError("calibration scores do not vary; no threshold separates them")
    best: tuple[tuple[int, float, float], float] | None = None
    for lo, hi in zip(values, values[1:]):
        t = (lo + hi) / 2
        errors = sum(1 for s in grounded if s < t) + sum(1 for s in ungrounded if s >= t)
        rank = (errors, -round(hi - lo, 9), -t)
        if best is None or rank < best[0]:
            best = (rank, t)
    return Calibration(best[1], tuple(grounded), tuple(ungrounded), gated)
