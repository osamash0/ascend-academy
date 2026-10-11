"""Arc 8: GROUNDING_SCORER wiring in ground_deck_quiz. The default is
unchanged; semantic mode makes one bounded embedding request per deck and
fails open to the lexical verifier."""
from __future__ import annotations

import json

import pytest

from backend.core.config import Settings, settings
from backend.services.parser import semantic_grounding, synthesis
from backend.tests.support.fake_embedder import HashingEmbedder
from backend.tests.support.quiz_grounding_deck import GRAPH_DECK_PAGES

SYNONYMS = {"minimal": "shortest", "routes": "paths", "origin": "source", "determines": "computes"}
STEM = "What does this procedure determine?"


def _mcq(options, answer, source=3, stem=STEM):
    return {"question": stem, "options": options, "correctAnswer": answer, "source_slide": source,
            "concept": "c", "explanation": "e", "difficulty": "easy"}


PARAPHRASE = _mcq(["Minimal routes from one origin", "Photosynthesis", "Plate tectonics", "Baroque counterpoint"],
                  "Minimal routes from one origin")
GOOD = _mcq(["Dijkstra", "Kruskal", "Prim", "Floyd"], "Dijkstra",
            stem="Which algorithm computes shortest paths from a single source?")
NO_SOURCE = {k: v for k, v in GOOD.items() if k != "source_slide"}


@pytest.fixture
def llm(monkeypatch):
    box = {"reply": "[]", "calls": 0}

    async def _gen(prompt, ai_model=None):
        box["calls"] += 1
        return box["reply"]

    monkeypatch.setattr(synthesis, "generate_text", _gen)
    monkeypatch.setattr(synthesis, "generate_text_bulk", _gen)
    return box


@pytest.fixture
def embed(monkeypatch):
    fake = HashingEmbedder(SYNONYMS)
    monkeypatch.setattr(synthesis, "_grounding_embed", fake)
    return fake


@pytest.fixture
def semantic(monkeypatch):
    monkeypatch.setattr(settings, "grounding_scorer", "semantic", raising=False)
    monkeypatch.setattr(semantic_grounding, "SEMANTIC_SUPPORT_THRESHOLD", 0.4)


async def _quiz(llm, questions, stats=None):
    llm["reply"] = json.dumps(questions)
    return await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq", stats=stats)


def test_default_scorer_is_lexical():
    assert Settings.model_fields["grounding_scorer"].default == "lexical"


async def test_default_mode_never_embeds_and_keeps_the_arc6_summary(llm, embed):
    stats: dict = {}
    out = await _quiz(llm, [PARAPHRASE], stats)
    assert out[0]["grounding_flag"] == "low_support"
    assert embed.calls == [] and "scorer" not in stats


async def test_semantic_keeps_a_paraphrase_unflagged_with_one_request_per_deck(llm, embed, semantic):
    stats: dict = {}
    out = await _quiz(llm, [PARAPHRASE, GOOD, NO_SOURCE], stats)
    assert [q["question"] for q in out] == [PARAPHRASE["question"], GOOD["question"]]
    assert "grounding_flag" not in out[0]
    assert out[0]["support_score"] == pytest.approx(0.471, abs=0.001)
    assert len(embed.calls) == 1 and len(embed.calls[0]) == 9  # slide 3 + 4 claims x 2 questions
    assert stats["scorer"] == "semantic" and "scorer_fallback" not in stats
    assert stats["drop_reasons"] == {"no_source": 1}


async def test_embedding_failure_falls_back_to_lexical_and_never_fails_the_quiz(llm, monkeypatch, semantic):
    fake = HashingEmbedder(SYNONYMS, fail=True)
    monkeypatch.setattr(synthesis, "_grounding_embed", fake)
    stats: dict = {}
    out = await _quiz(llm, [PARAPHRASE, GOOD], stats)
    assert [q.get("grounding_flag") for q in out] == ["low_support", None]
    assert stats["scorer"] == "lexical" and stats["scorer_fallback"] == "embedding_error"
    assert len(fake.calls) == 1


async def test_uncalibrated_threshold_falls_back_without_embedding(llm, embed, monkeypatch):
    monkeypatch.setattr(settings, "grounding_scorer", "semantic", raising=False)
    monkeypatch.setattr(semantic_grounding, "SEMANTIC_SUPPORT_THRESHOLD", None)
    stats: dict = {}
    out = await _quiz(llm, [PARAPHRASE, GOOD], stats)
    assert embed.calls == [] and stats["scorer"] == "lexical" and stats["scorer_fallback"] == "uncalibrated"
    assert [q.get("grounding_flag") for q in out] == ["low_support", None]


async def test_over_budget_deck_falls_back_without_embedding(llm, embed, semantic, monkeypatch):
    monkeypatch.setattr(synthesis, "MAX_GROUNDING_EMBED_TEXTS", 3)
    stats: dict = {}
    await _quiz(llm, [PARAPHRASE], stats)
    assert embed.calls == [] and stats["scorer_fallback"] == "over_embed_cap"


async def test_one_unusable_vector_falls_back_for_that_question_only(llm, semantic, monkeypatch):
    real = HashingEmbedder(SYNONYMS)

    async def zero_for_paraphrase(texts):
        return [[0.0] * real.DIMS if "Minimal routes" in t else real.vector(t) for t in texts]

    monkeypatch.setattr(synthesis, "_grounding_embed", zero_for_paraphrase)
    stats: dict = {}
    out = await _quiz(llm, [PARAPHRASE, GOOD], stats)
    assert [q.get("grounding_flag") for q in out] == ["low_support", None]
    assert stats["scorer"] == "semantic"


async def test_enforce_with_semantic_does_not_repair_a_supported_paraphrase(llm, embed, semantic, monkeypatch):
    monkeypatch.setattr(synthesis, "ENFORCE_SUPPORT_THRESHOLD", True)
    out = await _quiz(llm, [PARAPHRASE])
    assert len(out) == 1 and llm["calls"] == 1
