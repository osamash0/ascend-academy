"""Exam Mode — course-wide mock-exam sampler (Roadmap Phase 1.2).

No existing helper aggregates quiz_questions course-wide: `analytics_service.
_compute_quiz_analytics` is lecture-scoped only. This module builds that pool,
then samples from it with a coverage-first, weakness-weighted, seeded
algorithm — see `project_docs/exam_mode_plan.md` for the grounded decisions
behind it (notably: reads live-computed `concept_graph.compute_student_mastery`
for weakness, NOT the `concept_mastery` table, which has no real writer).
"""
from __future__ import annotations

import json
import logging
import random
from typing import Any, Dict, List, Optional, Sequence
from uuid import UUID

from backend.services.concept_graph import _normalize, compute_student_mastery
from backend.services.review.card_factory import _content_hash, _insert_card

logger = logging.getLogger(__name__)

MIN_WEIGHT = 0.05  # never fully zero out a question — a lucky-weak student still sees some variety
_DIFFICULTY_BOOST = {"hard": 1.2, "medium": 1.0, "easy": 0.8}


async def fetch_course_question_pool(conn, course_id: UUID) -> List[Dict[str, Any]]:
    """All quiz_questions from the course's non-archived lectures.

    `ORDER BY q.id` matters beyond readability: the sampler's determinism
    (same seed -> same picks) depends on the pool arriving in a stable order.
    """
    rows = await conn.fetch(
        """
        SELECT q.id, q.slide_id, q.question_text, q.options, q.correct_answer, q.metadata
        FROM quiz_questions q
        JOIN slides s ON s.id = q.slide_id
        JOIN lectures l ON l.id = s.lecture_id
        WHERE l.course_id = $1 AND l.is_archived = false
        ORDER BY q.id
        """,
        course_id,
    )
    pool: List[Dict[str, Any]] = []
    for r in rows:
        options = r["options"] or []
        if isinstance(options, str):
            options = json.loads(options)
        metadata = r["metadata"] or {}
        if isinstance(metadata, str):
            metadata = json.loads(metadata)
        pool.append({
            "id": str(r["id"]),
            "slide_id": str(r["slide_id"]),
            "question_text": r["question_text"],
            "options": options,
            "correct_answer": r["correct_answer"],
            "concept": (metadata.get("concept") or "").strip(),
            "difficulty": (metadata.get("difficulty") or "").strip().lower(),
        })
    return pool


async def compute_weakness_weights(
    user_id: str,
    pool: Sequence[Dict[str, Any]],
    *,
    client=None,
) -> Dict[str, float]:
    """Question id -> relative pick weight, from the student's LIVE concept
    mastery (`concept_graph.compute_student_mastery`) — not the `concept_mastery`
    table, which nothing in this codebase actually writes to today.

    Matches by normalized concept text rather than joining through the
    `concepts` catalog's alias resolution again: `compute_student_mastery`'s
    vector and this pool's `metadata.concept` strings both ultimately reduce
    to the same text comparison, so re-deriving concept_ids here would just
    add a redundant DB round-trip. A concept the student has never attempted
    gets a neutral weight (cold start — neither weak nor strong).
    """
    mastery = await compute_student_mastery(user_id, client=client)
    weakness_by_concept: Dict[str, float] = {
        _normalize(v["name"]): (1.0 - v["mastery_score"]) for v in mastery["vector"]
    }
    weights: Dict[str, float] = {}
    for q in pool:
        concept_norm = _normalize(q.get("concept") or "")
        base = weakness_by_concept.get(concept_norm, 0.5)  # unseen concept = neutral
        boost = _DIFFICULTY_BOOST.get(q.get("difficulty") or "", 1.0)
        weights[q["id"]] = max(base * boost, MIN_WEIGHT)
    return weights


