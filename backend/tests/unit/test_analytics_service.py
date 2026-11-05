"""Unit tests for analytics_service pure aggregation helpers.

These bypass FastAPI and Supabase entirely — they exercise the analytics
math against in-memory event lists.
"""

from backend.services import analytics_service as svc


def test_group_events_by_user_skips_anon():
    out = svc._group_events_by_user(
        [
            {"user_id": "u1", "x": 1},
            {"user_id": None, "x": 2},
            {"user_id": "u1", "x": 3},
            {"user_id": "u2", "x": 4},
        ]
    )
    assert len(out["u1"]) == 2
    assert len(out["u2"]) == 1
    assert None not in out


def test_group_events_by_slide_handles_camel_keys():
    out = svc._group_events_by_slide(
        [
            {"event_data": {"slideId": "s1"}},
            {"event_data": {"fromSlideId": "s2"}},
            {"event_data": {}},
        ]
    )
    assert "s1" in out and "s2" in out


def test_dropoff_only_non_completers():
    slides = [
        {"id": "s1", "slide_number": 1, "title": "A"},
        {"id": "s2", "slide_number": 2, "title": "B"},
    ]
    progress = [
        {"user_id": "u1", "last_slide_viewed": 0, "completed_at": None},
        {"user_id": "u2", "last_slide_viewed": 1, "completed_at": "now"},
    ]
    out = svc._calculate_dropoff_map(slides, progress, student_count=2)
    # only u1 dropped at slide 1
    assert len(out) == 1
    assert out[0]["slide_number"] == 1
    assert out[0]["dropout_count"] == 1
    assert out[0]["dropout_percentage"] == 50.0


def test_confidence_map_aggregates_per_slide():
    slides = [
        {"id": "s1", "slide_number": 1, "title": "A"},
        {"id": "s2", "slide_number": 2, "title": "B"},
    ]
    events_by_slide = {
        "s1": [
            {"event_type": "confidence_rating", "event_data": {"rating": "got_it"}},
            {"event_type": "confidence_rating", "event_data": {"rating": "confused"}},
        ],
        "s2": [
            {"event_type": "confidence_rating", "event_data": {"rating": "got_it"}},
        ],
    }
    overall, per_slide = svc._calculate_confidence_map(slides, events_by_slide)
    assert overall["got_it"] == 2 and overall["confused"] == 1
    s1 = next(s for s in per_slide if s["slide_number"] == 1)
    assert s1["confusion_rate"] == 50.0


def _tries(qid, results, prefix="u"):
    """One first try per person: results[i] is whether person i got it right."""
    return [{"user_id": f"{prefix}{i}", "event_data": {"questionId": qid, "correct": ok}}
            for i, ok in enumerate(results)]


def test_retry_performance_ranks_by_first_attempt_miss_rate():
    questions = [
        {"id": "q1", "question_text": "Easy"},
        {"id": "q2", "question_text": "Hard"},
        {"id": "q3", "question_text": "Untouched"},
    ]
    first = _tries("q1", [True] * 4 + [False]) + _tries("q2", [False] * 4 + [True])
    retry = _tries("q2", [True, False, False, True, False]) + _tries("q1", [True] * 5)
    out = svc._calculate_retry_performance(questions, first, retry)
    assert out[0]["question_id"] == "q2"
    assert out[0]["first_attempt_miss_rate"] == 80.0
    assert out[0]["retry_miss_rate"] == 60.0
    assert out[1]["question_id"] == "q1"
    assert out[1]["first_attempt_miss_rate"] == 20.0
    assert out[2]["question_id"] == "q3"
    assert out[2]["first_attempt_total"] is None
    assert out[2]["retry_total"] is None


def test_retry_performance_handles_no_data():
    assert svc._calculate_retry_performance([], [], []) == []


def test_retry_performance_ignores_events_with_missing_question_id():
    questions = [{"id": "q1", "question_text": "Q"}]
    first = [{"user_id": "x", "event_data": {"correct": False}}] + _tries("q1", [False] * 5)
    out = svc._calculate_retry_performance(questions, first, [])
    assert out[0]["first_attempt_total"] == 5
    assert out[0]["first_attempt_miss_rate"] == 100.0
