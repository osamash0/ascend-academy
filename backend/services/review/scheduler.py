"""SM-2-based spaced-repetition scheduler for the review engine.

Locked decision: SM-2 first, behind a STABLE interface (`schedule(state,
rating, now) -> new_state`) so an FSRS swap later needs no schema change —
`review_schedule`'s `stability`/`difficulty` columns are named for that
future swap; today they hold "current interval in days" and "SM-2 ease
factor" respectively.

Rating scale (matches the review UI's 4 grade buttons): 1=again, 2=hard,
3=good, 4=easy.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Literal, Optional

ReviewCardState = Literal["new", "learning", "review", "relearning"]

MIN_EASE = 1.3
DEFAULT_EASE = 2.5

# Graduating intervals (days) for the first two successful reps of a card
# that has never reached "review" state — classic SM-2/Anki progression.
FIRST_INTERVAL_DAYS = 1.0
SECOND_INTERVAL_DAYS = 6.0

# A failed ("again") card is due back within the same session, not days out.
RELEARNING_INTERVAL_DAYS = 10.0 / (24 * 60)  # 10 minutes, expressed in days


@dataclass(frozen=True)
class ReviewState:
    stability: float  # current interval, in days
    difficulty: float  # SM-2 ease factor
    reps: int
    lapses: int
    state: ReviewCardState
    due_at: datetime
    last_reviewed: Optional[datetime] = None


def new_card_state(now: datetime) -> ReviewState:
    """The state a freshly-created review_schedule row starts in."""
    return ReviewState(
        stability=0.0,
        difficulty=DEFAULT_EASE,
        reps=0,
        lapses=0,
        state="new",
        due_at=now,
        last_reviewed=None,
    )


def schedule(state: ReviewState, rating: int, now: datetime) -> ReviewState:
    """Advance a card's schedule after a grade. Pure — no I/O, no clock reads."""
    if rating not in (1, 2, 3, 4):
        raise ValueError(f"rating must be 1-4, got {rating}")

    if rating == 1:
        # "Again": lapse. Reps reset, ease drops, due back almost immediately.
        # A card that had graduated to "review" is demoted to "relearning";
        # a card still in "new"/"learning" just stays in "learning".
        new_ease = max(MIN_EASE, state.difficulty - 0.2)
        new_card_stage: ReviewCardState = "relearning" if state.state == "review" else "learning"
        return replace(
            state,
            stability=RELEARNING_INTERVAL_DAYS,
            difficulty=new_ease,
            reps=0,
            lapses=state.lapses + 1,
            state=new_card_stage,
            due_at=now + timedelta(days=RELEARNING_INTERVAL_DAYS),
            last_reviewed=now,
        )

    # rating in (2, 3, 4): a successful recall, with a per-grade ease delta
    # and interval multiplier — "hard" grows the interval the least, "easy"
    # the most, so interval(easy) is always strictly > interval(good) for
    # the same prior state, and interval(hard) < interval(good).
    ease_delta = {2: -0.15, 3: 0.0, 4: 0.15}[rating]
    bonus_multiplier = {2: 1.0, 3: 1.0, 4: 1.3}[rating]
    new_ease = max(MIN_EASE, state.difficulty + ease_delta)
    new_reps = state.reps + 1

    if new_reps == 1:
        new_interval = FIRST_INTERVAL_DAYS
    elif new_reps == 2:
        new_interval = SECOND_INTERVAL_DAYS
    else:
        new_interval = state.stability * new_ease
    new_interval *= bonus_multiplier

    new_card_stage = "review" if new_reps >= 2 else "learning"

    return replace(
        state,
        stability=new_interval,
        difficulty=new_ease,
        reps=new_reps,
        lapses=state.lapses,
        state=new_card_stage,
        due_at=now + timedelta(days=new_interval),
        last_reviewed=now,
    )