def _a_res_key(rng: random.Random, weight: float) -> float:
    """Weighted-sampling-without-replacement key (A-Res / A-ExpJ algorithm):
    larger key = more likely to be picked. Sorting descending and taking the
    top N is a proper weighted sample without replacement, and composes
    cleanly across the two phases below (each phase just sorts by this key)."""
    w = max(weight, MIN_WEIGHT)
    u = rng.random()
    return u ** (1.0 / w)


def sample_questions(
    pool: Sequence[Dict[str, Any]],
    weight_by_id: Dict[str, float],
    num_questions: int,
    seed: int,
) -> List[str]:
    """Stratified, weighted, seeded sample of question ids from `pool`.

    `pool` items need only `{"id", "concept"}` — concept is a raw grouping
    key (this course's own `metadata.concept` text), no canonical
    concept-catalog resolution needed for coverage purposes. `weight_by_id`
    maps question id -> relative pick weight (unknown ids default to neutral
    1.0). Deterministic: the same (pool order, weight_by_id, seed) always
    returns the same ids in the same order — required for the roadmap's own
    acceptance criterion that a given seed is reproducible.

    Two phases, matching the roadmap's "coverage first, then weighting" spec:
      1. Coverage — one question per distinct concept. Concept pick ORDER is
         itself weighted (by that concept's max question weight) so weak
         concepts are more likely to survive when num_questions is too small
         to cover every concept.
      2. Fill — remaining slots drawn from whatever's left, weighted by
         weight_by_id, so weak concepts also get extra reps beyond their one
         guaranteed coverage slot.
    """
    rng = random.Random(seed)
    num_questions = min(num_questions, len(pool))
    if num_questions <= 0:
        return []

    def w(qid: str) -> float:
        return weight_by_id.get(qid, 1.0)

    by_concept: Dict[str, List[Dict[str, Any]]] = {}
    for q in pool:
        by_concept.setdefault(q.get("concept") or "", []).append(q)

    concept_order = sorted(
        by_concept.keys(),
        key=lambda c: _a_res_key(rng, max((w(q["id"]) for q in by_concept[c]), default=1.0)),
        reverse=True,
    )

    selected: List[str] = []
    selected_set = set()
    remaining_by_concept = {c: list(qs) for c, qs in by_concept.items()}

    for c in concept_order:
        if len(selected) >= num_questions:
            break
        candidates = remaining_by_concept[c]
        if not candidates:
            continue
        pick = max(candidates, key=lambda q: _a_res_key(rng, w(q["id"])))
        candidates.remove(pick)
        selected.append(pick["id"])
        selected_set.add(pick["id"])

    leftover = [q for qs in remaining_by_concept.values() for q in qs if q["id"] not in selected_set]
    leftover.sort(key=lambda q: _a_res_key(rng, w(q["id"])), reverse=True)
    for q in leftover:
        if len(selected) >= num_questions:
            break
        selected.append(q["id"])
        selected_set.add(q["id"])

    rng.shuffle(selected)
    return selected


# ── Grading + report ──────────────────────────────────────────────────────────

