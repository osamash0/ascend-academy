"""Arc 8 semantic support scorer: deterministic gates, the combined rule and
semantic ambiguity. Offline: a hashing fake stands in for Gemini. Cosines were
hand-checked against HashingEmbedder on GRAPH_DECK_PAGES slide 3 (Dijkstra)."""
from __future__ import annotations

import pytest

from backend.services.parser.deck_plan import build_deck_skeleton
from backend.services.parser.quiz_grounding import assess_grounding
from backend.services.parser.semantic_grounding import (
    SEMANTIC_SUPPORT_THRESHOLD,
    BoundedEmbedder,
    EmbeddingBudgetExceeded,
    EmbeddingShapeError,
    claim_text,
    cosine,
    semantic_support,
    semantic_texts,
    slide_text,
)
from backend.tests.support.fake_embedder import HashingEmbedder
from backend.tests.support.quiz_grounding_deck import GRAPH_DECK_PAGES

SK = build_deck_skeleton(GRAPH_DECK_PAGES)
T = 0.4
SYNONYMS = {"minimal": "shortest", "routes": "paths", "origin": "source", "determines": "computes"}
STEM = "What does this procedure determine?"
OFF = ["Photosynthesis", "Plate tectonics", "Baroque counterpoint"]


def _q(options, answer, source=3, stem=STEM):
    return {"question": stem, "options": options, "correctAnswer": answer, "source_slide": source}


PARAPHRASE = _q(["Minimal routes from one origin", *OFF], "Minimal routes from one origin")
HALLUCINATION = _q(["Minimum spanning trees over all vertices", *OFF], "Minimum spanning trees over all vertices")
LEXICAL_OK = _q(["Dijkstra", "Kruskal", "Prim", "Floyd"], "Dijkstra",
                stem="Which algorithm computes shortest paths from a single source?")


@pytest.fixture
def embed():
    return HashingEmbedder(SYNONYMS)


def test_threshold_is_uncalibrated_until_the_arc8_measurement():
    assert SEMANTIC_SUPPORT_THRESHOLD is None


async def test_paraphrase_the_lexical_scorer_rejects_is_accepted(embed):
    assert assess_grounding(PARAPHRASE, SK).reason == "low_support"
    v = await semantic_support(PARAPHRASE, SK, embed, T)
    assert v.ok and v.reason == "ok" and v.source_slide == 3
    assert not v.lexical_ok and v.lexical == 0.0
    assert v.score == v.cosine == pytest.approx(0.471, abs=0.001)


async def test_on_topic_hallucination_stays_low_support_even_with_a_closer_weak_distractor(embed):
    # "Photosynthesis" (0.167) is closer than the key (0.118) but is itself
    # below the threshold: that is not ambiguity, the key is just unsupported.
    v = await semantic_support(HALLUCINATION, SK, embed, T)
    assert v.reason == "low_support" and not v.ok
    assert v.cosine == pytest.approx(0.118, abs=0.001)


async def test_lexically_supported_key_passes_even_below_the_cosine_threshold(embed):
    v = await semantic_support(LEXICAL_OK, SK, embed, threshold=1.01)
    assert v.ok and v.lexical_ok and v.cosine < 1.01


async def test_distractor_the_slide_supports_better_than_the_key_is_ambiguous(embed):
    q = _q(["Prim", "Dijkstra computes shortest paths from a single source", *OFF[1:]], "Prim")
    v = await semantic_support(q, SK, embed, T)
    assert v.reason == "ambiguous" and v.score == 0.0 and not v.ok
    assert v.cosine == pytest.approx(0.167, abs=0.001)


@pytest.mark.parametrize("question, reason", [
    ({k: v for k, v in PARAPHRASE.items() if k != "source_slide"}, "no_source"),
    ({**PARAPHRASE, "source_slide": 99}, "source_out_of_range"),
    ({**PARAPHRASE, "correctAnswer": "nonsense"}, "no_answer"),
    (_q(["5 colors", "3 colors", "6 colors", "8 colors"], "5 colors", source=5), "number_not_on_slide"),
])
async def test_deterministic_gates_never_reach_the_embedder(embed, question, reason):
    v = await semantic_support(question, SK, embed, T)
    assert v.reason == reason == assess_grounding(question, SK).reason and not v.ok
    assert embed.calls == [] and semantic_texts(question, SK) == []


def test_semantic_texts_lists_slide_then_key_then_distractors():
    texts = semantic_texts(PARAPHRASE, SK)
    assert texts == [slide_text(SK, 3), claim_text(STEM, "Minimal routes from one origin"),
                     *(claim_text(STEM, o) for o in OFF)]
    assert texts[0].startswith("Dijkstra Algorithm") and "University of Marburg" not in texts[0]


async def test_embedder_returning_the_wrong_number_of_vectors_raises():
    async def short(texts):
        return [[1.0, 0.0]]

    with pytest.raises(EmbeddingShapeError):
        await semantic_support(PARAPHRASE, SK, short, T)


def test_cosine_rejects_zero_and_mismatched_vectors():
    assert cosine([1.0, 0.0], [2.0, 0.0]) == pytest.approx(1.0)
    with pytest.raises(EmbeddingShapeError):
        cosine([0.0, 0.0], [1.0, 0.0])
    with pytest.raises(EmbeddingShapeError):
        cosine([1.0], [1.0, 0.0])


def test_claim_text_joins_stem_and_option():
    assert claim_text(" Q? ", " A ") == "Q?\nA" and claim_text("", "A") == "A"


async def test_bounded_embedder_fetches_each_text_once_and_enforces_its_budget():
    inner = HashingEmbedder()
    bounded = BoundedEmbedder(inner, max_texts=3, max_batch=10)
    first = await bounded(["a slide", "a claim", "a slide"])
    assert inner.calls == [["a slide", "a claim"]] and first[0] == first[2]
    await bounded(["a claim"])
    assert len(inner.calls) == 1 and bounded.remaining == 1
    with pytest.raises(EmbeddingBudgetExceeded):
        await bounded(["new one", "new two"])
    assert len(inner.calls) == 1


async def test_bounded_embedder_refuses_a_request_larger_than_max_batch():
    with pytest.raises(EmbeddingBudgetExceeded):
        await BoundedEmbedder(HashingEmbedder(), max_texts=10, max_batch=2)(["x one", "x two", "x three"])


async def test_bounded_embedder_rejects_empty_vectors():
    async def broken(texts):
        return [[] for _ in texts]

    with pytest.raises(EmbeddingShapeError):
        await BoundedEmbedder(broken, 5, 5)(["slide text"])


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_cosine_rejects_non_finite_vectors(bad):
    with pytest.raises(EmbeddingShapeError):
        cosine([bad, 1.0], [1.0, 1.0])
    with pytest.raises(EmbeddingShapeError):
        cosine([1.0, 1.0], [1.0, bad])
