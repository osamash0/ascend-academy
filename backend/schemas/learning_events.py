"""
Event registry & payload contracts for `learning_events` (P5-1 — event schema
governance, docs/ROADMAP_10X_FOUNDATION.md §13).

This module is the canonical, reviewed catalog of every `event_type` the
platform emits into `learning_events.event_data`. Adding a new event type is
a reviewed change: add the Pydantic model below AND the matching value to the
`event_type` CHECK constraint in
supabase/migrations/20260720000000_learning_events_schema_governance.sql —
the two must stay in lockstep.

Ground truth (audited 2026-07-20 across backend/ and src/)
------------------------------------------------------------
Frontend writes (browser → Supabase directly via `logLearningEvent()` in
src/services/studentService.ts — these bypass the backend entirely, so the
DB-level CHECK constraint is the only enforcement point for them):
    lecture_start, slide_view, quiz_attempt, quiz_retry_attempt,
    lecture_complete, ai_tutor_query, micro_quiz_attempt, login,
    slide_back_navigation, confidence_rating

Backend writes (Python, via backend/repositories/event_repo.py:insert_event,
or a raw asyncpg INSERT in backend/api/v1/{exams,review}.py):
    search_performed, exam_generated, exam_submitted, review_graded

Canonical key spelling
-----------------------
The Python/Postgres convention (snake_case) was the assumed default for the
payload's lecture-reference key going in. Auditing every actual write call
site shows the opposite in practice: all 13 real payloads that carry a
lecture reference use `lectureId` (camelCase) — 100%, not a mere majority.
The reason is structural: the majority-share writer of learning_events is
browser TypeScript (10 of 14 event types, all via `logLearningEvent()`),
where camelCase is the native convention — not backend Python.

Decision: canonicalize NEW writes on `lectureId` (camelCase) as the JSONB
payload key. This matches the overwhelming majority of real traffic and
avoids forcing a rewrite of the frontend's only write path for most event
types. Postgres/DB *column* names stay snake_case as usual (this is only
about a key inside the `event_data` JSONB blob, which is an
application-defined envelope, not a relational column).

The `invalidate_analytics_cache_on_event()` trigger
(20260503000017_analytics_cache.sql:60-71) currently double-parses
`lectureId` OR `lecture_id` defensively. Recommendation for the P2-4
initiative (which owns that trigger): once producers only emit payloads
validated against this registry, the `lecture_id` fallback branch can be
deleted — no real writer has ever produced that spelling; it was defensive
code for a variant that doesn't exist in practice.

Backend writers without a lecture reference (search_performed,
exam_generated/submitted's course/exam ids, review_graded's card id) don't
use either spelling — they key on their own natural id (`course_id`,
`exam_id`, `card_id`), which is unambiguous and not part of this decision.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class _EventPayload(BaseModel):
    """Base for all learning_events payloads.

    `extra="forbid"` so a renamed/typo'd/unexpected field is caught at write
    time instead of silently dropped by Postgres (jsonb accepts anything) or
    defensively re-parsed downstream by every analytics consumer.
    """

    model_config = ConfigDict(extra="forbid")


# ── Frontend (browser-direct) event payloads ─────────────────────────────────


class LectureStart(_EventPayload):
    lectureId: str
    sessionId: str


class SlideView(_EventPayload):
    lectureId: str
    slideId: str
    slideTitle: str | None = None
    duration_seconds: int
    sessionId: str
    timestamp: str


class QuizAttempt(_EventPayload):
    lectureId: str
    slideId: str | None = None
    slideTitle: str | None = None
    questionId: str
    correct: bool
    selectedAnswer: int | None = None
    sessionId: str
    timestamp: str
    time_to_answer_seconds: int | None = None


class QuizRetryAttempt(_EventPayload):
    lectureId: str
    slideId: str | None = None
    slideTitle: str | None = None
    questionId: str
    correct: bool
    selectedAnswer: int | None = None
    firstAttemptAnswer: int | None = None
    reviewIndex: int
    sessionId: str
    timestamp: str


class LectureComplete(_EventPayload):
    lectureId: str
    xpEarned: int
    correctAnswers: int
    sessionId: str
    completed_at: str
    total_duration_seconds: int | None = None


class AiTutorQuery(_EventPayload):
    lectureId: str
    slideId: str | None = None
    slideTitle: str | None = None
    sessionId: str
    query: str
    response: str | None = None
    timestamp: str


class MicroQuizAttempt(_EventPayload):
    lectureId: str
    slideId: str
    questionId: str
    correct: bool
    selectedAnswer: int | None = None
    timestamp: str


class Login(_EventPayload):
    timestamp: str
    method: str


class SlideBackNavigation(_EventPayload):
    lectureId: str
    fromSlideId: str | None = None
    toSlideId: str | None = None
    sessionId: str
    timestamp: str


class ConfidenceRating(_EventPayload):
    lectureId: str
    slideId: str
    slideTitle: str | None = None
    rating: Literal["got_it", "unsure", "confused"]
    sessionId: str
    timestamp: str


# ── Backend-written event payloads ───────────────────────────────────────────


class SearchPerformed(_EventPayload):
    query: str
    result_counts: dict[str, int]


class ExamGenerated(_EventPayload):
    exam_id: str
    course_id: str


class ExamSubmitted(_EventPayload):
    exam_id: str
    score: float
    expired: bool


class ReviewGraded(_EventPayload):
    card_id: str
    rating: int


# ── Registry ──────────────────────────────────────────────────────────────────
# Single source of truth: every valid `event_type` value + its payload model.
# MUST stay in lockstep with the CHECK constraint added by
# 20260720000000_learning_events_schema_governance.sql — adding an event type
# here without updating that migration (or vice versa) is a bug, not a valid
# standalone change.

EVENT_REGISTRY: dict[str, type[_EventPayload]] = {
    "lecture_start": LectureStart,
    "slide_view": SlideView,
    "quiz_attempt": QuizAttempt,
    "quiz_retry_attempt": QuizRetryAttempt,
    "lecture_complete": LectureComplete,
    "ai_tutor_query": AiTutorQuery,
    "micro_quiz_attempt": MicroQuizAttempt,
    "login": Login,
    "slide_back_navigation": SlideBackNavigation,
    "confidence_rating": ConfidenceRating,
    "search_performed": SearchPerformed,
    "exam_generated": ExamGenerated,
    "exam_submitted": ExamSubmitted,
    "review_graded": ReviewGraded,
}

KNOWN_EVENT_TYPES: frozenset[str] = frozenset(EVENT_REGISTRY)


class UnknownEventTypeError(ValueError):
    """Raised when an event_type isn't in EVENT_REGISTRY."""


def validate_event(event_type: str, event_data: dict) -> _EventPayload:
    """Validate `event_data` against the payload schema registered for
    `event_type`.

    Raises `UnknownEventTypeError` for an unregistered type, or
    `pydantic.ValidationError` for a payload that doesn't match its type's
    schema. This is the write-boundary check every backend insert path
    should call before hitting Postgres (belt); the `event_type` CHECK
    constraint on `learning_events` is the DB-side backstop (suspenders) —
    it's also the only enforcement for the frontend's direct-to-Supabase
    writes, which never pass through this function.
    """
    model = EVENT_REGISTRY.get(event_type)
    if model is None:
        raise UnknownEventTypeError(
            f"Unknown learning_events.event_type: {event_type!r}. "
            f"Register it in backend/schemas/learning_events.py "
            f"(EVENT_REGISTRY) and in the event_type CHECK constraint "
            f"migration before writing it."
        )
    return model.model_validate(event_data)
