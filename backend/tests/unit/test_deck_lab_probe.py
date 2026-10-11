import pytest

from backend.eval.data.grounding_probe import ProbePair
from backend.eval.deck_lab import HALLUCINATED, PARAPHRASED, probe_question, run_grounding_probe
from backend.services.parser.deck_plan import build_deck_skeleton
from backend.tests.support.deck_lab_decks import LONG_DECK

# Hand-checked against assess_grounding on LONG_DECK (slide 3 = alpha, 4 = bravo):
#   P1 "The alpha concept"                  -> 1.0 ok           (kept: correct)
#   H1 "Quantum entanglement of photons"     -> 0.0 low_support  (dropped: correct)
#   P2 "Quantum tunnelling"                  -> 0.0 low_support  (FALSE DROP)
#   H2 "The bravo concept, in enough words"  -> 1.0 ok           (FALSE KEEP: lexical, not entailment)
PAIRS = [
    ProbePair("syn", 3, "What does the alpha slide explain?",
              "The alpha concept", "Quantum entanglement of photons", "en"),
    ProbePair("syn", 4, "What does the bravo slide explain?",
              "Quantum tunnelling", "The bravo concept, in enough words", "en"),
]


@pytest.fixture
def skeletons():
    return {"syn": build_deck_skeleton(LONG_DECK)}


def test_probe_question_uses_answer_text_and_off_topic_distractors():
    q = probe_question(PAIRS[0], "The alpha concept")
    assert q["options"][0] == "The alpha concept" == q["correctAnswer"]
    assert q["source_slide"] == 3 and len(q["options"]) == 4
    assert "Photosynthesis in chloroplasts" in q["options"]


def test_probe_counts_false_drops_and_false_keeps(skeletons):
    r = run_grounding_probe(PAIRS, skeletons)
    assert [(o.kind, o.reason, o.accepted) for o in r.outcomes] == [
        (PARAPHRASED, "ok", True),
        (HALLUCINATED, "low_support", False),
        (PARAPHRASED, "low_support", False),
        (HALLUCINATED, "ok", True),
    ]
    assert (r.paraphrased, r.hallucinated) == (2, 2)
    assert [o.answer for o in r.false_drops] == ["Quantum tunnelling"]
    assert [o.answer for o in r.false_keeps] == ["The bravo concept, in enough words"]
    assert r.false_drop_rate == pytest.approx(0.5)
    assert r.false_keep_rate == pytest.approx(0.5)
    assert r.threshold == 0.5 and r.missing_decks == ()


def test_probe_passes_the_threshold_through(skeletons):
    r = run_grounding_probe(PAIRS, skeletons, threshold=1.01)
    assert not any(o.accepted for o in r.outcomes)
    assert r.false_drop_rate == pytest.approx(1.0) and r.false_keep_rate == 0.0


def test_missing_deck_is_reported_not_scored(skeletons):
    absent = ProbePair("absent.pdf", 2, "Q?", "a b", "c d", "de")
    r = run_grounding_probe([*PAIRS, absent], skeletons)
    assert r.missing_decks == ("absent.pdf",)
    assert len(r.outcomes) == 4


def test_rates_are_none_when_nothing_was_scored():
    r = run_grounding_probe(PAIRS, {})
    assert r.outcomes == () and r.false_drop_rate is None and r.false_keep_rate is None