async def grade(conn, attempt_row, answers: Dict[str, Any]) -> Dict[str, Any]:
    """Server-side correctness check + weak-concept report.

    Deep links (concept -> slide) are built entirely from THIS exam's own
    sampled questions' `slide_id` — never `concept_lectures.slide_indices`,
    which isn't reliably populated by the parse pipeline (roadmap correction
    #3 in exam_mode_plan.md). `answers` is trusted only as "which option did
    the student pick" — correctness is always recomputed against
    `quiz_questions.correct_answer`, never trusted from the client.
    """
    question_ids = attempt_row["question_ids"]
    rows = await conn.fetch(
        "SELECT id, slide_id, correct_answer, metadata FROM quiz_questions WHERE id = ANY($1::uuid[])",
        question_ids,
    )
    by_id: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        meta = r["metadata"] or {}
        if isinstance(meta, str):
            meta = json.loads(meta)
        by_id[str(r["id"])] = {
            "slide_id": str(r["slide_id"]),
            "correct_answer": r["correct_answer"],
            "concept": (meta.get("concept") or "").strip() or "Uncategorized",
        }

    concept_stats: Dict[str, Dict[str, Any]] = {}
    correct_count = 0
    missed_question_ids: List[str] = []
    total = len(question_ids)

    for qid in question_ids:
        qid_str = str(qid)
        q = by_id.get(qid_str)
        if q is None:
            total -= 1  # question was deleted/archived since the exam was generated
            continue
        given = answers.get(qid_str)
        is_correct = given is not None and _coerce_int(given) == q["correct_answer"]
        if is_correct:
            correct_count += 1
        else:
            missed_question_ids.append(qid_str)
        bucket = concept_stats.setdefault(q["concept"], {"correct": 0, "total": 0, "missed_slide_ids": []})
        bucket["total"] += 1
        if is_correct:
            bucket["correct"] += 1
        else:
            bucket["missed_slide_ids"].append(q["slide_id"])

    score = round(100.0 * correct_count / total, 1) if total else 0.0

    all_missed_slide_ids = sorted({sid for s in concept_stats.values() for sid in s["missed_slide_ids"]})
    slide_meta: Dict[str, Dict[str, Any]] = {}
    if all_missed_slide_ids:
        slide_rows = await conn.fetch(
            "SELECT id, lecture_id, slide_number FROM slides WHERE id = ANY($1::uuid[])",
            all_missed_slide_ids,
        )
        slide_meta = {
            str(r["id"]): {"slide_id": str(r["id"]), "lecture_id": str(r["lecture_id"]), "slide_number": r["slide_number"]}
            for r in slide_rows
        }

    weakest = sorted(
        (
            {
                "concept": concept,
                "correct": s["correct"],
                "total": s["total"],
                "miss_rate": round(1 - s["correct"] / s["total"], 2),
                "slides": [slide_meta[sid] for sid in sorted(set(s["missed_slide_ids"])) if sid in slide_meta],
            }
            for concept, s in concept_stats.items()
            if s["total"] - s["correct"] > 0  # only concepts with >=1 miss count as "weak"
        ),
        key=lambda c: (-c["miss_rate"], -c["total"]),
    )[:3]

    return {
        "score": score,
        "correct_count": correct_count,
        "total": total,
        "weakest_concepts": weakest,
        "missed_question_ids": missed_question_ids,
    }


def _coerce_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# ── "Send misses to review" bridge into Daily Ascent ─────────────────────────

