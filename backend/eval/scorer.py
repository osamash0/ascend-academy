"""Pure scoring functions for the AI eval harness (Roadmap P1-3).

Each `score_*` function takes a golden set + the pipeline's actual outputs
for those cases and returns a 0.0-1.0 score. Kept as pure functions (no I/O)
so they're trivially unit-testable and reusable outside the CLI runner.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

from backend.eval.golden_sets import (
    QuizGoldenCase,
    RetrievalCase,
    TutorFaithfulnessCase,
)


def score_quiz_key_accuracy(
    cases: List[QuizGoldenCase], actual_answers: List[int]
) -> float:
    """Fraction of quiz questions where the pipeline's chosen answer index
    matches the human-verified expected answer index."""
    if not cases:
        return 0.0
    correct = sum(
        1 for case, actual in zip(cases, actual_answers)
        if actual == case.expected_answer_index
    )
    return correct / len(cases)


def score_tutor_faithfulness(
    cases: List[TutorFaithfulnessCase], retrieved_indices: List[List[int]]
) -> float:
    """Fraction of tutor questions where at least one of the actually-
    grounding slides (per human review) was among the slides retrieved —
    i.e. the tutor's answer COULD have been grounded correctly, as opposed
    to being built entirely from irrelevant context."""
    if not cases:
        return 0.0
    faithful = sum(
        1 for case, retrieved in zip(cases, retrieved_indices)
        if case.expected_grounded_slide_indices & set(retrieved)
    )
    return faithful / len(cases)


def score_retrieval_precision_at_k(
    cases: List[RetrievalCase], retrieved_indices: List[List[int]]
) -> float:
    """Mean precision@k across cases: |retrieved ∩ expected| / k."""
    if not cases:
        return 0.0
    precisions = []
    for case, retrieved in zip(cases, retrieved_indices):
        top_k = retrieved[: case.k]
        hits = len(set(top_k) & case.expected_relevant_slide_indices)
        precisions.append(hits / case.k)
    return sum(precisions) / len(cases)


@dataclass(frozen=True)
class Scorecard:
    quiz_key_accuracy: float
    tutor_faithfulness: float
    retrieval_precision_at_k: float
    synthesis_quality: float

    def as_dict(self) -> Dict[str, float]:
        return {
            "quiz_key_accuracy": self.quiz_key_accuracy,
            "tutor_faithfulness": self.tutor_faithfulness,
            "retrieval_precision_at_k": self.retrieval_precision_at_k,
            "synthesis_quality": self.synthesis_quality,
        }


@dataclass(frozen=True)
class ScoreBand:
    """The minimum acceptable value for one scorecard metric. A run whose
    score falls below `minimum` on any band is a regression."""
    metric: str
    minimum: float


# retrieval_precision_at_k's ceiling is capped by how many relevant slides
# exist per golden-set query (backend/eval/golden_sets.py's RETRIEVAL_GOLDEN_SET
# has exactly 1 expected-relevant slide per case at k=5, so a PERFECT
# pipeline scores 1/5 = 0.20) — the band is tuned against that ceiling, not
# an arbitrary "0.60 sounds good" number. Extend the golden set with
# multi-relevant-slide cases before raising this band, or the band becomes
# unattainable even by a perfect pipeline.
DEFAULT_BANDS: List[ScoreBand] = [
    ScoreBand(metric="quiz_key_accuracy", minimum=0.90),
    ScoreBand(metric="tutor_faithfulness", minimum=0.85),
    ScoreBand(metric="retrieval_precision_at_k", minimum=0.15),
    ScoreBand(metric="synthesis_quality", minimum=0.70),
]


def check_regression(
    scorecard: Scorecard, bands: Optional[List[ScoreBand]] = None
) -> List[str]:
    """Returns the names of every metric that fell below its band's minimum.
    An empty list means the run passed — no regression detected."""
    bands = bands if bands is not None else DEFAULT_BANDS
    scores = scorecard.as_dict()
    failing = []
    for band in bands:
        value = scores.get(band.metric)
        if value is not None and value < band.minimum:
            failing.append(band.metric)
    return failing
