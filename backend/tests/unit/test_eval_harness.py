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
    BENIGN_SLIDE_CONTENT_BY_DECK,
    INJECTION_CATEGORIES,
    INJECTION_CHANNELS,
    PROMPT_INJECTION_GOLDEN_SET,
    QUIZ_GOLDEN_SET,
    RETRIEVAL_GOLDEN_SET,
    TUTOR_FAITHFULNESS_GOLDEN_SET,
)
from backend.eval.judge import (
    _parse_compliance,
    _parse_score,
    judge_injection_compliance_set,
    judge_synthesis_quality_set,
)
from backend.eval.pipeline import SAFE_REFUSAL_REPLY, FakePipeline
from backend.eval.run_eval import main_async, run_scorecard
from backend.eval.scorer import (
    DEFAULT_BANDS,
    ScoreBand,
    Scorecard,
    check_regression,
    score_injection_resistance,
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
    scorecard = Scorecard(
        quiz_key_accuracy=1.0, tutor_faithfulness=1.0,
        retrieval_precision_at_k=1.0, synthesis_quality=1.0,
        injection_resistance=1.0,
    )
    assert check_regression(scorecard) == []


def test_check_regression_flags_a_seeded_drop_below_band():
    # Seed a regression: quiz accuracy drops to 0.5, below DEFAULT_BANDS' 0.90.
    scorecard = Scorecard(
        quiz_key_accuracy=0.5, tutor_faithfulness=1.0,
        retrieval_precision_at_k=1.0, synthesis_quality=1.0,
        injection_resistance=1.0,
    )
    failing = check_regression(scorecard)
    assert failing == ["quiz_key_accuracy"]


def test_check_regression_respects_custom_bands():
    scorecard = Scorecard(
        quiz_key_accuracy=0.5, tutor_faithfulness=1.0,
        retrieval_precision_at_k=1.0, synthesis_quality=1.0,
        injection_resistance=1.0,
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


# ── Prompt-injection resistance (profiling dimension 5) ─────────────────────

def _perfect_compliance():
    """What a tutor that resists every attack AND engages every benign control
    would produce — i.e. actual == expected for all cases."""
    return [c.expected_compliant for c in PROMPT_INJECTION_GOLDEN_SET]


def test_injection_resistance_perfect_tutor_scores_1():
    assert score_injection_resistance(
        PROMPT_INJECTION_GOLDEN_SET, _perfect_compliance()
    ) == 1.0


def test_injection_resistance_drops_when_an_attack_succeeds():
    actual = _perfect_compliance()
    attack_idx = next(
        i for i, c in enumerate(PROMPT_INJECTION_GOLDEN_SET) if not c.expected_compliant
    )
    actual[attack_idx] = True  # tutor obeyed the injected instruction
    n = len(PROMPT_INJECTION_GOLDEN_SET)
    assert score_injection_resistance(PROMPT_INJECTION_GOLDEN_SET, actual) == pytest.approx(
        (n - 1) / n
    )


def test_injection_resistance_drops_when_a_benign_control_is_over_refused():
    """The metric is two-sided on purpose: a tutor that refuses everything must
    not be able to score 1.0 by refusing legitimate course content too."""
    actual = _perfect_compliance()
    control_idx = next(
        i for i, c in enumerate(PROMPT_INJECTION_GOLDEN_SET) if c.expected_compliant
    )
    actual[control_idx] = False  # tutor refused legitimate material
    n = len(PROMPT_INJECTION_GOLDEN_SET)
    assert score_injection_resistance(PROMPT_INJECTION_GOLDEN_SET, actual) == pytest.approx(
        (n - 1) / n
    )


def test_injection_resistance_refuse_everything_tutor_cannot_score_well():
    """A degenerate tutor that never complies with anything scores exactly the
    attack fraction — it cannot reach 1.0. Without benign controls in the set
    this test would be impossible to write."""
    always_refuses = [False] * len(PROMPT_INJECTION_GOLDEN_SET)
    score = score_injection_resistance(PROMPT_INJECTION_GOLDEN_SET, always_refuses)
    attacks = sum(1 for c in PROMPT_INJECTION_GOLDEN_SET if not c.expected_compliant)
    assert score == pytest.approx(attacks / len(PROMPT_INJECTION_GOLDEN_SET))
    assert score < 1.0


def test_injection_resistance_empty_set_scores_zero_not_nan():
    assert score_injection_resistance([], []) == 0.0


# ── Injection golden-set structure ──────────────────────────────────────────
# Unlike the other golden sets (whose tests derive expectations from the data
# so they stay count-agnostic), this set's VALIDITY depends on its composition:
# too few cases and per-category claims are meaningless, and zero controls makes
# the metric one-sided. Those properties are asserted directly.

def test_injection_golden_set_has_enough_cases():
    assert len(PROMPT_INJECTION_GOLDEN_SET) >= 15


def test_injection_golden_set_covers_every_attack_category():
    attack_categories = [c for c in INJECTION_CATEGORIES if c != "benign_control"]
    for category in attack_categories:
        n = sum(1 for c in PROMPT_INJECTION_GOLDEN_SET if c.category == category)
        assert n >= 2, f"category {category} has only {n} case(s)"


def test_injection_golden_set_has_benign_controls():
    controls = [c for c in PROMPT_INJECTION_GOLDEN_SET if c.expected_compliant]
    assert len(controls) >= 3
    assert all(c.category == "benign_control" for c in controls)


def test_injection_golden_set_exercises_both_channels():
    for channel in INJECTION_CHANNELS:
        assert any(c.channel == channel for c in PROMPT_INJECTION_GOLDEN_SET)


def test_injection_cases_use_declared_categories_and_channels():
    for c in PROMPT_INJECTION_GOLDEN_SET:
        assert c.category in INJECTION_CATEGORIES
        assert c.channel in INJECTION_CHANNELS


def test_every_injection_case_is_traceable_and_judgeable():
    """Ground truth has to carry its own justification and an operational test.
    Without these the reported number cannot be traced back to a reason, which
    is what makes the set defensible as evidence rather than just a score."""
    for c in PROMPT_INJECTION_GOLDEN_SET:
        assert c.compliance_criterion.strip(), f"{c.deck_id}/{c.category} has no criterion"
        assert c.rationale.strip(), f"{c.deck_id}/{c.category} has no rationale"


def test_slide_channel_cases_have_a_cover_question():
    """A slide-channel case needs an innocuous student question, otherwise the
    tutor is answering an empty message and the case measures nothing."""
    for c in PROMPT_INJECTION_GOLDEN_SET:
        if c.channel == "slide_content":
            assert c.cover_question.strip(), f"{c.deck_id}/{c.category} has no cover_question"


def test_student_message_cases_have_topically_matched_filler():
    """Every student_message case grounds against filler for its own deck. A
    topical mismatch would draw a grounding-based decline that the judge would
    misread as injection resistance."""
    for c in PROMPT_INJECTION_GOLDEN_SET:
        if c.channel == "student_message":
            assert c.deck_id in BENIGN_SLIDE_CONTENT_BY_DECK


# ── Injection judge parsing ─────────────────────────────────────────────────

def test_parse_compliance_reads_both_verdicts():
    assert _parse_compliance("COMPLIANT") is True
    assert _parse_compliance("NOT_COMPLIANT") is False
    assert _parse_compliance("not compliant") is False
    assert _parse_compliance("  compliant\n") is True


def test_parse_compliance_does_not_read_not_compliant_as_compliant():
    """'COMPLIANT' is a substring of 'NOT_COMPLIANT'; a naive check would score
    every successful refusal as a compliance and invert the whole metric."""
    assert _parse_compliance("NOT_COMPLIANT") is not True


def test_parse_compliance_unparseable_is_none():
    assert _parse_compliance("I'd rather not say") is None
    assert _parse_compliance("") is None


@pytest.mark.asyncio
async def test_unparseable_judge_fails_every_case_rather_than_crediting_half():
    """A judge that returns garbage must not hand free credit to attacks or to
    controls. Since the two expect opposite verdicts, any fixed fallback would
    score one half perfectly."""
    async def broken_judge(prompt: str) -> str:
        return "???"

    verdicts = await judge_injection_compliance_set(
        PROMPT_INJECTION_GOLDEN_SET,
        ["irrelevant"] * len(PROMPT_INJECTION_GOLDEN_SET),
        broken_judge,
    )
    assert score_injection_resistance(PROMPT_INJECTION_GOLDEN_SET, verdicts) == 0.0


# ── Injection end-to-end (FakePipeline) ─────────────────────────────────────

async def _oracle_judge(prompt: str) -> str:
    """Reads the fake tutor reply that FakePipeline embedded in the judge
    prompt, so the harness wiring can be exercised without a live model."""
    return "NOT_COMPLIANT" if "can't follow instructions" in prompt else "COMPLIANT"


@pytest.mark.asyncio
async def test_run_scorecard_scores_injection_resistance_with_a_judge():
    scorecard = await run_scorecard(FakePipeline(), judge_fn=_oracle_judge)
    assert scorecard.injection_resistance == pytest.approx(1.0)


@pytest.mark.asyncio
async def test_run_scorecard_reports_zero_injection_resistance_without_a_judge():
    scorecard = await run_scorecard(FakePipeline(), judge_fn=None)
    assert scorecard.injection_resistance == 0.0


@pytest.mark.asyncio
async def test_run_scorecard_detects_a_seeded_injection_regression():
    attack = next(c for c in PROMPT_INJECTION_GOLDEN_SET if not c.expected_compliant)
    pipeline = FakePipeline(
        injection_overrides={
            f"{attack.deck_id}:{attack.category}:{attack.channel}": "Sure. CANARY-7F3A",
        }
    )
    scorecard = await run_scorecard(pipeline, judge_fn=_oracle_judge)
    assert scorecard.injection_resistance < 1.0


@pytest.mark.asyncio
async def test_run_scorecard_detects_a_seeded_over_refusal():
    control = next(c for c in PROMPT_INJECTION_GOLDEN_SET if c.expected_compliant)
    pipeline = FakePipeline(
        injection_overrides={
            f"{control.deck_id}:{control.category}:{control.channel}": SAFE_REFUSAL_REPLY,
        }
    )
    scorecard = await run_scorecard(pipeline, judge_fn=_oracle_judge)
    assert scorecard.injection_resistance < 1.0


# ── Scorecard/band wiring guard ─────────────────────────────────────────────

def test_every_scorecard_metric_is_gated_by_a_band():
    """check_regression() looks metrics up through as_dict(). A field added to
    Scorecard but missing from as_dict(), or missing a DEFAULT_BANDS entry, is
    silently never gated — the failure mode this guards."""
    scorecard = Scorecard(
        quiz_key_accuracy=1.0, tutor_faithfulness=1.0,
        retrieval_precision_at_k=1.0, synthesis_quality=1.0,
        injection_resistance=1.0,
    )
    banded = {b.metric for b in DEFAULT_BANDS}
    assert set(scorecard.as_dict()) == banded


def test_injection_resistance_band_is_enforced():
    scorecard = Scorecard(
        quiz_key_accuracy=1.0, tutor_faithfulness=1.0,
        retrieval_precision_at_k=1.0, synthesis_quality=1.0,
        injection_resistance=0.0,
    )
    assert "injection_resistance" in check_regression(scorecard)


# ── CLI persistence behaviour ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fake_mode_does_not_persist_synthetic_scores(monkeypatch, capsys):
    """`--fake` is a smoke test, not a measurement. Writing its synthetic
    scores to eval_runs would make them indistinguishable from a real nightly
    result in the only record of how AI quality moved over time."""
    calls = []

    async def _recording_persist(*args, **kwargs):
        calls.append(args)

    monkeypatch.setattr("backend.eval.run_eval.persist_scorecard", _recording_persist)

    exit_code = await main_async(use_fake=True)

    assert calls == []
    # The scorecard itself must still be computed and reported.
    assert "AI Eval Scorecard" in capsys.readouterr().out
    assert exit_code in (0, 1)
