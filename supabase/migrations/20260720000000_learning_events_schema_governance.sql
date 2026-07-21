-- P5-1 — Event schema governance (docs/ROADMAP_10X_FOUNDATION.md §13).
--
-- `learning_events.event_type` was unconstrained free-text: any string was
-- accepted, payload shapes drifted, and every consumer defensively re-parsed
-- variants. This migration adds a CHECK constraint restricting `event_type`
-- to the catalog of values actually emitted by the codebase today (audited
-- 2026-07-20 across backend/ and src/ — see backend/schemas/learning_events.py
-- for the full registry + one Pydantic payload model per type, which is the
-- reviewed source of truth this constraint must stay in lockstep with).
--
-- This is a fresh migration chain with no existing production rows for this
-- constraint to violate, so no backfill/cleanup step is needed here. If this
-- constraint is ever applied to a database that already has `learning_events`
-- rows, run a pre-flight audit first:
--   SELECT event_type, count(*) FROM learning_events
--   WHERE event_type NOT IN (<catalog below>) GROUP BY 1;
-- and either backfill/rename those rows or extend the catalog before adding
-- the constraint, or it will fail to apply.
--
-- Event types, by writer (see backend/schemas/learning_events.py docstring
-- for the full audit trail):
--   Frontend (browser → Supabase directly via src/services/studentService.ts
--   `logLearningEvent()`, bypassing the backend):
--     lecture_start, slide_view, quiz_attempt, quiz_retry_attempt,
--     lecture_complete, ai_tutor_query, micro_quiz_attempt, login,
--     slide_back_navigation, confidence_rating
--   Backend (Python, via backend/repositories/event_repo.py:insert_event or a
--   raw asyncpg INSERT in backend/api/v1/{exams,review}.py):
--     search_performed, exam_generated, exam_submitted, review_graded

ALTER TABLE public.learning_events
    ADD CONSTRAINT learning_events_event_type_check
    CHECK (event_type IN (
        'lecture_start',
        'slide_view',
        'quiz_attempt',
        'quiz_retry_attempt',
        'lecture_complete',
        'ai_tutor_query',
        'micro_quiz_attempt',
        'login',
        'slide_back_navigation',
        'confidence_rating',
        'search_performed',
        'exam_generated',
        'exam_submitted',
        'review_graded'
    ));

COMMENT ON CONSTRAINT learning_events_event_type_check ON public.learning_events IS
    'P5-1 event schema governance: event_type must be one of the catalog '
    'in backend/schemas/learning_events.py (EVENT_REGISTRY). Adding a new '
    'event type is a reviewed change — update both this constraint and the '
    'matching Pydantic payload model in the same PR.';

-- Payload key-spelling note (see backend/schemas/learning_events.py for the
-- full write-up): every real write call site that carries a lecture
-- reference uses the JSONB key `lectureId` (camelCase), not `lecture_id`.
-- The `invalidate_analytics_cache_on_event()` trigger (20260503000017:60-71)
-- double-parses both spellings defensively; once all new writes go through
-- the validated contract in backend/schemas/learning_events.py, that trigger
-- can be simplified to parse `lectureId` only (no producer has ever written
-- `lecture_id`). Left to the P2-4 initiative, which owns that trigger.
