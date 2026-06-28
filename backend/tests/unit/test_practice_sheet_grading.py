"""Unit tests for practice-sheet auto-grading (_grade_attempt).

Grading feeds the score students see and what professor analytics aggregate, so
a regression silently corrupts data. Pure function — no mocks. Pins the real
contract: only multiple_choice + short_answer count; free_form is excluded from
the denominator; matching is case/whitespace-insensitive; score is a 0–100 float
rounded to 1 decimal.
"""
from __future__ import annotations

from backend.api.v1.practice_sheets import _grade_attempt


def _q(qid: str, qtype: str, correct: str | None) -> dict:
    return {"id": qid, "type": qtype, "correct_answer": correct}


def test_all_correct_scores_100():
    questions = [_q("a", "multiple_choice", "Paris"), _q("b", "short_answer", "42")]
    assert _grade_attempt(questions, {"a": "Paris", "b": "42"}) == 100.0


def test_half_correct_scores_50():
    questions = [_q("a", "multiple_choice", "Paris"), _q("b", "short_answer", "42")]
    assert _grade_attempt(questions, {"a": "Paris", "b": "99"}) == 50.0


def test_free_form_is_excluded_from_the_denominator():
    # 1 MC + 1 short_answer (both correct) + 1 free_form -> 100%, NOT 66.7%.
    questions = [
        _q("a", "multiple_choice", "Paris"),
        _q("b", "short_answer", "42"),
        _q("c", "free_form", None),
    ]
    assert _grade_attempt(questions, {"a": "Paris", "b": "42", "c": "an essay"}) == 100.0


def test_all_free_form_scores_zero_documented_limitation():
    # KNOWN LIMITATION (audit WRK-14): free_form is self-assessed and never
    # auto-scored, so a sheet of only free_form questions always scores 0.0 even
    # when fully answered. Pinned so a future "real" grader changes this on purpose.
    questions = [_q("a", "free_form", None), _q("b", "free_form", None)]
    assert _grade_attempt(questions, {"a": "answer", "b": "answer"}) == 0.0


def test_no_questions_scores_zero():
    assert _grade_attempt([], {}) == 0.0


def test_matching_is_case_and_whitespace_insensitive():
    questions = [_q("a", "short_answer", "Paris")]
    assert _grade_attempt(questions, {"a": "  paris "}) == 100.0


def test_missing_answer_is_wrong_not_crash():
    questions = [_q("a", "multiple_choice", "Paris"), _q("b", "short_answer", "42")]
    # 'b' absent from answers -> treated as empty -> wrong. 1/2 = 50.
    assert _grade_attempt(questions, {"a": "Paris"}) == 50.0


def test_empty_expected_answer_never_counts_correct():
    # A misconfigured question with no correct_answer must not be gradeable-correct
    # even if the student also submits an empty string.
    questions = [_q("a", "short_answer", None), _q("b", "short_answer", "x")]
    assert _grade_attempt(questions, {"a": "", "b": "x"}) == 50.0


def test_score_is_rounded_to_one_decimal():
    # 1 of 3 correct -> 33.333... -> 33.3
    questions = [
        _q("a", "short_answer", "1"),
        _q("b", "short_answer", "2"),
        _q("c", "short_answer", "3"),
    ]
    assert _grade_attempt(questions, {"a": "1", "b": "x", "c": "y"}) == 33.3


def test_none_answer_value_is_treated_as_empty():
    # answers.get(id) may be None (explicit null in JSON) — must not raise.
    questions = [_q("a", "short_answer", "1")]
    assert _grade_attempt(questions, {"a": None}) == 0.0
