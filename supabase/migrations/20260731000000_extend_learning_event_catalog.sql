-- Add `lecture_uploaded` and `onboarding_completed` to the governed
-- `event_type` catalog.
--
-- Background: both are emitted by the fix/s6-continuous-security-ci branch,
-- which was developed in parallel with P5-1 event-schema governance
-- (20260720000000) and P5-4 partitioning (20260721010000):
--   * lecture_uploaded    -- backend/services/parser/persist.py:create_lecture
--                            (first successful professor upload; re-parses
--                            deliberately do not re-emit)
--   * onboarding_completed -- the complete_onboarding() RPC added by
--                            20260721100000, which INSERTs directly from SQL
-- Neither governance catalog knew about them, so merging the two lines left
-- live producers writing event types the CHECK constraint rejects. This
-- migration closes that gap.
--
-- Audited the whole tree for other ungoverned producers; these are the only
-- two. `analytics_dashboard_viewed` appears in 20260721110000 but only as a
-- read-side filter -- nothing writes it, so it is deliberately NOT added
-- here (adding it would imply a producer that does not exist).
--
-- Ordering note: this MUST sort after 20260721010000, which re-declares
-- `learning_events_event_type_check` from scratch on the new partitioned
-- parent table. Applying it earlier would simply be overwritten.
--
-- The matching Pydantic model + EVENT_REGISTRY entry live in
-- backend/schemas/learning_events.py (LectureUploaded). Per that module's
-- contract the two must stay in lockstep -- this migration is the DB half.

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
        'onboarding_completed'
    ));

COMMENT ON CONSTRAINT learning_events_event_type_check ON public.learning_events IS
    'P5-1 event schema governance: event_type must be one of the catalog '
    'in backend/schemas/learning_events.py (EVENT_REGISTRY). Extended with '
    'lecture_uploaded by 20260731000000.';
