"""Unit tests for the slide-level recommendation rubric."""
from backend.services.recommendations import (
    compute_slide_recommendation,
    MIN_VIEWS_FOR_LABEL,
    DROPOFF_HIGH,
    CONFUSION_HIGH,
    QUIZ_SUCCESS_LOW,
)


def test_insufficient_data_when_view_count_below_threshold():
    label, reasons = compute_slide_recommendation(
        drop_off_rate=0, confusion_rate=0, quiz_success_rate=100,
        view_count=MIN_VIEWS_FOR_LABEL - 1, quiz_attempts=10,
    )
    assert label == "insufficient_data"
    assert reasons == ["low_view_count"]


def test_high_dropoff_triggers_needs_review():
    label, reasons = compute_slide_recommendation(
        drop_off_rate=DROPOFF_HIGH + 1, confusion_rate=0, quiz_success_rate=90,
        view_count=20, quiz_attempts=10,
    )
    assert label == "needs_review"
    assert "high_dropoff" in reasons


def test_high_confusion_triggers_needs_review():
    label, reasons = compute_slide_recommendation(
        drop_off_rate=0, confusion_rate=CONFUSION_HIGH + 1, quiz_success_rate=90,
        view_count=20, quiz_attempts=10,
    )
    assert label == "needs_review"
    assert "high_confusion" in reasons


def test_low_quiz_success_triggers_needs_review_only_when_quiz_exists():
    label, reasons = compute_slide_recommendation(
        drop_off_rate=0, confusion_rate=0, quiz_success_rate=QUIZ_SUCCESS_LOW - 1,
        view_count=20, quiz_attempts=5,
    )
    assert label == "needs_review"
    assert "low_quiz_success" in reasons

    # Without quiz attempts, low success rate must not penalize.
    label2, _ = compute_slide_recommendation(
        drop_off_rate=0, confusion_rate=0, quiz_success_rate=None,
        view_count=20, quiz_attempts=0,
    )
    assert label2 == "outstanding"


def test_outstanding_requires_all_strong_signals():
    label, reasons = compute_slide_recommendation(
        drop_off_rate=2, confusion_rate=5, quiz_success_rate=92,
        view_count=20, quiz_attempts=10,
    )
    assert label == "outstanding"
    assert "low_dropoff" in reasons and "low_confusion" in reasons and "high_quiz_success" in reasons


def test_satisfactory_when_neither_problematic_nor_outstanding():
    label, reasons = compute_slide_recommendation(
        drop_off_rate=15, confusion_rate=20, quiz_success_rate=70,
        view_count=20, quiz_attempts=10,
    )
    assert label == "satisfactory"
    assert reasons == []
