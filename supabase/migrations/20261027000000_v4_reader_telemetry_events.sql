-- v4 reader telemetry (docs/superpowers/plans/2026-10-26-how-its-landing-plan-1-reader-telemetry.md):
-- one new governed event type, `checkpoint_attempt` — a checkpoint or
-- teach-back result from the v4 reader, graded on the server.
--
-- Lockstep: backend/schemas/learning_events.py (CheckpointAttempt,
-- EVENT_REGISTRY). Must sort after 20260731000000, which last re-declared
-- this constraint on the partitioned parent.
--
-- Apply to prod BEFORE deploying the backend that writes checkpoint_attempt.

ALTER TABLE public.learning_events
    DROP CONSTRAINT IF EXISTS learning_events_event_type_check;

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
        'review_graded',
        'lecture_uploaded',
        'onboarding_completed',
        'checkpoint_attempt'
    ));

COMMENT ON CONSTRAINT learning_events_event_type_check ON public.learning_events IS
    'P5-1 event schema governance: event_type must be one of the catalog '
    'in backend/schemas/learning_events.py (EVENT_REGISTRY). Extended with '
    'checkpoint_attempt by 20261027000000.';
