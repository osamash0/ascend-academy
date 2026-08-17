"""Deterministic inference rules used before a student sees a blueprint."""
from backend.api.v1 import onboarding


def test_title_from_filename_retains_meaningful_words_and_drops_extension():
    assert onboarding._title_from_filename("week_03-normal-forms.pdf") == "Week 03 Normal Forms"


def test_filename_classification_prefers_specific_material_types():
    assert onboarding._classify("Database Systems Past Exam.pdf") == "exam"
    assert onboarding._classify("Worksheet 2.pdf") == "worksheet"
    assert onboarding._classify("Lecture 4.pdf") == "lecture"


def test_confidence_is_high_only_when_a_meaningful_order_signal_exists():
    assert onboarding._confidence("Lecture 12 - Transactions.pdf") == 0.9
    assert onboarding._confidence("final-notes.pdf") == 0.65


def test_source_state_keeps_incomplete_work_visible_and_marks_terminal_failures():
    assert onboarding._source_state({"status": "queued"}) == "processing"
    assert onboarding._source_state({"status": "completed", "lecture_id": "lecture-id"}) == "ready"
    assert onboarding._source_state({"status": "failed"}) == "failed"
