-- P5-2 (OLTP/OLAP split, staged lift (a)): materialize the heaviest piece of
-- the professor course-overview aggregate instead of recomputing it live on
-- every cache-miss request.
--
-- backend/services/analytics_service.py::_compute_professor_overview backs
-- GET /analytics/professor/overview (backend/api/v1/analytics.py:378). On a
-- cache miss it fetches EVERY learning_events row for EVERY lecture in the
-- course within the `days` window, then re-derives in Python (per request):
--   - active_students          = count(distinct user_id) across the window
--   - median_time_minutes      = median of lecture_complete durations
--   - activity_sparkline       = per-day event counts for the window
-- This is the single largest per-request scan in that endpoint (the other
-- pieces — weakest_concepts/weakest_slides — need item-level slide_id /
-- question_id granularity and are intentionally left live; see the comment
-- in analytics_service.py for why they aren't rolled up here).
--
-- This migration pre-aggregates learning_events into a per
-- (course_id, activity_day) rollup so the three metrics above become a thin
-- read over a handful of rows instead of a full-table scan + Python pass,
-- refreshed on a schedule by an Arq cron job
-- (backend/workers/arq_worker.py::refresh_professor_overview_mv, every 10
-- minutes — see that file for the bounded-staleness rationale).
--
-- Design notes:
--   - Grouped by day (not by the full window) so any `days` value (1..90,
--     see the Query(..., le=90) validator on the endpoint) can be served by
--     summing/unioning the relevant day rows at read time.
--   - `active_user_ids` is stored as a per-day distinct array so the
--     multi-day window's TRUE distinct-user count can still be computed
--     exactly (via unnest + count(distinct)) instead of summing per-day
--     counts, which would double-count students active on more than one day.
--   - `lecture_complete_durations_seconds` is stored as a per-day array (not
--     just a sum/count) so the exact median across the window can still be
--     computed — a sum+count rollup would only support a mean, which is a
--     different statistic and would silently change the endpoint's output,
--     not just its staleness.
--   - A UNIQUE index on (course_id, activity_day) is required for
--     `REFRESH MATERIALIZED VIEW CONCURRENTLY` (Postgres requires at least
--     one unique index on a materialized view to refresh it without taking
--     an ACCESS EXCLUSIVE lock, which is what makes concurrent reads during
--     refresh safe).

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_course_daily_activity AS
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

-- service_role only — this view backs a backend aggregate, never queried
-- directly by PostgREST/anon per the "no new supabase_admin-only surface
-- without RLS" cross-cutting standard; it is read exclusively through the
-- existing asyncpg pool from analytics_service.py.
REVOKE ALL ON public.mv_course_daily_activity FROM PUBLIC, anon, authenticated;
