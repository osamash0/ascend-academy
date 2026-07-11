"""Property-style tests for the Exam Mode sampler (backend/services/exam_service.py).

No `hypothesis` dependency in this repo (see test_review_scheduler.py's same
note) — these hand-write the roadmap's own acceptance-criteria properties as
direct assertions over a synthetic pool, rather than adding a new
property-testing library for one file.
"""
from __future__ import annotations

from typing import Any, Dict, List

import pytest

from backend.services.exam_service import sample_questions

NUM_CONCEPTS = 10
QUESTIONS_PER_CONCEPT = 5


def _make_pool(num_concepts: int = NUM_CONCEPTS, per_concept: int = QUESTIONS_PER_CONCEPT) -> List[Dict[str, Any]]:
    pool = []
    for c in range(num_concepts):
        for i in range(per_concept):
            pool.append({
                "id": f"c{c}-q{i}",
                "concept": f"concept-{c}",
                "difficulty": ["easy", "medium", "hard"][i % 3],
            })
    return pool


def _neutral_weights(pool: List[Dict[str, Any]]) -> Dict[str, float]:
    return {q["id"]: 1.0 for q in pool}


# ── determinism ───────────────────────────────────────────────────────────────

def test_same_seed_same_result():
    pool = _make_pool()
    weights = _neutral_weights(pool)
    a = sample_questions(pool, weights, 20, seed=42)
    b = sample_questions(pool, weights, 20, seed=42)
    assert a == b


def test_returns_exactly_num_questions_or_pool_size():
    pool = _make_pool()
    assert len(sample_questions(pool, _neutral_weights(pool), 20, seed=1)) == 20
    assert len(sample_questions(pool, _neutral_weights(pool), 1000, seed=1)) == len(pool)


def test_never_duplicates_a_question():
    pool = _make_pool()
    picked = sample_questions(pool, _neutral_weights(pool), 30, seed=7)
    assert len(picked) == len(set(picked))


# ── coverage ───────────────────────────────────────────────────────────────────

def test_coverage_spans_at_least_70pct_of_distinct_concepts():
    pool = _make_pool()  # 10 distinct concepts, 50 questions
    picked = sample_questions(pool, _neutral_weights(pool), 25, seed=3)
    by_id = {q["id"]: q for q in pool}
    covered = {by_id[qid]["concept"] for qid in picked}
    assert len(covered) / NUM_CONCEPTS >= 0.70


def test_coverage_holds_across_many_seeds():
    pool = _make_pool()
    by_id = {q["id"]: q for q in pool}
    for seed in range(20):
        picked = sample_questions(pool, _neutral_weights(pool), 25, seed=seed)
        covered = {by_id[qid]["concept"] for qid in picked}
        assert len(covered) / NUM_CONCEPTS >= 0.70, f"seed={seed} only covered {len(covered)} concepts"


# ── variety across seeds ───────────────────────────────────────────────────────

def test_two_generations_overlap_less_than_50pct():
    pool = _make_pool()
    weights = _neutral_weights(pool)
    overlaps = []
    for seed_a, seed_b in [(1, 2), (10, 11), (100, 200), (5, 55), (42, 43)]:
        a = set(sample_questions(pool, weights, 20, seed=seed_a))
        b = set(sample_questions(pool, weights, 20, seed=seed_b))
        overlaps.append(len(a & b) / len(a))
    avg_overlap = sum(overlaps) / len(overlaps)
    assert avg_overlap < 0.50, f"average overlap {avg_overlap:.2f} too high across seed pairs"


# ── weak-concept weighting is observable ──────────────────────────────────────

def test_weak_concept_gets_more_reps_than_a_fresh_students_neutral_weighting():
    pool = _make_pool(num_concepts=3, per_concept=20)  # 60 questions, plenty of room for extra reps
    neutral = _neutral_weights(pool)
    weak = dict(neutral)
    for q in pool:
        if q["concept"] == "concept-0":
            weak[q["id"]] = 5.0  # this student is weak on concept-0

    by_id = {q["id"]: q for q in pool}

    def concept0_count(weights, seed):
        picked = sample_questions(pool, weights, 15, seed=seed)
        return sum(1 for qid in picked if by_id[qid]["concept"] == "concept-0")

    # Average over several seeds so this isn't a fluke of one draw.
    weak_counts = [concept0_count(weak, s) for s in range(10)]
    neutral_counts = [concept0_count(neutral, s) for s in range(10)]
    assert sum(weak_counts) / len(weak_counts) > sum(neutral_counts) / len(neutral_counts)


def test_empty_pool_returns_empty():
    assert sample_questions([], {}, 20, seed=1) == []


# ── compute_weakness_weights (DB-adjacent logic, mastery client stubbed) ──────

class _FakeMasteryClient:
    """Stand-in for the supabase client compute_student_mastery would use —
    never actually reached because we monkeypatch compute_student_mastery
    itself below; this class exists only so the call signature matches."""


@pytest.mark.asyncio
async def test_compute_weakness_weights_uses_live_mastery_not_neutral_for_known_weak_concept(monkeypatch):
    import backend.services.exam_service as exam_service

    async def fake_compute_student_mastery(user_id, *, client=None):
        return {
            "vector": [
                {"concept_id": "x", "name": "Recursion", "attempts": 5, "correct": 1, "mastery_score": 0.2},
            ],
            "mastered": [],
            "weak": [],
        }

    monkeypatch.setattr(exam_service, "compute_student_mastery", fake_compute_student_mastery)

    pool = [
        {"id": "q1", "concept": "Recursion", "difficulty": "medium"},
        {"id": "q2", "concept": "Never Attempted Topic", "difficulty": "medium"},
    ]
    weights = await exam_service.compute_weakness_weights("user-1", pool)

    # Known weak concept (mastery_score=0.2 -> weakness 0.8) outweighs an
    # unseen concept, which falls back to the neutral 0.5 cold-start weight.
    assert weights["q1"] > weights["q2"]
