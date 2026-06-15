-- Migration: 20260614000000_add_admin_role_and_error_logging.sql
-- Description: Adds admin role, creates analytics backups table, and implements reset/restore functions.

-- 1. Add 'admin' to the public.app_role enum (if it does not exist already)
-- Note: ALTER TYPE ADD VALUE is safe inside migrations as long as it's not used in the same transaction block.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin';

-- 2. Create public.analytics_backups table
CREATE TABLE IF NOT EXISTS public.analytics_backups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT now(),
    backup_data JSONB NOT NULL
);

-- Enable RLS
ALTER TABLE public.analytics_backups ENABLE ROW LEVEL SECURITY;

-- Admins can do everything on backups
DROP POLICY IF EXISTS "Admins can manage analytics backups" ON public.analytics_backups;
CREATE POLICY "Admins can manage analytics backups"
ON public.analytics_backups FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Stored function: reset_all_analytics
-- Collects student progress, events, visits, practice attempts, achievements, notifications,
-- and current profile XP; saves them as a backup, clears tables, and zeroes profiles.
CREATE OR REPLACE FUNCTION public.reset_all_analytics()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_backup_id UUID;
    v_backup_data JSONB;
    v_student_progress JSONB;
    v_learning_events JSONB;
    v_course_visits JSONB;
    v_lecture_visits JSONB;
    v_practice_attempts JSONB;
    v_xp_events JSONB;
    v_achievements JSONB;
    v_notifications JSONB;
    v_profile_snapshots JSONB;
BEGIN
    -- Ensure user is admin or request comes from superuser
    IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Only administrators can reset analytics data.';
    END IF;

    -- Snapshot all analytics tables to JSON arrays
    SELECT COALESCE(json_agg(t), '[]'::json) INTO v_student_progress FROM public.student_progress t;
    SELECT COALESCE(json_agg(t), '[]'::json) INTO v_learning_events FROM public.learning_events t;
    SELECT COALESCE(json_agg(t), '[]'::json) INTO v_course_visits FROM public.course_visits t;
    SELECT COALESCE(json_agg(t), '[]'::json) INTO v_lecture_visits FROM public.lecture_visits t;
    SELECT COALESCE(json_agg(t), '[]'::json) INTO v_practice_attempts FROM public.practice_attempts t;
    SELECT COALESCE(json_agg(t), '[]'::json) INTO v_xp_events FROM public.xp_events t;
    SELECT COALESCE(json_agg(t), '[]'::json) INTO v_achievements FROM public.achievements t;
    SELECT COALESCE(json_agg(t), '[]'::json) INTO v_notifications FROM public.notifications t;
    
    -- Snapshot profile XP and streaks
    SELECT COALESCE(json_agg(t), '[]'::json) INTO v_profile_snapshots FROM (
        SELECT user_id, total_xp, current_level, current_streak, best_streak FROM public.profiles
    ) t;

    -- Combine everything into a single JSONB document
    v_backup_data := json_build_object(
        'student_progress', v_student_progress,
        'learning_events', v_learning_events,
        'course_visits', v_course_visits,
        'lecture_visits', v_lecture_visits,
        'practice_attempts', v_practice_attempts,
        'xp_events', v_xp_events,
        'achievements', v_achievements,
        'notifications', v_notifications,
        'profile_snapshots', v_profile_snapshots
    )::jsonb;

    -- Insert snapshot into backups table
    INSERT INTO public.analytics_backups (backup_data)
    VALUES (v_backup_data)
    RETURNING id INTO v_backup_id;

    -- Delete all rows from analytics and progress tables
    DELETE FROM public.student_progress;
    DELETE FROM public.learning_events;
    DELETE FROM public.course_visits;
    DELETE FROM public.lecture_visits;
    DELETE FROM public.practice_attempts;
    DELETE FROM public.xp_events;
    DELETE FROM public.achievements;
    DELETE FROM public.notifications;

    -- Reset student profiles back to base states
    UPDATE public.profiles
    SET total_xp = 0,
        current_level = 1,
        current_streak = 0,
        best_streak = 0;

    RETURN v_backup_id;
END;
$$;

