"""Edge-branch coverage for quiz_validator._normalize_answer_index / validate_mcq.

Complements test_quiz_quality.py by pinning the remaining reject branches that
protect against shipping a wrong answer key or a malformed MCQ to a student.
"""
from __future__ import annotations

from backend.services.ai.quiz_validator import _normalize_answer_index, validate_mcq


# ── _normalize_answer_index reject branches ──────────────────────────────────

def test_options_not_a_list_returns_none():
    assert _normalize_answer_index({"options": None, "correctAnswer": 0}) is None


def test_empty_options_returns_none():
    assert _normalize_answer_index({"options": [], "correctAnswer": 0}) is None


def test_boolean_answer_returns_none():
    # A bool is an int subclass; it must be rejected, not treated as index 1.
    assert _normalize_answer_index({"options": ["a", "b", "c", "d"], "correctAnswer": True}) is None


def test_int_answer_out_of_range_returns_none():
    assert _normalize_answer_index({"options": ["a", "b", "c", "d"], "correctAnswer": 9}) is None


def test_empty_string_answer_returns_none():
    assert _normalize_answer_index({"options": ["a", "b", "c", "d"], "correctAnswer": "   "}) is None


def test_digit_string_out_of_range_returns_none():
    assert _normalize_answer_index({"options": ["a", "b", "c", "d"], "correctAnswer": "9"}) is None


def test_letter_out_of_range_returns_none():
    # "Z" → index 25, beyond a 4-option question.
    assert _normalize_answer_index({"options": ["a", "b", "c", "d"], "correctAnswer": "Z"}) is None


def test_answer_key_fallback_to_plain_answer_field():
    # No correctAnswer, but a plain "answer" field is honored.
    assert _normalize_answer_index({"options": ["a", "b", "c", "d"], "answer": 2}) == 2


def test_no_answer_field_returns_none():
    assert _normalize_answer_index({"options": ["a", "b", "c", "d"]}) is None


def test_valid_digit_string_resolves_index():
    assert _normalize_answer_index({"options": ["a", "b", "c", "d"], "correctAnswer": "2"}) == 2


def test_multichar_non_matching_text_returns_none():
    # Not a single letter, not a digit, and matches no option → falls through to None.
    assert _normalize_answer_index(
        {"options": ["alpha", "beta", "gamma", "delta"], "correctAnswer": "epsilon"}
    ) is None


# ── validate_mcq option-shape branches ───────────────────────────────────────

def test_validate_mcq_rejects_non_string_option():
    q = {"question": "Q?", "options": ["a", "b", 3, "d"], "correctAnswer": 0}
    ok, reason = validate_mcq(q)
    assert ok is False
    assert reason == "non-string option"


def test_validate_mcq_rejects_empty_option():
    q = {"question": "Q?", "options": ["a", "b", "  ", "d"], "correctAnswer": 0}
    ok, reason = validate_mcq(q)
    assert ok is False
    assert reason == "empty option"
