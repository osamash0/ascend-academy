"""Arc 8 pre-registration guards and the held-out threshold rule."""
from __future__ import annotations

import hashlib

import pytest

from backend.eval.data.grounding_calibration import CALIBRATION_SETS, DBS_PAIRS, SR_PAIRS
from backend.eval.data.grounding_probe import CALIBRATION_DECKS, PROBE_PAIRS
from backend.eval.semantic_grounding_eval import Calibration, calibrate_threshold

# Computed from the Arc 4 lists before they moved; any edit to a pair breaks it.
CALIBRATION_SHA256 = "ca8b73bd54f0bfc40b75d1736bf884c5227c8e52780210bbf8ce2e2fb698f475"
PROBE_SHA256 = "8d5299c3b3521a32c92eec41fe091282aa66640888b0e57d151f49b28f640beb"


def test_calibration_pairs_are_the_arc4_pairs_unchanged():
    digest = hashlib.sha256(repr((list(DBS_PAIRS), list(SR_PAIRS))).encode()).hexdigest()
    assert digest == CALIBRATION_SHA256
    assert (len(DBS_PAIRS), len(SR_PAIRS)) == (8, 11)


def test_probe_pairs_are_pre_registered_and_unchanged():
    fields = tuple((p.deck, p.slide, p.stem, p.paraphrased, p.hallucinated, p.language) for p in PROBE_PAIRS)
    assert hashlib.sha256(repr(fields).encode()).hexdigest() == PROBE_SHA256


def test_calibration_sets_use_the_calibration_decks_only():
    assert tuple(deck for deck, _, _ in CALIBRATION_SETS) == CALIBRATION_DECKS
    assert not {deck for deck, _, _ in CALIBRATION_SETS} & {p.deck for p in PROBE_PAIRS}


def test_separable_scores_put_the_threshold_at_the_midpoint():
    cal = calibrate_threshold([0.8, 0.9], [0.2, 0.3])
    assert cal.threshold == pytest.approx(0.55) and cal.errors == 0 and cal.scored == 4


def test_overlap_minimises_errors_then_prefers_the_widest_gap():
    cal = calibrate_threshold([0.4, 0.7, 0.9], [0.1, 0.5])
    assert cal.threshold == pytest.approx(0.25)  # 0.25 (gap 0.3) beats 0.6 (gap 0.2), both 1 error
    assert (cal.false_drops, cal.false_keeps) == (0, 1)


def test_equal_errors_and_gaps_prefer_the_higher_threshold():
    cal = calibrate_threshold([0.3, 0.9], [0.1, 0.7])
    assert cal.threshold == pytest.approx(0.8)


def test_gated_answers_are_carried_not_scored():
    cal = calibrate_threshold([0.8], [0.2], gated=3)
    assert cal.gated == 3 and cal.scored == 2


@pytest.mark.parametrize("grounded, ungrounded", [([], [0.1]), ([0.5], []), ([0.5], [0.5])])
def test_degenerate_input_is_refused(grounded, ungrounded):
    with pytest.raises(ValueError):
        calibrate_threshold(grounded, ungrounded)


def test_calibration_counts_errors_against_its_own_threshold():
    cal = Calibration(threshold=0.5, grounded=(0.1, 0.6), ungrounded=(0.5, 0.2))
    assert (cal.false_drops, cal.false_keeps, cal.errors) == (1, 1, 2)
