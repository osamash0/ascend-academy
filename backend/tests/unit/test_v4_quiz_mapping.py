"""Phase 0 safety patch — v4 deck-quiz mapping must never ship a wrong answer key.

The old v4 / fast_upload code resolved the correct-answer index with
``options.index(ans) if ans in options else 0`` — silently marking option A
correct whenever the LLM's ``correctAnswer`` string didn't exactly match an
option (whitespace, case, paraphrase). These tests pin the corrected behavior:
resolve via the shared quiz validator, and DROP (not default to A) any
question whose answer can't be matched to an option.
"""
from __future__ import annotations

from backend.services.parser.v4_orchestrator import _map_deck_quiz


def test_exact_text_answer_resolves_index_and_slide():
    q = {"question": "Q", "options": ["a", "b", "c", "d"], "correctAnswer": "c", "slideId": 3}
    out = _map_deck_quiz([q])
    assert len(out) == 1
    assert out[0]["correctAnswer"] == 2
    assert out[0]["linked_slides"] == [2]  # 1-based slideId 3 -> 0-based 2


def test_unmatched_answer_is_dropped_not_defaulted_to_A():
    # correctAnswer not present in options — the old code marked A correct.
    q = {"question": "Q", "options": ["a", "b", "c", "d"], "correctAnswer": "Paris"}
    assert _map_deck_quiz([q]) == []


def test_case_and_whitespace_insensitive_match_recovers_question():
    q = {"question": "Q", "options": ["Alpha", "Beta", "Gamma", "Delta"], "correctAnswer": " gamma "}
    out = _map_deck_quiz([q])
    assert len(out) == 1
    assert out[0]["correctAnswer"] == 2


def test_letter_and_int_answers_resolve():
    base = {"question": "Q", "options": ["a", "b", "c", "d"]}
    assert _map_deck_quiz([{**base, "correctAnswer": "B"}])[0]["correctAnswer"] == 1
    assert _map_deck_quiz([{**base, "correctAnswer": 3}])[0]["correctAnswer"] == 3


def test_mixed_batch_keeps_valid_drops_invalid():
    qs = [
        {"question": "ok", "options": ["a", "b", "c", "d"], "correctAnswer": "a"},
        {"question": "bad", "options": ["a", "b", "c", "d"], "correctAnswer": "nope"},
    ]
    out = _map_deck_quiz(qs)
    assert len(out) == 1
    assert out[0]["question"] == "ok"


def test_malformed_slideid_does_not_crash():
    q = {"question": "Q", "options": ["a", "b", "c", "d"], "correctAnswer": "a", "slideId": "n/a"}
    out = _map_deck_quiz([q])
    assert out[0]["linked_slides"] == [0]
