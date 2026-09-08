"""Unit tests for the real-corpus retrieval grid (thesis Section 6).

Everything here runs against pure functions — no database, no API keys, no
model calls — so the metrics the thesis reports are verifiable in CI. The
grid runner itself needs live retrieval and is exercised by running it, not
by these tests.

The tests that matter most are the two about *denominators*: a metric that
quietly drops failed cases inflates every rate above it, and the
false-refusal number is the one the thesis leans on hardest.
"""
from __future__ import annotations

import json

import pytest

from backend.eval.retrieval_grid import (
    GoldenQuestion,
    anchor_found,
    is_grounded_by_threshold,
    load_golden_set,
    precision_at_k,
    reciprocal_rank,
    score_config,
    slide_found,
    to_csv,
    to_markdown_table,
)

LEC = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
RANKED = [(LEC, 4), (LEC, 2), (LEC, 9)]


def _case(idx: int, anchor: str = "anch", cid: str = "c1") -> GoldenQuestion:
    return GoldenQuestion(
        id=str(idx), question="q", lecture_id=LEC, slide_index=idx,
        anchor=anchor, course_id=cid,
    )


# ── slide_found / MRR / precision ────────────────────────────────────────

def test_slide_found_matches_on_lecture_and_index():
    assert slide_found(RANKED, (LEC, 2))
    assert not slide_found(RANKED, (LEC, 7))
    # Same slide index in a DIFFERENT lecture is not a hit — this is what
    # makes the course-scoped regime scoreable through the same code.
    assert not slide_found(RANKED, (OTHER, 2))


@pytest.mark.parametrize("expected,rr", [((LEC, 4), 1.0), ((LEC, 2), 0.5), ((LEC, 9), 1 / 3)])
def test_reciprocal_rank_is_one_over_rank(expected, rr):
    assert reciprocal_rank(RANKED, expected) == pytest.approx(rr)


def test_reciprocal_rank_is_zero_when_absent():
    assert reciprocal_rank(RANKED, (LEC, 7)) == 0.0
    assert reciprocal_rank([], (LEC, 4)) == 0.0


def test_precision_at_k_respects_the_k_cutoff():
    # The expected slide sits at rank 3, so it counts at k=5 but not k=2.
    assert precision_at_k(RANKED, (LEC, 9), 5) == pytest.approx(0.2)
    assert precision_at_k(RANKED, (LEC, 9), 2) == 0.0
    assert precision_at_k(RANKED, (LEC, 4), 0) == 0.0


def test_precision_at_k_ceiling_is_one_over_k():
    """With one relevant slide per question a PERFECT retriever scores 1/k.
    Documented as a test so the number is never read as a failure."""
    assert precision_at_k([(LEC, 1)], (LEC, 1), 5) == pytest.approx(0.2)
    assert precision_at_k([(LEC, 1)], (LEC, 1), 10) == pytest.approx(0.1)


# ── anchor matching ──────────────────────────────────────────────────────

def test_anchor_found_normalises_case_and_whitespace():
    """Slide text comes out of PDF extraction with inconsistent spacing, so
    an exact match would measure extraction noise, not retrieval."""
    assert anchor_found(["Correlation  does\nnot   imply causation"],
                        "correlation does not imply causation")
    assert anchor_found(["A", "B", "the QUEUE frontier"], "the queue frontier")


def test_anchor_found_is_false_without_a_match_or_an_anchor():
    assert not anchor_found(["unrelated text"], "binary search")
    assert not anchor_found(["anything at all"], "")
    assert not anchor_found([], "binary search")


# ── groundedness gate ────────────────────────────────────────────────────

def test_is_grounded_by_threshold_is_a_max_comparison():
    assert is_grounded_by_threshold([0.30, 0.71], 0.65)
    assert not is_grounded_by_threshold([0.30, 0.50], 0.65)
    assert is_grounded_by_threshold([0.65], 0.65)  # boundary is inclusive
    assert not is_grounded_by_threshold([], 0.65)


def test_local_gate_agrees_with_the_production_gate():
    """`is_grounded_by_threshold` is reimplemented so the metrics stay
    importable without the backend installed. This asserts it has not
    drifted from `tutor.is_grounded`, which is the real gate."""
    tutor = pytest.importorskip(
        "backend.services.ai.tutor",
        reason="backend deps not installed; gate-agreement check skipped",
    )
    for sims in ([], [0.1], [0.65], [0.64], [0.2, 0.9]):
        retrieved = [{"similarity": s} for s in sims]
        assert tutor.is_grounded(retrieved, 0.65) == is_grounded_by_threshold(sims, 0.65)


# ── aggregation, and the denominators that decide the headline numbers ───

