"""Grounded quiz verifier — pure support scoring against the cited slide."""
from __future__ import annotations

import pytest
from hypothesis import given, settings, strategies as st

from backend.services.parser.deck_plan import build_deck_skeleton
from backend.services.parser.quiz_grounding import (
    SUPPORT_THRESHOLD,
    assess_grounding,
    content_tokens,
    parse_source_slide,
    support_score,
)
from backend.tests.support.quiz_grounding_deck import GRAPH_DECK_PAGES

SKELETON = build_deck_skeleton(GRAPH_DECK_PAGES)


def _q(question, options, answer, source):
    return {"question": question, "options": options, "correctAnswer": answer, "source_slide": source}


GROUNDED = _q("Which algorithm computes shortest paths from a single source?",
              ["Dijkstra", "Kruskal", "Prim", "Floyd"], "Dijkstra", 3)


def test_fixture_footer_is_boilerplate():
    assert "university of marburg" in SKELETON.boilerplate


def test_positive_control_well_grounded_question_passes():
    v = assess_grounding(GROUNDED, SKELETON)
    assert v.ok and v.reason == "ok" and v.source_slide == 3
    assert support_score(GROUNDED, SKELETON) >= SUPPORT_THRESHOLD


def test_german_question_with_inflected_forms_passes():
    q = _q("Was modellieren Graphen?",
           ["Paarweise Beziehungen zwischen Knoten", "Kürzeste Wege", "Spannbäume", "Färbungen"],
           "Paarweise Beziehungen zwischen Knoten", 6)
    assert assess_grounding(q, SKELETON).ok


def test_a_answer_copied_from_a_different_slide_is_rejected():
    # Kruskal is on slide 4; the question cites the Dijkstra slide.
    q = _q("Which algorithm builds a minimum spanning tree?",
           ["Kruskal", "Bellman", "Floyd", "Johnson"], "Kruskal", 3)
    v = assess_grounding(q, SKELETON)
    assert not v.ok and v.reason == "low_support"
    assert support_score(q, SKELETON) < SUPPORT_THRESHOLD


def test_b_hallucinated_number_is_rejected_even_when_words_match():
    q = _q("How many colors suffice for planar maps?",
           ["5 colors", "3 colors", "6 colors", "8 colors"], "5 colors", 5)
    v = assess_grounding(q, SKELETON)
    assert v.reason == "number_not_on_slide" and v.score == 0.0


def test_b_control_the_number_on_the_slide_passes():
    q = _q("How many colors suffice for planar maps?",
           ["4 colors", "3 colors", "6 colors", "8 colors"], "4 colors", 5)
    assert assess_grounding(q, SKELETON).ok


def test_c_distractor_better_supported_than_key_is_ambiguous():
    q = _q("What does an edge join?",
           ["Two adjacent faces", "Exactly two vertices", "Three cycles", "A forest"],
           "Two adjacent faces", 2)
    v = assess_grounding(q, SKELETON)
    assert v.reason == "ambiguous" and v.score == 0.0


def test_c_tie_between_key_and_distractor_is_not_ambiguous():
    # Prim and Kruskal are both on slide 4; the stem decides. A tie must not be
    # rejected or every "which of these states ..." question would die.
    q = _q("Which algorithm grows the tree from a start vertex?",
           ["Prim", "Kruskal", "Dijkstra", "Floyd"], "Prim", 4)
    assert assess_grounding(q, SKELETON).ok


def test_boilerplate_footer_is_not_support():
    q = _q("Where is the lecture held?",
           ["University of Marburg", "TU Berlin", "LMU Munich", "KIT Karlsruhe"], "University of Marburg", 2)
    assert not assess_grounding(q, SKELETON).ok


@pytest.mark.parametrize("source, reason", [
    (None, "no_source"), ("n/a", "no_source"), (True, "no_source"), ([3], "no_source"),
    ("3a", "no_source"), (1.5, "no_source"), (0, "source_out_of_range"),
    (-1, "source_out_of_range"), (7, "source_out_of_range"), (99, "source_out_of_range"),
])
def test_d_missing_or_garbage_source_is_rejected(source, reason):
    v = assess_grounding({**GROUNDED, "source_slide": source}, SKELETON)
    assert v.reason == reason and v.score == 0.0 and v.source_slide is None


@pytest.mark.parametrize("source", [3, 3.0, "3", "Slide 3", "[Slide 3]", " folie 3 "])
def test_source_slide_spellings_that_name_slide_three(source):
    assert parse_source_slide(source) == 3
    assert assess_grounding({**GROUNDED, "source_slide": source}, SKELETON).ok


def test_legacy_slideId_is_accepted_when_source_slide_is_absent():
    q = {k: v for k, v in GROUNDED.items() if k != "source_slide"}
    assert assess_grounding({**q, "slideId": 3}, SKELETON).ok


def test_empty_cited_slide_is_rejected_without_a_repair_target():
    sk = build_deck_skeleton(GRAPH_DECK_PAGES[:2] + [""] + GRAPH_DECK_PAGES[3:])
    v = assess_grounding(GROUNDED, sk)
    assert v.reason == "empty_slide" and v.source_slide is None


def test_unresolvable_answer_is_rejected():
    assert assess_grounding({**GROUNDED, "correctAnswer": "Bellman"}, SKELETON).reason == "no_answer"


def test_content_tokens_fold_umlauts_case_and_inflection():
    assert content_tokens("Prozesse") == content_tokens("Prozessen") == content_tokens("prozess")
    assert content_tokens("Größe") == content_tokens("groesse")
    assert content_tokens("processes") == content_tokens("process")
    assert content_tokens("the and der die und") == frozenset()
    assert "4" in content_tokens("4 colors")


@settings(max_examples=200, deadline=None)
@given(st.one_of(st.none(), st.booleans(), st.integers(-50, 50), st.floats(), st.text(max_size=12)))
def test_only_the_true_source_slide_can_pass(source):
    v = assess_grounding({**GROUNDED, "source_slide": source}, SKELETON)
    assert v.source_slide is None or 1 <= v.source_slide <= len(SKELETON.slides)
    assert v.ok == (parse_source_slide(source) == 3)
