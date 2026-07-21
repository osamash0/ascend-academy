"""
Unit tests for the P5-1 event schema governance layer
(backend/schemas/learning_events.py, docs/ROADMAP_10X_FOUNDATION.md §13).

Covers the three acceptance-criteria behaviors at the Pydantic layer:
  (a) an unknown event_type is rejected at write
  (b) each known event_type's payload validates correctly against its schema
  (c) a malformed payload for a known event_type is rejected

The DB-level backstop (the `event_type` CHECK constraint added by
20260720000000_learning_events_schema_governance.sql) is validated against a
real local Postgres in backend/tests/db/test_learning_events_schema_db.py
(gated behind the `db` marker).
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.repositories import event_repo
from backend.schemas.learning_events import (
    EVENT_REGISTRY,
    KNOWN_EVENT_TYPES,
    UnknownEventTypeError,
    validate_event,
)

# ── Ground-truth valid payload per event type ────────────────────────────────
# Mirrors the exact fields each real write call site sends (see module
# docstring in backend/schemas/learning_events.py for the source audit).

VALID_PAYLOADS: dict[str, dict] = {
    "lecture_start": {"lectureId": "L1", "sessionId": "s1"},
    "slide_view": {
        "lectureId": "L1", "slideId": "sl1", "slideTitle": "Intro",
        "duration_seconds": 42, "sessionId": "s1", "timestamp": "2026-07-20T00:00:00Z",
    },
    "quiz_attempt": {
        "lectureId": "L1", "slideId": "sl1", "slideTitle": "Intro", "questionId": "q1",
        "correct": True, "selectedAnswer": 2, "sessionId": "s1",
        "timestamp": "2026-07-20T00:00:00Z", "time_to_answer_seconds": 12,
    },
    "quiz_retry_attempt": {
        "lectureId": "L1", "slideId": "sl1", "slideTitle": "Intro", "questionId": "q1",
        "correct": False, "selectedAnswer": 1, "firstAttemptAnswer": 0, "reviewIndex": 3,
        "sessionId": "s1", "timestamp": "2026-07-20T00:00:00Z",
    },
    "lecture_complete": {
        "lectureId": "L1", "xpEarned": 50, "correctAnswers": 4, "sessionId": "s1",
        "completed_at": "2026-07-20T00:00:00Z", "total_duration_seconds": 900,
    },
    "ai_tutor_query": {
        "lectureId": "L1", "slideId": "sl1", "slideTitle": "Intro", "sessionId": "s1",
        "query": "What is a derivative?", "response": "It's a rate of change.",
        "timestamp": "2026-07-20T00:00:00Z",
    },
    "micro_quiz_attempt": {
        "lectureId": "L1", "slideId": "sl1", "questionId": "q1", "correct": True,
        "selectedAnswer": 0, "timestamp": "2026-07-20T00:00:00Z",
    },
    "login": {"timestamp": "2026-07-20T00:00:00Z", "method": "email_password"},
    "slide_back_navigation": {
        "lectureId": "L1", "fromSlideId": "sl2", "toSlideId": "sl1", "sessionId": "s1",
        "timestamp": "2026-07-20T00:00:00Z",
    },
    "confidence_rating": {
        "lectureId": "L1", "slideId": "sl1", "slideTitle": "Intro", "rating": "got_it",
        "sessionId": "s1", "timestamp": "2026-07-20T00:00:00Z",
    },
    "search_performed": {"query": "mitosis", "result_counts": {"lectures": 3, "slides": 5}},
    "exam_generated": {"exam_id": "e1", "course_id": "c1"},
    "exam_submitted": {"exam_id": "e1", "score": 87.5, "expired": False},
    "review_graded": {"card_id": "cd1", "rating": 3},
}


def test_registry_covers_exactly_the_audited_catalog():
    """The registry (and by extension the CHECK constraint it must mirror)
    covers exactly the 14 event types found by auditing every write call
    site — no more, no less. A change here without updating the migration
    (or vice versa) is a bug."""
    assert KNOWN_EVENT_TYPES == set(VALID_PAYLOADS)
    assert len(KNOWN_EVENT_TYPES) == 14


@pytest.mark.parametrize("event_type", sorted(VALID_PAYLOADS))
def test_known_event_type_valid_payload_validates(event_type):
    """(b) each known event_type's payload validates correctly against its schema."""
    model = validate_event(event_type, VALID_PAYLOADS[event_type])
    assert model.__class__ is EVENT_REGISTRY[event_type]


def test_unknown_event_type_rejected():
    """(a) an unknown/unconstrained event_type is rejected at write (Pydantic layer)."""
    with pytest.raises(UnknownEventTypeError):
        validate_event("totally_made_up_event", {"anything": 1})


@pytest.mark.parametrize(
    "event_type,bad_payload",
    [
        # missing a required field
        ("slide_view", {"lectureId": "L1", "slideId": "sl1"}),
        # wrong type for a field (pydantic's lax bool coercion accepts
        # strings like "yes"/"no", so use a shape that's unambiguously not
        # bool-coercible)
        ("quiz_attempt", {**VALID_PAYLOADS["quiz_attempt"], "correct": {"nested": True}}),
        # unconstrained rating value outside the Literal enum
        ("confidence_rating", {**VALID_PAYLOADS["confidence_rating"], "rating": "meh"}),
        # unexpected/renamed key (extra="forbid") — e.g. the legacy snake_case
        # `lecture_id` instead of the canonical `lectureId`
        ("lecture_start", {"lecture_id": "L1", "sessionId": "s1"}),
        # extra unexpected field alongside otherwise-valid data
        ("login", {**VALID_PAYLOADS["login"], "unexpected_field": True}),
    ],
)
def test_malformed_payload_for_known_type_rejected(event_type, bad_payload):
    """(c) a malformed payload for a known event_type is rejected."""
    with pytest.raises(ValidationError):
        validate_event(event_type, bad_payload)


def test_insert_event_rejects_unknown_type(fake_supabase):
    """The shared backend write boundary (event_repo.insert_event) refuses
    to write a row for an unregistered event_type."""
    with pytest.raises(UnknownEventTypeError):
        event_repo.insert_event(fake_supabase, "u-1", "not_a_real_event", {})
    assert not fake_supabase.tables.get("learning_events")


def test_insert_event_rejects_malformed_payload(fake_supabase):
    with pytest.raises(ValidationError):
        event_repo.insert_event(fake_supabase, "u-1", "slide_view", {"lectureId": "L1"})
    assert not fake_supabase.tables.get("learning_events")