def test_errors_count_as_retrieval_misses_not_exclusions():
    """A failed lookup is a miss the system really produced. Dropping it
    would silently raise slide_found and MRR for every run with an error."""
    cases = [_case(1), _case(2)]
    outcomes = [
        {"keys": [(LEC, 1)], "texts": ["anch"], "similarities": [0.9], "latency_ms": 10.0},
        {"error": "boom"},
    ]
    r = score_config(cases, outcomes, "lecture_dense", 5, 0.65)
    assert r.n == 2 and r.errors == 1
    assert r.slide_found_rate == pytest.approx(0.5)
    assert r.mrr == pytest.approx(0.5)


def test_gate_metrics_exclude_errored_cases_from_their_denominator():
    """An errored lookup returned no similarities, so the gate never judged
    it. Counting it as a refusal would conflate an infrastructure failure
    with a threshold decision."""
    cases = [_case(1), _case(2), _case(3)]
    outcomes = [
        {"keys": [(LEC, 1)], "texts": ["anch"], "similarities": [0.90], "latency_ms": 10.0},
        {"keys": [(LEC, 8)], "texts": ["nope"], "similarities": [0.10], "latency_ms": 20.0},
        {"error": "boom"},
    ]
    r = score_config(cases, outcomes, "lecture_dense", 5, 0.65)
    # One refusal out of TWO judged cases, not out of three total.
    assert r.refusal_rate == pytest.approx(0.5)
    assert r.slide_found_rate == pytest.approx(1 / 3)  # still over all three


def test_false_refusal_is_a_refusal_that_had_the_answer():
    """The number the thesis leans on: the gate rejected a question whose
    expected slide had in fact been retrieved."""
    cases = [_case(1), _case(2)]
    outcomes = [
        # Expected slide retrieved, but every similarity is below threshold.
        {"keys": [(LEC, 1)], "texts": ["anch"], "similarities": [0.40], "latency_ms": 5.0},
        # Refused and genuinely did not have it — a correct refusal.
        {"keys": [(LEC, 8)], "texts": ["nope"], "similarities": [0.10], "latency_ms": 5.0},
    ]
    r = score_config(cases, outcomes, "course_hybrid", 5, 0.65)
    assert r.refusal_rate == pytest.approx(1.0)
    assert r.false_refusal_rate == pytest.approx(0.5)
    # Of the two refusals, half were wrong.
    assert r.false_refusal_share == pytest.approx(0.5)


def test_no_refusals_leaves_false_refusal_share_at_zero_not_divided_by_zero():
    cases = [_case(1)]
    outcomes = [{"keys": [(LEC, 1)], "texts": ["anch"], "similarities": [0.99], "latency_ms": 1.0}]
    r = score_config(cases, outcomes, "lecture_dense", 5, 0.65)
    assert r.refusal_rate == 0.0
    assert r.false_refusal_share == 0.0


def test_empty_case_list_scores_zero_without_raising():
    r = score_config([], [], "lecture_dense", 5, 0.65)
    assert r.n == 0 and r.mrr == 0.0 and r.false_refusal_share == 0.0


# ── golden-set loading ───────────────────────────────────────────────────

def test_load_golden_set_accepts_both_wrapped_and_bare_json(tmp_path):
    payload = [{"id": "q1", "question": "Q?", "lecture_id": LEC, "slide_index": 3,
                "anchor": "a", "course_id": "c1"}]
    bare = tmp_path / "bare.json"
    bare.write_text(json.dumps(payload), encoding="utf-8")
    wrapped = tmp_path / "wrapped.json"
    wrapped.write_text(json.dumps({"questions": payload}), encoding="utf-8")

    for path in (bare, wrapped):
        cases = load_golden_set(path)
        assert len(cases) == 1
        assert cases[0].key == (LEC, 3)


def test_load_golden_set_rejects_a_malformed_case_loudly(tmp_path):
    """A silently skipped case inflates every score after it."""
    path = tmp_path / "bad.json"
    path.write_text(json.dumps([{"question": "Q?", "lecture_id": LEC}]), encoding="utf-8")
    with pytest.raises(ValueError, match="slide_index"):
        load_golden_set(path)


def test_load_golden_set_rejects_an_empty_set(tmp_path):
    path = tmp_path / "empty.json"
    path.write_text("[]", encoding="utf-8")
    with pytest.raises(ValueError, match="no questions"):
        load_golden_set(path)


# ── rendering ────────────────────────────────────────────────────────────

def test_tables_render_without_raising():
    r = score_config(
        [_case(1)],
        [{"keys": [(LEC, 1)], "texts": ["anch"], "similarities": [0.9], "latency_ms": 12.0}],
        "lecture_dense", 5, 0.65,
    )
    md = to_markdown_table([r])
    assert "lecture_dense" in md and md.startswith("| Regime |")
    csv = to_csv([r])
    assert csv.splitlines()[0].startswith("regime,k,threshold")
