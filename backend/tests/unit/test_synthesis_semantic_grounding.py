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


async def test_per_question_fallback_is_counted_in_the_summary(llm, semantic, monkeypatch):
    real = HashingEmbedder(SYNONYMS)

    async def zero_for_paraphrase(texts):
        return [[0.0] * real.DIMS if "Minimal routes" in t else real.vector(t) for t in texts]

    monkeypatch.setattr(synthesis, "_grounding_embed", zero_for_paraphrase)
    stats: dict = {}
    await _quiz(llm, [PARAPHRASE, GOOD], stats)
    assert stats["scorer"] == "semantic" and stats["scorer_question_fallbacks"] == 1


async def test_clean_semantic_run_reports_zero_question_fallbacks_and_lexical_has_no_key(llm, embed, semantic, monkeypatch):
    stats: dict = {}
    await _quiz(llm, [PARAPHRASE, GOOD], stats)
    assert stats["scorer_question_fallbacks"] == 0
    monkeypatch.setattr(settings, "grounding_scorer", "lexical")
    lex: dict = {}
    await _quiz(llm, [PARAPHRASE], lex)
    assert "scorer_question_fallbacks" not in lex


async def test_deck_level_embed_timeout_falls_back_to_lexical(llm, semantic, monkeypatch):
    import asyncio

    async def slow(texts):
        await asyncio.sleep(5)
        return []

    monkeypatch.setattr(synthesis, "_grounding_embed", slow)
    monkeypatch.setattr(synthesis, "GROUNDING_EMBED_TIMEOUT_S", 0.05)
    stats: dict = {}
    out = await _quiz(llm, [PARAPHRASE, GOOD], stats)
    assert [q.get("grounding_flag") for q in out] == ["low_support", None]
    assert stats["scorer"] == "lexical" and stats["scorer_fallback"] == "embedding_timeout"


async def test_per_question_timeout_is_a_counted_question_fallback(llm, semantic, monkeypatch):
    import asyncio

    real = HashingEmbedder(SYNONYMS)
    state = {"n": 0}

    async def slow_after_deck_request(texts):
        state["n"] += 1
        if state["n"] > 1:
            await asyncio.sleep(5)
        return [real.vector(t) for t in texts]

    # Deck request succeeds; the memo then serves per-question lookups, so
    # force the per-question path to time out by making the memo-served call slow.
    monkeypatch.setattr(synthesis, "_grounding_embed", slow_after_deck_request)
    monkeypatch.setattr(synthesis, "GROUNDING_EMBED_TIMEOUT_S", 0.05)
    real_support = synthesis.semantic_support

    async def slow_support(*a, **k):
        await asyncio.sleep(5)
        return await real_support(*a, **k)

    monkeypatch.setattr(synthesis, "semantic_support", slow_support)
    stats: dict = {}
    out = await _quiz(llm, [PARAPHRASE], stats)
    assert out[0]["grounding_flag"] == "low_support"
    assert stats["scorer"] == "semantic" and stats["scorer_question_fallbacks"] == 1


@pytest.mark.parametrize("raw,expected,warns", [
    ("  SEMANTIC ", "semantic", False), ("Lexical", "lexical", False), ("", "lexical", False),
    ("semantics", "lexical", True),
])
def test_requested_scorer_normalises_and_warns_once_on_unknown(monkeypatch, caplog, raw, expected, warns):
    monkeypatch.setattr(settings, "grounding_scorer", raw)
    with caplog.at_level("WARNING"):
        assert synthesis._requested_scorer() == expected
    assert sum("unrecognised GROUNDING_SCORER" in r.message for r in caplog.records) == (1 if warns else 0)


async def test_enforce_repair_is_rechecked_semantically_with_a_second_bounded_request(semantic, embed, monkeypatch):
    monkeypatch.setattr(synthesis, "ENFORCE_SUPPORT_THRESHOLD", True)
    bad = _mcq(["Photosynthesis", "Plate tectonics", "Baroque counterpoint", "Tides"], "Photosynthesis",
               stem="What is the capital of a faraway land?")
    replies = iter([json.dumps([bad]), json.dumps(GOOD)])

    async def _gen(prompt, ai_model=None):
        return next(replies)

    monkeypatch.setattr(synthesis, "generate_text", _gen)
    monkeypatch.setattr(synthesis, "generate_text_bulk", _gen)
    stats: dict = {}
    out = await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq", stats=stats)
    assert len(out) == 1 and out[0]["question"] == GOOD["question"]
    assert stats["repaired"] == 1 and stats["scorer"] == "semantic"
    assert stats["scorer_question_fallbacks"] == 0
    assert len(embed.calls) == 2  # deck request + the repaired question's new texts
