-- DATABASE TUNING FOR ASCEND ACADEMY ANALYTICS
-- Run these commands in the Supabase SQL Editor to improve query performance.

-- 1. Create a GIN index on the event_data JSONB column
-- This allows Postgres to search inside the JSON much faster.
CREATE INDEX IF NOT EXISTS idx_learning_events_data_lecture_id 
ON learning_events USING GIN (event_data jsonb_path_ops);

-- 2. Create a standard index on event_type
-- This speeds up filtering by 'slide_view', 'quiz_attempt', etc.
CREATE INDEX IF NOT EXISTS idx_learning_events_type 
ON learning_events (event_type);

-- 3. Create an index on lecture_id for the slides and student_progress tables
CREATE INDEX IF NOT EXISTS idx_slides_lecture_id ON slides (lecture_id);
CREATE INDEX IF NOT EXISTS idx_student_progress_lecture_id ON student_progress (lecture_id);

-- 4. Composite index for user-specific lecture progress
CREATE INDEX IF NOT EXISTS idx_student_progress_user_lecture 
ON student_progress (user_id, lecture_id);

-- Verify that the indexes were created successfully
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('learning_events', 'slides', 'student_progress');
