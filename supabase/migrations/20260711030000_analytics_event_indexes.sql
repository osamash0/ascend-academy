-- Analytics performance: index learning_events for the access patterns the
-- analytics service actually uses.
--
-- analytics_service.py filters learning_events with PostgREST `.contains(
-- "event_data", {"lectureId": ...})` (emitted as the JSONB `@>` containment
-- operator) plus `.eq("event_type", ...)`, and windows by created_at. The only
-- pre-existing indexes are on user_id and the EXPRESSION (event_data->>'lectureId'),
-- and an expression index cannot serve `@>` containment. As a result every
-- professor-analytics view (slide analytics, dashboard, drop-off, distractors)
-- sequentially scanned learning_events — the fastest-growing table (one row per
-- slide view / quiz attempt / confidence rating).
--
-- These indexes are additive and safe. Idempotent so re-runs are no-ops.

-- 1. GIN index enables the `@>` containment lookups (event_data @> '{"lectureId": ...}').
CREATE INDEX IF NOT EXISTS idx_learning_events_event_data_gin
    ON public.learning_events USING gin (event_data);

-- 2. Composite btree serves the very common `event_type` filter, and the
--    (event_type, created_at) ordering supports time-window analytics queries.
CREATE INDEX IF NOT EXISTS idx_learning_events_type_created
    ON public.learning_events (event_type, created_at);
