"""Calibrates SUPPORT_THRESHOLD on real lecture decks (skipped without them).

Each pair cites one real slide. The grounded key is stated on that slide; the
ungrounded key is copied from a different slide of the same deck or carries a
number that is not on the slide. Distractors are off-topic so the ambiguity
gate cannot mask the raw score.

Observed 2026-10-11, 19 pairs (8 DBS English, 11 SR German):
  grounded   min 0.663 (SR slide 7), median 0.816
  ungrounded max 0.339 (SR slide 7), 12 of 19 score 0.0
SUPPORT_THRESHOLD = 0.5 sits at the midpoint; both margins are >= 0.16.
Ablation on the same pairs: no suffix stripping -> grounded min 0.427;
no inverse-slide-frequency weighting -> ungrounded max 0.500.
The pairs live in backend/eval/data/grounding_calibration.py (moved verbatim in Arc 8).
"""
from __future__ import annotations

import statistics

import pytest

from backend.eval.data.grounding_calibration import DBS_PAIRS, SR_PAIRS
from backend.eval.decks import real_deck_pages
from backend.services.parser.deck_plan import build_deck_skeleton
from backend.services.parser.quiz_grounding import SUPPORT_THRESHOLD, assess_grounding, support_score

MARGIN = 0.1
EN_OFF_TOPIC = ["Photosynthesis in chloroplasts", "Plate tectonics", "Baroque counterpoint"]
DE_OFF_TOPIC = ["Photosynthese in Chloroplasten", "Plattentektonik", "Barocker Kontrapunkt"]


def _q(stem, key, distractors, slide):
    return {"question": stem, "options": [key, *distractors], "correctAnswer": key, "source_slide": slide}


@pytest.fixture(scope="module")
def decks():
    dbs = real_deck_pages("00 DBS Introduction.pdf")
    sr = real_deck_pages(" 03__SR_Prozesse_v07_27.04.2025.pdf")  # leading space is real
    if dbs is None or sr is None:
        pytest.skip("real DBS/SR decks not available")
    return build_deck_skeleton(dbs), build_deck_skeleton(sr)


def _scores(decks):
    dbs, sr = decks
    grounded, ungrounded = [], []
    for sk, pairs, off in ((dbs, DBS_PAIRS, EN_OFF_TOPIC), (sr, SR_PAIRS, DE_OFF_TOPIC)):
        for slide, stem, good, bad in pairs:
            grounded.append(support_score(_q(stem, good, off, slide), sk))
            ungrounded.append(support_score(_q(stem, bad, off, slide), sk))
    return grounded, ungrounded


def test_threshold_separates_grounded_from_ungrounded_with_margin(decks):
    grounded, ungrounded = _scores(decks)
    assert max(ungrounded) + MARGIN <= SUPPORT_THRESHOLD <= min(grounded) - MARGIN, (
        f"grounded min={min(grounded):.3f} ungrounded max={max(ungrounded):.3f}"
    )


def test_observed_margins_match_the_recorded_calibration(decks):
    # Tripwire: any scorer change moves these and forces a recalibration.
    grounded, ungrounded = _scores(decks)
    assert min(grounded) == pytest.approx(0.663, abs=0.01)
    assert max(ungrounded) == pytest.approx(0.339, abs=0.01)
    assert statistics.median(grounded) == pytest.approx(0.816, abs=0.01)


def test_real_slide_numbers_matter_off_by_one_is_rejected(decks):
    dbs, _ = decks
    q = _q("How many records did AT&T store in 2015?", "1.9 trillion records", EN_OFF_TOPIC, 24)
    assert assess_grounding(q, dbs).ok
    assert not assess_grounding({**q, "source_slide": 23}, dbs).ok
