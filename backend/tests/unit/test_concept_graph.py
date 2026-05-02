"""
Unit tests for the cross-course concept graph service.

Covers:
- Pure embedding-similarity dedupe (find_match)
- Tag harvesting + normalization
- End-to-end ingest_lecture_concepts against the FakeSupabase backed
  catalog with a stubbed embedding function.
- Mastery + related-lectures queries.
"""
from __future__ import annotations

import pytest

from backend.services import concept_graph as cg


# ─── Pure helpers ───────────────────────────────────────────────────────────

def test_normalize_collapses_whitespace_and_case():
    assert cg._normalize("  Linear  Regression  ") == "linear regression"
    assert cg._normalize("Backpropagation.") == "backpropagation"
    assert cg._normalize("(Bayes' Rule)") == "bayes' rule"


def test_cosine_basic():
    assert cg._cosine([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    assert cg._cosine([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0, abs=1e-9)
    assert cg._cosine([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)


def test_cosine_handles_degenerate_inputs():
    assert cg._cosine([], [1.0]) == 0.0
    assert cg._cosine([0.0, 0.0], [1.0, 1.0]) == 0.0
    assert cg._cosine([1.0, 0.0], [0.0]) == 0.0  # length mismatch


# ─── Dedupe by embedding similarity ─────────────────────────────────────────

def test_find_match_returns_closest_above_threshold():
    catalog = [
        {"id": "c1", "canonical_name": "Linear Regression", "name_key": "linear regression",
         "embedding": [1.0, 0.0, 0.0]},
        {"id": "c2", "canonical_name": "Backpropagation", "name_key": "backpropagation",
         "embedding": [0.0, 1.0, 0.0]},
    ]
    # Near-perfect match for c1
    out = cg.find_match([0.99, 0.05, 0.0], catalog, threshold=0.85)
    assert out is not None
    assert out["id"] == "c1"
    assert out["similarity"] > 0.85


def test_find_match_returns_none_below_threshold():
    catalog = [
        {"id": "c1", "canonical_name": "X", "name_key": "x", "embedding": [1.0, 0.0]},
    ]
    out = cg.find_match([0.0, 1.0], catalog, threshold=0.5)
    assert out is None


def test_find_match_chooses_higher_of_two_candidates():
    catalog = [
        {"id": "near", "canonical_name": "A", "name_key": "a", "embedding": [0.95, 0.30]},
        {"id": "far",  "canonical_name": "B", "name_key": "b", "embedding": [0.10, 0.99]},
    ]
    out = cg.find_match([1.0, 0.05], catalog, threshold=0.5)
    assert out is not None and out["id"] == "near"


# ─── Tag harvesting ─────────────────────────────────────────────────────────

def test_collect_concept_tags_merges_blueprint_and_questions():
    blueprint = {
        "slide_plans": [
            {"index": 0, "concepts": ["Linear Regression", "Bias-Variance"]},
            {"index": 1, "concepts": ["Bias-Variance"]},
        ],
        "cross_slide_quiz_concepts": ["Regularization"],
    }
    questions = [
        {"id": "q1", "slide_id": "s2",
         "metadata": {"concept": "Regularization", "linked_slides": [2, 3]}},
        {"id": "q2", "slide_id": "s0",
         "metadata": {"concept": "linear regression"}},  # casing collision
    ]
    slide_id_to_index = {"s0": 0, "s1": 1, "s2": 2, "s3": 3}

    tags = cg.collect_concept_tags(blueprint, questions, slide_id_to_index)

    # Three unique concepts after normalization
    assert set(tags.keys()) == {
        "linear regression", "bias-variance", "regularization",
    }
    # Linear Regression: slide 0 from blueprint + slide 0 from question = [0]
    name, slides = tags["linear regression"]
    assert name == "Linear Regression"  # display name from blueprint wins
    assert slides == [0]
    # Bias-Variance: slides 0 and 1 from blueprint
    assert tags["bias-variance"][1] == [0, 1]
    # Regularization: slides 2, 3 from question linked_slides
    assert tags["regularization"][1] == [2, 3]


def test_collect_concept_tags_ignores_blank_concepts():
    tags = cg.collect_concept_tags(
        {"slide_plans": [{"index": 0, "concepts": ["", "  "]}]},
        [{"id": "q1", "slide_id": "s0", "metadata": {"concept": None}}],
        {"s0": 0},
    )
    assert tags == {}


# ─── End-to-end ingest with FakeSupabase ────────────────────────────────────

@pytest.mark.asyncio
async def test_ingest_lecture_creates_and_dedupes_concepts(fake_supabase):
    """Ingest a lecture, then a second one with an alias-only collision —
    the second run must reuse the existing concept row, not create a new one.
    """
    # Stub embeddings: exact matches by lower(name) so dedupe is deterministic.
    embeddings_by_name = {
        "linear regression":  [1.0, 0.0, 0.0],
        "linear regression model": [0.99, 0.05, 0.0],  # near-duplicate
        "backpropagation":    [0.0, 1.0, 0.0],
    }

    async def fake_embed(text: str):
        return embeddings_by_name.get(text.strip().lower(), [0.5, 0.5, 0.0])

    fake_supabase.seed("concepts", [])
    fake_supabase.seed("concept_lectures", [])

    bp1 = {
        "slide_plans": [{"index": 0, "concepts": ["Linear Regression"]}],
        "cross_slide_quiz_concepts": ["Backpropagation"],
    }
    rep1 = await cg.ingest_lecture_concepts(
        "L1", blueprint=bp1, questions=[], slide_id_to_index={},
        client=fake_supabase, embed_fn=fake_embed,
    )
    assert rep1["concepts"] == 2
    assert rep1["linked"] == 2
    assert rep1["created"] == 2
    assert len(fake_supabase.tables["concepts"]) == 2

    # Second lecture re-uses Linear Regression via similarity match.
    bp2 = {
        "slide_plans": [{"index": 5, "concepts": ["Linear Regression Model"]}],
        "cross_slide_quiz_concepts": [],
    }
    rep2 = await cg.ingest_lecture_concepts(
        "L2", blueprint=bp2, questions=[], slide_id_to_index={},
        client=fake_supabase, embed_fn=fake_embed,
    )
    assert rep2["concepts"] == 1
    assert rep2["linked"] == 1
    # CRITICAL: no new concept created — dedupe matched the existing row.
    assert rep2["created"] == 0
    assert len(fake_supabase.tables["concepts"]) == 2

    # The alias was appended to the canonical row.
    lr_row = next(r for r in fake_supabase.tables["concepts"]
                  if r["name_key"] == "linear regression")
    assert "Linear Regression Model" in lr_row["aliases"]

    # Two link rows for Linear Regression (one per lecture).
    cl_rows = fake_supabase.tables["concept_lectures"]
    lr_links = [r for r in cl_rows if r["concept_id"] == lr_row["id"]]
    assert {r["lecture_id"] for r in lr_links} == {"L1", "L2"}
    l2_link = next(r for r in lr_links if r["lecture_id"] == "L2")
    assert l2_link["slide_indices"] == [5]


@pytest.mark.asyncio
async def test_ingest_idempotent_on_rerun(fake_supabase):
    async def fake_embed(text: str):
        return [1.0, 0.0]

    fake_supabase.seed("concepts", [])
    fake_supabase.seed("concept_lectures", [])

    bp = {"slide_plans": [{"index": 0, "concepts": ["Foo"]}]}
    await cg.ingest_lecture_concepts(
        "L1", blueprint=bp, questions=[], slide_id_to_index={},
        client=fake_supabase, embed_fn=fake_embed,
    )
    await cg.ingest_lecture_concepts(
        "L1", blueprint=bp, questions=[], slide_id_to_index={},
        client=fake_supabase, embed_fn=fake_embed,
    )
    # One concept, one link — upsert keyed on (concept_id, lecture_id).
    assert len(fake_supabase.tables["concepts"]) == 1
    assert len(fake_supabase.tables["concept_lectures"]) == 1


# ─── Mastery + related-lectures queries ─────────────────────────────────────

@pytest.mark.asyncio
async def test_compute_student_mastery_aggregates_per_concept(fake_supabase):
    fake_supabase.seed("concepts", [
        {"id": "C_LR", "canonical_name": "Linear Regression",
         "name_key": "linear regression",
         "aliases": ["Linear Regression", "linear regression"]},
        {"id": "C_BP", "canonical_name": "Backpropagation",
         "name_key": "backpropagation", "aliases": ["Backpropagation"]},
    ])
    fake_supabase.seed("quiz_questions", [
        {"id": "Q1", "slide_id": "s1", "metadata": {"concept": "Linear Regression"}},
        {"id": "Q2", "slide_id": "s2", "metadata": {"concept": "linear regression"}},
        {"id": "Q3", "slide_id": "s3", "metadata": {"concept": "Backpropagation"}},
    ])
    fake_supabase.seed("learning_events", [
        {"user_id": "U", "event_type": "quiz_attempt",
         "event_data": {"questionId": "Q1", "correct": True}},
        {"user_id": "U", "event_type": "quiz_attempt",
         "event_data": {"questionId": "Q1", "correct": True}},
        {"user_id": "U", "event_type": "quiz_attempt",
         "event_data": {"questionId": "Q2", "correct": False}},
        {"user_id": "U", "event_type": "quiz_attempt",
         "event_data": {"questionId": "Q3", "correct": False}},
    ])

    out = await cg.compute_student_mastery("U", client=fake_supabase)

    by_id = {v["concept_id"]: v for v in out["vector"]}
    assert by_id["C_LR"]["attempts"] == 3
    assert by_id["C_LR"]["correct"] == 2
    # Laplace smoothing: (2+1)/(3+2) = 0.6
    assert by_id["C_LR"]["mastery_score"] == pytest.approx(0.6, abs=1e-4)
    assert by_id["C_BP"]["attempts"] == 1
    # Backprop: (0+1)/(1+2) ≈ 0.333
    assert by_id["C_BP"]["mastery_score"] == pytest.approx(1.0 / 3.0, abs=1e-4)

    # Weak list ranks the lowest score first.
    assert out["weak"][0]["concept_id"] == "C_BP"


@pytest.mark.asyncio
async def test_compute_student_mastery_returns_empty_with_no_events(fake_supabase):
    fake_supabase.seed("concepts", [])
    fake_supabase.seed("quiz_questions", [])
    fake_supabase.seed("learning_events", [])
    out = await cg.compute_student_mastery("U", client=fake_supabase)
    assert out == {"vector": [], "mastered": [], "weak": []}


@pytest.mark.asyncio
async def test_related_lectures_ranked_by_weight(fake_supabase):
    fake_supabase.seed("concept_lectures", [
        {"concept_id": "C1", "lecture_id": "L_LIGHT", "slide_indices": [0],   "weight": 1.5},
        {"concept_id": "C1", "lecture_id": "L_HEAVY", "slide_indices": [1, 2, 3], "weight": 3.5},
        {"concept_id": "C1", "lecture_id": "L_SELF",  "slide_indices": [0],   "weight": 2.0},
        {"concept_id": "OTHER", "lecture_id": "L_X",  "slide_indices": [0],   "weight": 9.0},
    ])
    fake_supabase.seed("lectures", [
        {"id": "L_LIGHT", "title": "Light", "description": None, "total_slides": 4},
        {"id": "L_HEAVY", "title": "Heavy", "description": None, "total_slides": 8},
        {"id": "L_SELF",  "title": "Self",  "description": None, "total_slides": 2},
        {"id": "L_X",     "title": "X",     "description": None, "total_slides": 1},
    ])
    out = await cg.related_lectures_for_concept(
        "C1", exclude_lecture_id="L_SELF", client=fake_supabase,
    )
    assert [r["lecture_id"] for r in out] == ["L_HEAVY", "L_LIGHT"]
    # Excluded lecture is gone, OTHER concept's lecture is filtered out.
    assert all(r["lecture_id"] != "L_SELF" for r in out)
    assert all(r["lecture_id"] != "L_X" for r in out)
