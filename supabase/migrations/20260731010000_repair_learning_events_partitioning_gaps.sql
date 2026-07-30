-- Repair two gaps left by 20260721010000_learning_events_partitioning_retention.sql.
--
-- That migration rebuilds `learning_events` as a partitioned table by renaming
-- the original aside and CREATE-ing a fresh one. Two things do not survive that
-- rebuild, and it does not restore them. Both were found by auditing the LIVE
-- database (project lkiiideqjoiksnycgplc) against what the migration recreates,
-- BEFORE applying it -- so neither has actually broken anything yet. This
-- migration must run in the same deploy as 20260721010000.
--
-- Not a problem (verified, recorded so nobody re-investigates):
--   * Table grants. `public` has ALTER DEFAULT PRIVILEGES granting arwdDxtm on
--     new tables to anon/authenticated/service_role, so the rebuilt table picks
--     the grants back up automatically. PostgREST writes keep working.
--   * Foreign keys. Nothing references learning_events, so widening the PK to
--     (id, created_at) breaks no referential integrity.
--   * Per-partition RLS. 20260721010000 correctly ENABLEs RLS on the default
--     partition, on each month it pre-creates, and inside
--     ensure_learning_events_partition() -- Postgres does not inherit
--     relrowsecurity from the parent, and that migration already handles it.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Restore the 3 RLS policies the rebuild drops
-- ─────────────────────────────────────────────────────────────────────────
-- Live `learning_events` carries 6 policies; 20260721010000 recreates only 3
-- ("Users can view their own events", "Users can insert their own events",
-- "Professors view events for their enrolled students"). Without the 3 below,
-- admins silently lose read/delete on the event log, and users lose the ability
-- to delete their own events -- which the GDPR erasure path depends on.
-- Reproduced verbatim from the live catalog (pg_policy) so behaviour is
-- byte-for-byte what it is today.

DROP POLICY IF EXISTS "Admins view learning events" ON public.learning_events;
CREATE POLICY "Admins view learning events"
    ON public.learning_events FOR SELECT TO authenticated
    USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins delete learning events" ON public.learning_events;
CREATE POLICY "Admins delete learning events"
    ON public.learning_events FOR DELETE TO authenticated
    USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can delete own events" ON public.learning_events;
CREATE POLICY "Users can delete own events"
    ON public.learning_events FOR DELETE
    USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Re-point mv_course_daily_activity at the rebuilt table
-- ─────────────────────────────────────────────────────────────────────────
-- This is the silent one. A matview's stored query binds to the table's OID,
-- not its name, so `ALTER TABLE learning_events RENAME TO
-- learning_events_legacy_20260721` does NOT error and does NOT repoint the
-- view -- it quietly redefines mv_course_daily_activity over the frozen backup
-- table. Every subsequent REFRESH would succeed while returning data that can
-- never change again, and analytics_service.py's `use_mv` fast path (P5-2)
-- reads exactly this view for the professor overview. The failure mode is
-- plausible-looking stale numbers, not an error, so nothing would alert.
--
-- Dropping and recreating rebinds it to the new partitioned parent. Definition
-- copied unchanged from 20260720000001_professor_overview_daily_activity_mv.sql
-- -- only the binding changes, not the query.

DROP MATERIALIZED VIEW IF EXISTS public.mv_course_daily_activity;

CREATE MATERIALIZED VIEW public.mv_course_daily_activity AS
SELECT
    l.course_id                                                        AS course_id,
    (le.created_at AT TIME ZONE 'UTC')::date                           AS activity_day,
    COUNT(*) FILTER (
        WHERE le.event_type IN (
            'quiz_attempt', 'slide_view', 'ai_tutor_query',
            'lecture_complete', 'confidence_rating'
        )
    )::int                                                             AS tracked_event_count,
    COUNT(DISTINCT le.user_id) FILTER (WHERE le.user_id IS NOT NULL)::int
                                                                        AS distinct_active_users,
    ARRAY_AGG(DISTINCT le.user_id) FILTER (WHERE le.user_id IS NOT NULL)
                                                                        AS active_user_ids,
    ARRAY_AGG((le.event_data ->> 'total_duration_seconds')::numeric) FILTER (
        WHERE le.event_type = 'lecture_complete'
          AND (le.event_data ->> 'total_duration_seconds') IS NOT NULL
    )                                                                   AS lecture_complete_durations_seconds
FROM public.learning_events le
JOIN public.lectures l
    ON l.id::text = (le.event_data ->> 'lectureId')
WHERE l.course_id IS NOT NULL
GROUP BY l.course_id, (le.created_at AT TIME ZONE 'UTC')::date;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_course_daily_activity_course_day
    ON public.mv_course_daily_activity (course_id, activity_day);

-- Speeds up the window read (`WHERE course_id = $1 AND activity_day >= $2`).
CREATE INDEX IF NOT EXISTS idx_mv_course_daily_activity_course_day
    ON public.mv_course_daily_activity (course_id, activity_day DESC);

-- service_role only, matching the original: this view backs a backend
-- aggregate and is read exclusively through analytics_service.py's asyncpg
-- pool, never by PostgREST/anon.
REVOKE ALL ON public.mv_course_daily_activity FROM PUBLIC, anon, authenticated;
