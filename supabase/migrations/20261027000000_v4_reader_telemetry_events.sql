-- v4 reader telemetry (docs/superpowers/plans/2026-10-26-how-its-landing-plan-1-reader-telemetry.md):
-- one new governed event type, `checkpoint_attempt` — a checkpoint or
-- teach-back result from the v4 reader, graded on the server.
--
-- Lockstep: backend/schemas/learning_events.py (CheckpointAttempt,
-- EVENT_REGISTRY). Must sort after 20260731000000, which last re-declared
-- this constraint on the partitioned parent.
--
-- Second change, same transaction: the professor read policy on
-- learning_events no longer returns v4 reader questions (an `ai_tutor_query`
-- whose event_data.source is 'v4_reader'). Spec §0 of
-- docs/superpowers/specs/2026-10-26-how-its-landing-design.md: the people who
-- run a Space see v4 questions only as themes over >= 5 askers, never
-- verbatim, and the backend's legacy views already skip these rows. Without
-- this, a professor JWT could still SELECT the raw question text straight
-- from PostgREST. Every other event of an enrolled student stays readable.
-- The policy is the one declared in 20260721010000 (the rebuild re-created it
-- from 20260621000000) plus that one extra condition.
--
-- Apply to prod BEFORE deploying the backend that writes checkpoint_attempt.
-- Applied by hand with psql, so it is one transaction: a failed ADD below
-- must not leave the table without its CHECK.

BEGIN;

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

-- The professor read policy, re-declared with the v4 reader's questions
-- excluded. `->>` yields NULL for a row without the key, and
-- `type = 'ai_tutor_query' AND NULL` is NULL, which NOT turns into NULL:
-- guard with COALESCE so such rows (the legacy Ask) stay visible.
DROP POLICY IF EXISTS "Professors view events for their enrolled students"
    ON public.learning_events;

CREATE POLICY "Professors view events for their enrolled students"
ON public.learning_events FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'professor')
  AND EXISTS (
    SELECT 1
    FROM public.course_enrollments ce
    JOIN public.courses c ON c.id = ce.course_id
    WHERE c.professor_id = auth.uid()
      AND ce.user_id = learning_events.user_id
  )
  AND NOT (
    learning_events.event_type = 'ai_tutor_query'
    AND COALESCE(learning_events.event_data->>'source', '') = 'v4_reader'
  )
);

COMMIT;
