-- Migration: 20260617000000_secure_profiles_and_add_fk_indexes.sql
-- Description: Fixes profiles SELECT RLS policy to restrict to own-row for regular users,
-- and adds performance indexes on foreign keys that Cascade-Delete/Join heavily.

-- 1. Secure Profiles SELECT RLS Policy
-- Drop any potentially overbroad "view all" policies if they exist or were re-added
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

-- Create policy for authenticated users to view only their own profile row
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 2. Add missing FK indexes
-- course_enrollments.course_id
CREATE INDEX IF NOT EXISTS idx_course_enrollments_course_id
    ON public.course_enrollments(course_id);

-- lecture_visits.lecture_id
CREATE INDEX IF NOT EXISTS idx_lecture_visits_lecture_id
    ON public.lecture_visits(lecture_id);

-- lecture_visits.course_id
CREATE INDEX IF NOT EXISTS idx_lecture_visits_course_id
    ON public.lecture_visits(course_id);

-- schedule_item_completions.lecture_id
CREATE INDEX IF NOT EXISTS idx_schedule_item_completions_lecture_id
    ON public.schedule_item_completions(lecture_id);

-- worksheets.uploaded_by
CREATE INDEX IF NOT EXISTS idx_worksheets_uploaded_by
    ON public.worksheets(uploaded_by);

-- nudge_dismissals.notification_id
CREATE INDEX IF NOT EXISTS idx_nudge_dismissals_notification_id
    ON public.nudge_dismissals(notification_id);
