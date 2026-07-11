"""Mastery bridge: on a review grade, update concept_mastery for any concept
tied to the graded card, reusing the existing Laplace-smoothed mastery_score
formula (backend/services/concept_graph.py::_mastery_score) rather than
reimplementing it.

Known gap, flagged rather than silently glossed over: the `concept_mastery`
table has no other writer anywhere in this codebase today, and the app's
actual student-facing mastery view (`concept_graph.compute_student_mastery`)
computes everything on the fly from `learning_events` — it never reads this
table either. Since Phase 1.1 ships quiz-question cards only (see
card_factory.py's docstring — concept cards are deferred), every card has
`concept_id IS NULL` today, so `record_grade` is a safe no-op in practice.
It's implemented against the real schema so it activates automatically once
concept cards ship; wiring `compute_student_mastery` to also consider this
table (or having this bridge instead emit a `learning_events` row shaped like
`quiz_attempt`) is an explicit follow-up, not resolved here.
"""
from __future__ import annotations

import logging
from uuid import UUID

from backend.services.concept_graph import _mastery_score

logger = logging.getLogger(__name__)


async def record_grade(conn, user_id: str, card_id: UUID, rating: int) -> None:
    concept_id = await conn.fetchval("SELECT concept_id FROM review_cards WHERE id = $1", card_id)
    if concept_id is None:
        return

    row = await conn.fetchrow(
        "SELECT attempts, correct FROM concept_mastery WHERE user_id = $1 AND concept_id = $2",
        user_id, concept_id,
    )
    attempts = (row["attempts"] if row else 0) + 1
    correct = (row["correct"] if row else 0) + (1 if rating >= 3 else 0)
    new_score = _mastery_score(correct, attempts)

    await conn.execute(
        """
        INSERT INTO concept_mastery (user_id, concept_id, attempts, correct, mastery_score, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (user_id, concept_id) DO UPDATE
            SET attempts = $3, correct = $4, mastery_score = $5, updated_at = now()
        """,
        user_id, concept_id, attempts, correct, new_score,
    )
