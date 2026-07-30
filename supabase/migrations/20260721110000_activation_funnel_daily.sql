-- Cohort-level activation reporting. This view intentionally exposes only
-- aggregated counts; individual lifecycle state remains in RLS-protected
-- profiles, onboarding_progress, lectures, and learning_events.

CREATE OR REPLACE VIEW public.activation_funnel_daily
WITH (security_invoker = true)
AS
WITH cohorts AS (
  SELECT
    p.user_id,
    p.created_at AS account_created_at,
    date_trunc('day', p.created_at)::date AS cohort_date,
    COALESCE((
      SELECT ur.role::text
      FROM public.user_roles ur
      WHERE ur.user_id = p.user_id
      ORDER BY ur.role::text
      LIMIT 1
    ), 'student') AS role,
    op.completed_at,
    op.activated_at,
    op.second_session_started_at
  FROM public.profiles p
  LEFT JOIN public.onboarding_progress op ON op.user_id = p.user_id
), flags AS (
  SELECT
    c.*,
    EXISTS (
      SELECT 1
      FROM public.learning_events e
      WHERE e.user_id = c.user_id
        AND e.event_type IN ('quiz_attempt', 'micro_quiz_attempt')
    ) AS attempted_quiz,
    EXISTS (
      SELECT 1
      FROM public.lectures l
      WHERE l.professor_id = c.user_id
    ) AS uploaded_lecture,
    EXISTS (
      SELECT 1
      FROM public.learning_events e
      WHERE e.user_id = c.user_id
        AND e.event_type = 'analytics_dashboard_viewed'
    ) AS viewed_analytics
  FROM cohorts c
)
SELECT
  cohort_date,
  role,
  count(*) AS accounts_created,
  count(*) FILTER (
    WHERE completed_at IS NOT NULL
      AND completed_at <= account_created_at + interval '24 hours'
  ) AS onboarding_completed_24h,
  count(*) FILTER (
    WHERE activated_at IS NOT NULL
      AND activated_at <= account_created_at + interval '24 hours'
  ) AS first_learning_activity_24h,
  count(*) FILTER (WHERE attempted_quiz) AS accounts_with_quiz,
  count(*) FILTER (WHERE uploaded_lecture) AS accounts_with_upload,
  count(*) FILTER (WHERE viewed_analytics) AS accounts_with_analytics_view,
  count(*) FILTER (
    WHERE second_session_started_at >= account_created_at + interval '1 day'
      AND second_session_started_at < account_created_at + interval '8 days'
  ) AS returned_day_1_to_7
FROM flags
GROUP BY cohort_date, role;

COMMENT ON VIEW public.activation_funnel_daily IS
  'Daily signup cohorts by role for activation and retention reporting. Aggregated only.';

REVOKE ALL ON public.activation_funnel_daily FROM PUBLIC;
GRANT SELECT ON public.activation_funnel_daily TO service_role;
