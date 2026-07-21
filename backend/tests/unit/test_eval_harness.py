"""Unit tests for the AI eval harness (Roadmap Foundation 10x, Phase 1 P1-3).

Uses FakePipeline throughout (no live API calls — a perfect pipeline by
default) so the harness's own scoring/regression-detection logic can be
verified deterministically. The "seeded regression" tests are the key
proof: they deliberately corrupt one case's actual output and confirm the
resulting score drops below its band AND check_regression flags it —
demonstrating the mechanism the roadmap's acceptance criteria describe
("a deliberate seeded prompt regression drops a score below its band and
the job fails"), without needing a live model to seed a real one.
"""
from __future__ import annotations

import pytest

from backend.eval.golden_sets import (
    QUIZ_GOLDEN_SET,
    RETRIEVAL_GOLDEN_SET,
    TUTOR_FAITHFULNESS_GOLDEN_SET,
)
from backend.eval.judge import _parse_score, judge_synthesis_quality_set
from backend.eval.pipeline import FakePipeline
from backend.eval.run_eval import run_scorecard
from backend.eval.scorer import (
    ScoreBand,
    check_regression,
    score_quiz_key_accuracy,
    score_retrieval_precision_at_k,
    score_tutor_faithfulness,
)


# ── Scorer unit tests ────────────────────────────────────────────────────────

def test_quiz_key_accuracy_perfect_pipeline_scores_1():
    actual = [c.expected_answer_index for c in QUIZ_GOLDEN_SET]
    assert score_quiz_key_accuracy(QUIZ_GOLDEN_SET, actual) == 1.0


def test_quiz_key_accuracy_one_wrong_answer_drops_score():
    actual = [c.expected_answer_index for c in QUIZ_GOLDEN_SET]
    actual[0] = (actual[0] + 1) % len(QUIZ_GOLDEN_SET[0].options)  # seed a wrong answer
    score = score_quiz_key_accuracy(QUIZ_GOLDEN_SET, actual)
    assert score == pytest.approx((len(QUIZ_GOLDEN_SET) - 1) / len(QUIZ_GOLDEN_SET))


def test_quiz_key_accuracy_empty_set_scores_zero_not_nan():
    assert score_quiz_key_accuracy([], []) == 0.0


def test_tutor_faithfulness_grounded_in_expected_slide_scores_1():
    retrieved = [sorted(c.expected_grounded_slide_indices) for c in TUTOR_FAITHFULNESS_GOLDEN_SET]
    assert score_tutor_faithfulness(TUTOR_FAITHFULNESS_GOLDEN_SET, retrieved) == 1.0


def test_tutor_faithfulness_wrong_slides_scores_0_for_that_case():
    retrieved = [sorted(c.expected_grounded_slide_indices) for c in TUTOR_FAITHFULNESS_GOLDEN_SET]
    retrieved[0] = [9999]  # seed: retrieval grounded in a totally wrong slide
    score = score_tutor_faithfulness(TUTOR_FAITHFULNESS_GOLDEN_SET, retrieved)
    assert score == pytest.approx((len(TUTOR_FAITHFULNESS_GOLDEN_SET) - 1) / len(TUTOR_FAITHFULNESS_GOLDEN_SET))


def test_retrieval_precision_at_k_perfect_hits_scores_1_over_k():
    """Each golden case has exactly 1 expected-relevant slide; at k=5 a
    single correct hit gives precision 1/5, not 1.0 — precision@k penalizes
    a short candidate list padded with irrelevant results."""
    retrieved = [sorted(c.expected_relevant_slide_indices) for c in RETRIEVAL_GOLDEN_SET]
    score = score_retrieval_precision_at_k(RETRIEVAL_GOLDEN_SET, retrieved)
    assert score == pytest.approx(1 / 5)


def test_retrieval_precision_at_k_no_hits_scores_0():
    retrieved = [[9999] for _ in RETRIEVAL_GOLDEN_SET]
    assert score_retrieval_precision_at_k(RETRIEVAL_GOLDEN_SET, retrieved) == 0.0


# ── Regression-band tests (the "seeded regression fails the job" contract) ──

def test_check_regression_empty_when_all_scores_meet_band():
    from backend.eval.scorer import Scorecard
    scorecard = Scorecard(
        quiz_key_accuracy=1.0, tutor_faithfulness=1.0,
        retrieval_precision_at_k=1.0, synthesis_quality=1.0,
    )
    assert check_regression(scorecard) == []


def test_check_regression_flags_a_seeded_drop_below_band():
    from backend.eval.scorer import Scorecard
    # Seed a regression: quiz accuracy drops to 0.5, below DEFAULT_BANDS' 0.90.
    scorecard = Scorecard(
        quiz_key_accuracy=0.5, tutor_faithfulness=1.0,
        retrieval_precision_at_k=1.0, synthesis_quality=1.0,
    )
    failing = check_regression(scorecard)
    assert failing == ["quiz_key_accuracy"]


def test_check_regression_respects_custom_bands():
    from backend.eval.scorer import Scorecard
    scorecard = Scorecard(
        quiz_key_accuracy=0.5, tutor_faithfulness=1.0,
        retrieval_precision_at_k=1.0, synthesis_quality=1.0,
    )
    lenient_bands = [ScoreBand(metric="quiz_key_accuracy", minimum=0.3)]
    assert check_regression(scorecard, bands=lenient_bands) == []


# ── End-to-end (FakePipeline) ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_run_scorecard_against_fake_pipeline_perfect_by_default():
    pipeline = FakePipeline()
    scorecard = await run_scorecard(pipeline, judge_fn=None)
    assert scorecard.quiz_key_accuracy == 1.0
    assert scorecard.tutor_faithfulness == 1.0
    # No judge_fn -> synthesis_quality is deliberately 0.0, not silently "fine".
    assert scorecard.synthesis_quality == 0.0


@pytest.mark.asyncio
async def test_run_scorecard_detects_a_seeded_quiz_regression():
    bad_case = QUIZ_GOLDEN_SET[0]
    wrong_answer = (bad_case.expected_answer_index + 1) % len(bad_case.options)
    pipeline = FakePipeline(
        quiz_overrides={f"{bad_case.deck_id}:{bad_case.slide_index}": wrong_answer}
    )
    scorecard = await run_scorecard(pipeline, judge_fn=None)
    failing = check_regression(scorecard)
    assert "quiz_key_accuracy" in failing


@pytest.mark.asyncio
async def test_run_scorecard_with_fake_judge_scores_synthesis_quality():
    async def fake_judge(prompt: str) -> str:
        return "9"

    pipeline = FakePipeline()
    scorecard = await run_scorecard(pipeline, judge_fn=fake_judge)
    assert scorecard.synthesis_quality == pytest.approx(0.9)


# ── Judge parsing ────────────────────────────────────────────────────────────

def test_parse_score_extracts_integer():
    assert _parse_score("7") == 7.0
    assert _parse_score("Score: 10") == 10.0
    assert _parse_score("I'd say a 3 out of 10") == 3.0


def test_parse_score_unparseable_response_scores_zero_not_silently_passing():
    assert _parse_score("I refuse to grade this.") == 0.0


@pytest.mark.asyncio
async def test_judge_synthesis_quality_set_empty_cases_scores_zero():
    async def fake_judge(prompt: str) -> str:
        return "10"

    assert await judge_synthesis_quality_set([], [], fake_judge) == 0.0