async def send_misses_to_review(conn, attempt_row, user_id: str) -> Dict[str, int]:
    """Push this exam's missed questions into the student's Daily Review queue.

    Reuses review/card_factory's exact card-creation shape (same content_hash
    scheme) so this is idempotent two ways: calling it twice for the same
    exam creates zero duplicate cards, AND if the lecture's normal
    card-factory Arq job already created these cards, `ON CONFLICT DO
    NOTHING` (inside `_insert_card`) means we just reuse them rather than
    duplicating. Then lazily creates `review_schedule` rows for any of those
    cards the student doesn't have one for yet, scoped to just this exam's
    cards (not a full-course sweep like `review.py`'s `_activate_new_cards`).
    """
    report = attempt_row["concept_report"]
    if isinstance(report, str):
        report = json.loads(report)
    missed_question_ids = (report or {}).get("missed_question_ids", [])
    if not missed_question_ids:
        return {"cards_created": 0, "cards_activated": 0}

    rows = await conn.fetch(
        """
        SELECT q.id, q.question_text, q.options, q.correct_answer, q.metadata, s.lecture_id
        FROM quiz_questions q
        JOIN slides s ON s.id = q.slide_id
        WHERE q.id = ANY($1::uuid[])
        """,
        missed_question_ids,
    )

    card_ids: List[UUID] = []
    cards_created = 0
    for r in rows:
        options = r["options"] or []
        if isinstance(options, str):
            options = json.loads(options)
        metadata = r["metadata"] or {}
        if isinstance(metadata, str):
            metadata = json.loads(metadata)
        correct_idx = r["correct_answer"]
        correct_text = options[correct_idx] if isinstance(correct_idx, int) and 0 <= correct_idx < len(options) else ""
        front = {"question": r["question_text"], "options": options}
        back = {"correct_answer": correct_text, "explanation": metadata.get("explanation", "")}
        content_hash = _content_hash("quiz_question", str(r["id"]))

        created = await _insert_card(conn, r["lecture_id"], None, "quiz_question", r["id"], front, back, content_hash)
        if created:
            cards_created += 1
        # Re-fetch regardless of `created`: the row may already have existed
        # (normal card-factory run, or a concurrent send-misses call) — in
        # every case we still need its id to activate a schedule row below.
        card_row = await conn.fetchrow(
            "SELECT id FROM review_cards WHERE lecture_id = $1 AND content_hash = $2",
            r["lecture_id"], content_hash,
        )
        if card_row is not None:
            card_ids.append(card_row["id"])

    if not card_ids:
        return {"cards_created": cards_created, "cards_activated": 0}

    activated = await conn.fetch(
        """
        INSERT INTO review_schedule (user_id, card_id, due_at, stability, difficulty, reps, lapses, state)
        SELECT $1, cid, now(), 0, 2.5, 0, 0, 'new'
        FROM unnest($2::uuid[]) AS cid
        ON CONFLICT (user_id, card_id) DO NOTHING
        RETURNING card_id
        """,
        user_id, card_ids,
    )

    return {"cards_created": cards_created, "cards_activated": len(activated)}


# ── Professor aggregate (anonymized) ──────────────────────────────────────────

MIN_ATTEMPTS_FOR_AGGREGATE = 5


async def get_course_exam_aggregate(conn, course_id: UUID) -> Optional[Dict[str, Any]]:
    """Anonymized course-wide mock-exam performance for professors.

    Returns None when fewer than MIN_ATTEMPTS_FOR_AGGREGATE distinct students
    have submitted an attempt — the caller turns that into a suppressed
    response. Reads via the same service-role asyncpg connection review.py
    and this module's other functions use (RLS-bypassing), since
    `exam_attempts` RLS grants professors zero row access by design; this
    function is the ONLY sanctioned professor-facing read path, and it never
    returns a row-level attempt, only aggregates.
    """
    submitted = await conn.fetch(
        """
        SELECT user_id, score, concept_report
        FROM exam_attempts
        WHERE course_id = $1 AND submitted_at IS NOT NULL
        """,
        course_id,
    )
    distinct_students = {r["user_id"] for r in submitted}
    if len(distinct_students) < MIN_ATTEMPTS_FOR_AGGREGATE:
        return None

    scores = [r["score"] for r in submitted if r["score"] is not None]
    mean_score = round(sum(scores) / len(scores), 1) if scores else None

    concept_totals: Dict[str, Dict[str, int]] = {}
    for r in submitted:
        report = r["concept_report"]
        if isinstance(report, str):
            report = json.loads(report) if report else None
        for c in (report or {}).get("weakest_concepts", []):
            bucket = concept_totals.setdefault(c["concept"], {"correct": 0, "total": 0})
            bucket["correct"] += c["correct"]
            bucket["total"] += c["total"]

    weakest_concepts = sorted(
        (
            {
                "concept": concept,
                "miss_rate": round(1 - s["correct"] / s["total"], 2) if s["total"] else 0,
                "total_attempts": s["total"],
            }
            for concept, s in concept_totals.items()
        ),
        key=lambda c: (-c["miss_rate"], -c["total_attempts"]),
    )[:5]

    return {
        "n": len(distinct_students),
        "total_attempts": len(submitted),
        "mean_score": mean_score,
        "weakest_concepts": weakest_concepts,
    }
