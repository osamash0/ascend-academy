-- Query Performance Optimizations
-- Based on Supabase PostgreSQL Best Practices

-- 1. Replace inefficient boolean indexes with partial indexes (query-partial-indexes)
DROP INDEX IF EXISTS courses_is_archived_idx;
DROP INDEX IF EXISTS lectures_is_archived_idx;

CREATE INDEX IF NOT EXISTS courses_active_idx ON public.courses(id) WHERE is_archived = FALSE;
CREATE INDEX IF NOT EXISTS lectures_active_idx ON public.lectures(id) WHERE is_archived = FALSE;

-- 2. Add an expression index for the JSONB extraction heavily used in learning_events RLS (query-index-types)
CREATE INDEX IF NOT EXISTS idx_learning_events_lecture_id ON public.learning_events ((event_data->>'lectureId'));