-- 4. Stored function: restore_analytics
-- Restores all snapshotted data from the backup, restores profile statistics, and deletes the backup.
CREATE OR REPLACE FUNCTION public.restore_analytics(p_backup_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_backup_data JSONB;
BEGIN
    -- Ensure user is admin
    IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Only administrators can restore analytics data.';
    END IF;

    -- Retrieve backup data
    SELECT backup_data INTO v_backup_data FROM public.analytics_backups WHERE id = p_backup_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Backup session with ID % not found.', p_backup_id;
    END IF;

    -- Clear tables first to avoid unique key conflicts during re-insertion
    DELETE FROM public.student_progress;
    DELETE FROM public.learning_events;
    DELETE FROM public.course_visits;
    DELETE FROM public.lecture_visits;
    DELETE FROM public.practice_attempts;
    DELETE FROM public.xp_events;
    DELETE FROM public.achievements;
    DELETE FROM public.notifications;

    -- Restore student_progress
    INSERT INTO public.student_progress (id, user_id, lecture_id, xp_earned, completed_slides, quiz_score, total_questions_answered, correct_answers, last_slide_viewed, completed_at, created_at)
    SELECT id, user_id, lecture_id, xp_earned, completed_slides, quiz_score, total_questions_answered, correct_answers, last_slide_viewed, completed_at, created_at
    FROM jsonb_to_recordset(v_backup_data->'student_progress') AS (
        id UUID, user_id UUID, lecture_id UUID, xp_earned INTEGER, completed_slides INTEGER[], quiz_score INTEGER, total_questions_answered INTEGER, correct_answers INTEGER, last_slide_viewed INTEGER, completed_at TIMESTAMP WITH TIME ZONE, created_at TIMESTAMP WITH TIME ZONE
    );

    -- Restore learning_events
    INSERT INTO public.learning_events (id, user_id, event_type, event_data, created_at)
    SELECT id, user_id, event_type, event_data, created_at
    FROM jsonb_to_recordset(v_backup_data->'learning_events') AS (
        id UUID, user_id UUID, event_type TEXT, event_data JSONB, created_at TIMESTAMP WITH TIME ZONE
    );

    -- Restore course_visits
    INSERT INTO public.course_visits (user_id, course_id, last_visited_at, visit_count)
    SELECT user_id, course_id, last_visited_at, visit_count
    FROM jsonb_to_recordset(v_backup_data->'course_visits') AS (
        user_id UUID, course_id UUID, last_visited_at TIMESTAMP WITH TIME ZONE, visit_count INTEGER
    );

    -- Restore lecture_visits
    INSERT INTO public.lecture_visits (id, user_id, lecture_id, course_id, visited_at)
    SELECT id, user_id, lecture_id, course_id, visited_at
    FROM jsonb_to_recordset(v_backup_data->'lecture_visits') AS (
        id UUID, user_id UUID, lecture_id UUID, course_id UUID, visited_at TIMESTAMP WITH TIME ZONE
    );

    -- Restore practice_attempts
    INSERT INTO public.practice_attempts (id, sheet_id, student_id, answers, score, is_preview, submitted_at)
    SELECT id, sheet_id, student_id, answers, score, is_preview, submitted_at
    FROM jsonb_to_recordset(v_backup_data->'practice_attempts') AS (
        id UUID, sheet_id UUID, student_id UUID, answers JSONB, score REAL, is_preview BOOLEAN, submitted_at TIMESTAMP WITH TIME ZONE
    );

    -- Restore xp_events
    INSERT INTO public.xp_events (id, user_id, xp, reason, created_at)
    SELECT id, user_id, xp, reason, created_at
    FROM jsonb_to_recordset(v_backup_data->'xp_events') AS (
        id UUID, user_id UUID, xp INTEGER, reason TEXT, created_at TIMESTAMP WITH TIME ZONE
    );

    -- Restore achievements
    INSERT INTO public.achievements (id, user_id, badge_name, badge_description, badge_icon, earned_at)
    SELECT id, user_id, badge_name, badge_description, badge_icon, earned_at
    FROM jsonb_to_recordset(v_backup_data->'achievements') AS (
        id UUID, user_id UUID, badge_name TEXT, badge_description TEXT, badge_icon TEXT, earned_at TIMESTAMP WITH TIME ZONE
    );

    -- Restore notifications
    INSERT INTO public.notifications (id, user_id, title, message, type, created_at)
    SELECT id, user_id, title, message, type, created_at
    FROM jsonb_to_recordset(v_backup_data->'notifications') AS (
        id UUID, user_id UUID, title TEXT, message TEXT, type TEXT, created_at TIMESTAMP WITH TIME ZONE
    );

    -- Restore profiles' XP, Level, and Streak states
    UPDATE public.profiles p
    SET total_xp = snap.total_xp,
        current_level = snap.current_level,
        current_streak = snap.current_streak,
        best_streak = snap.best_streak
    FROM jsonb_to_recordset(v_backup_data->'profile_snapshots') AS snap(
        user_id UUID, total_xp INTEGER, current_level INTEGER, current_streak INTEGER, best_streak INTEGER
    )
    WHERE p.user_id = snap.user_id;

    -- Delete backup row since it has been restored
    DELETE FROM public.analytics_backups WHERE id = p_backup_id;

    RETURN TRUE;
END;
$$;

-- 5. Add security policies for Admin Role access to core tables
-- This ensures admins can query everything without needing custom RPC calls.
-- (Bypasses restriction where profiles and progress are student-only or professor-only)

DROP POLICY IF EXISTS "Admins view all roles" ON public.user_roles;
CREATE POLICY "Admins view all roles" ON public.user_roles
    FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage user roles" ON public.user_roles;
CREATE POLICY "Admins manage user roles" ON public.user_roles
    FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins view all profiles" ON public.profiles;
CREATE POLICY "Admins view all profiles" ON public.profiles
    FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage all profiles" ON public.profiles;
CREATE POLICY "Admins manage all profiles" ON public.profiles
    FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage courses" ON public.courses;
CREATE POLICY "Admins manage courses" ON public.courses
    FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage lectures" ON public.lectures;
CREATE POLICY "Admins manage lectures" ON public.lectures
    FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins view learning events" ON public.learning_events;
CREATE POLICY "Admins view learning events" ON public.learning_events
    FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins delete learning events" ON public.learning_events;
CREATE POLICY "Admins delete learning events" ON public.learning_events
    FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins view student progress" ON public.student_progress;
CREATE POLICY "Admins view student progress" ON public.student_progress
    FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins delete student progress" ON public.student_progress;
CREATE POLICY "Admins delete student progress" ON public.student_progress
    FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins view achievements" ON public.achievements;
CREATE POLICY "Admins view achievements" ON public.achievements
    FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins delete achievements" ON public.achievements;
CREATE POLICY "Admins delete achievements" ON public.achievements
    FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
