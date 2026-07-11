"""Property-style tests for the SM-2 review scheduler (backend/services/review/scheduler.py).

No `hypothesis` dependency in this repo — these hand-write the same
properties the plan calls for (monotonicity, same-session lapse, strict
easy>good ordering, lapse-resets-reps) as direct assertions plus small
loops over representative starting states, rather than adding a new
property-testing library for one file.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.services.review.scheduler import new_card_state, schedule

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _graduated_state(reps: int = 3, stability: float = 10.0, difficulty: float = 2.5):
    """A card past the graduating steps, so rating deltas are visible in the
    stability*ease multiplication rather than a fixed graduating interval."""
    from backend.services.review.scheduler import ReviewState
    return ReviewState(
        stability=stability, difficulty=difficulty, reps=reps, lapses=0,
        state="review", due_at=NOW, last_reviewed=NOW - timedelta(days=int(stability)),
    )


def test_rejects_invalid_rating():
    state = new_card_state(NOW)
    for bad in (0, 5, -1, 10):
        with pytest.raises(ValueError):
            schedule(state, bad, NOW)


def test_again_is_due_within_the_same_session():
    for state in (new_card_state(NOW), _graduated_state()):
        result = schedule(state, 1, NOW)
        assert result.due_at - NOW < timedelta(hours=1)


def test_again_resets_reps_and_demotes_a_graduated_card():
    state = _graduated_state(reps=5)
    result = schedule(state, 1, NOW)
    assert result.reps == 0
    assert result.lapses == state.lapses + 1
    assert result.state == "relearning"  # was "review" -> demoted


def test_again_on_a_new_card_stays_in_learning_not_relearning():
    state = new_card_state(NOW)
    result = schedule(state, 1, NOW)
    assert result.state == "learning"  # never graduated, so no "relearning" demotion


@pytest.mark.parametrize("starting_reps", [0, 1, 2, 5, 10])
def test_interval_is_monotone_in_rating(starting_reps):
    """Holding the prior state fixed, a higher rating (hard=2 < good=3 <
    easy=4) never produces a shorter next interval."""
    base = _graduated_state(reps=starting_reps, stability=8.0, difficulty=2.3)
    hard = schedule(base, 2, NOW)
    good = schedule(base, 3, NOW)
    easy = schedule(base, 4, NOW)
    assert hard.stability <= good.stability
    assert good.stability <= easy.stability


@pytest.mark.parametrize("starting_reps", [0, 1, 2, 5, 10])
def test_easy_is_strictly_later_than_good(starting_reps):
    base = _graduated_state(reps=starting_reps, stability=8.0, difficulty=2.3)
    good = schedule(base, 3, NOW)
    easy = schedule(base, 4, NOW)
    assert easy.due_at > good.due_at


def test_ease_floor_is_respected_after_repeated_lapses():
    state = new_card_state(NOW)
    for _ in range(50):
        state = schedule(state, 1, NOW)
    assert state.difficulty >= 1.3 - 1e-9


def test_first_two_successful_reps_use_fixed_graduating_intervals():
    state = new_card_state(NOW)
    first = schedule(state, 3, NOW)
    assert first.reps == 1
    assert first.stability == pytest.approx(1.0)
    assert first.state == "learning"

    second = schedule(first, 3, NOW)
    assert second.reps == 2
    assert second.stability == pytest.approx(6.0)
    assert second.state == "review"  # graduates on the 2nd successful rep


def test_due_at_always_moves_forward_relative_to_last_reviewed():
    state = _graduated_state()
    for rating in (1, 2, 3, 4):
        result = schedule(state, rating, NOW)
        assert result.due_at >= NOW
        assert result.last_reviewed == NOW
