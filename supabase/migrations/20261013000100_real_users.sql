-- ─────────────────────────────────────────────────────────────────────────────
-- Real users: tell real accounts apart from test, seed and staff accounts.
--
-- As of 2026-10-11, about 150 of 201 profiles were internal (example.com seed
-- users, test.com logins, learnstation-demo.com demo peers, admin accounts),
-- and every admin stat counted them. Nothing is deleted here; accounts are
-- classified, live, by:
--   1. a manual override (internal_account_overrides), which always wins;
--   2. otherwise the first matching email rule (internal_email_rules);
--   3. otherwise the admin role.
-- Because classification is a view, a new signup from a test domain is
-- internal the moment it exists — no trigger, no backfill to drift.
--
-- profiles is readable by every signed-in user, so the flag deliberately does
-- NOT live there: who is "internal" is visible to service_role (the admin API)
-- only. Supabase's default privileges grant new tables and views directly to
-- anon/authenticated, so every object below revokes them explicitly.
-- ─────────────────────────────────────────────────────────────────────────────

-- Prod has this column (added out of band); the migration set never created
-- it, though 20260721110000's view reads it. Idempotent either way.
ALTER TABLE public.onboarding_progress
  ADD COLUMN IF NOT EXISTS second_session_started_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.internal_email_rules (
  id         BIGSERIAL PRIMARY KEY,
  -- A lower-case LIKE pattern matched against lower(profiles.email).
  pattern    TEXT NOT NULL UNIQUE CHECK (pattern = lower(pattern)),
  reason     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_account_overrides (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_internal BOOLEAN NOT NULL,
  reason      TEXT,
  set_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  set_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.internal_email_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_account_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.internal_email_rules FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.internal_account_overrides FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.internal_email_rules TO service_role;
GRANT ALL ON public.internal_account_overrides TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.internal_email_rules_id_seq TO service_role;

INSERT INTO public.internal_email_rules (pattern, reason) VALUES
  ('%@example.com',              'seed / simulated users'),
  ('%@test.com',                 'test login'),
  ('%@test1.com',                'test login'),
  ('%@test.de',                  'test login'),
  ('%@tets.com',                 'test login'),
  ('%.test',                     'reserved .test domain'),
  ('%@learnstation-demo.com',    'demo peers'),
  ('%@ascend.academy',           'team account'),
  ('%@admin.com',                'staff account'),
  ('%@system.learnstation.com',  'system account'),
  ('sim\_user\_%',               'analytics simulator'),
  ('%loadtest%',                 'load test')
ON CONFLICT (pattern) DO NOTHING;

CREATE OR REPLACE VIEW public.account_classification
WITH (security_invoker = true)
AS
SELECT
  p.user_id,
  p.email,
  p.created_at,
  COALESCE(o.is_internal, r.pattern IS NOT NULL OR a.is_admin, false) AS is_internal,
  CASE
    WHEN o.user_id IS NOT NULL AND o.is_internal THEN 'marked internal' || COALESCE(': ' || o.reason, '')
    WHEN o.user_id IS NOT NULL THEN 'marked real' || COALESCE(': ' || o.reason, '')
    WHEN r.pattern IS NOT NULL THEN r.reason
    WHEN a.is_admin THEN 'admin role'
  END AS internal_reason,
  o.user_id IS NOT NULL AS is_manual
FROM public.profiles p
LEFT JOIN public.internal_account_overrides o ON o.user_id = p.user_id
LEFT JOIN LATERAL (
  SELECT rule.pattern, rule.reason
  FROM public.internal_email_rules rule
  WHERE lower(p.email) LIKE rule.pattern
  ORDER BY rule.id
  LIMIT 1
) r ON true
LEFT JOIN LATERAL (
  SELECT true AS is_admin
  FROM public.user_roles ur
  WHERE ur.user_id = p.user_id AND ur.role = 'admin'
  LIMIT 1
) a ON true;

COMMENT ON VIEW public.account_classification IS
  'One row per profile: is it a real user or internal (test/seed/staff)? Admin API only.';

REVOKE ALL ON public.account_classification FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_classification TO service_role;

-- Daily signup cohorts of REAL users, by acquisition source. The step names
-- match the Launch Control funnel: signed up → onboarded → first learning
-- activity → came back (second session) → still here in week 2.
CREATE OR REPLACE VIEW public.real_user_funnel_daily
WITH (security_invoker = true)
AS
WITH real_users AS (
  SELECT
    c.user_id,
    c.created_at,
    op.completed_at,
    op.activated_at,
    op.second_session_started_at,
    COALESCE(NULLIF(trim(op.acquisition_source), ''), 'unknown') AS acquisition_source
  FROM public.account_classification c
  LEFT JOIN public.onboarding_progress op ON op.user_id = c.user_id
  WHERE NOT c.is_internal
)
SELECT
  date_trunc('day', u.created_at)::date AS cohort_date,
  u.acquisition_source,
  count(*) AS signed_up,
  count(*) FILTER (WHERE u.completed_at IS NOT NULL) AS onboarded,
  count(*) FILTER (WHERE u.activated_at IS NOT NULL) AS activated,
  count(*) FILTER (WHERE u.second_session_started_at IS NOT NULL) AS came_back,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM public.learning_events e
    WHERE e.user_id = u.user_id
      AND e.created_at >= u.created_at + interval '7 days'
      AND e.created_at <  u.created_at + interval '14 days'
  )) AS week_2_active
FROM real_users u
GROUP BY 1, 2;

COMMENT ON VIEW public.real_user_funnel_daily IS
  'Real-user signup cohorts by day and acquisition source. Aggregated; admin API only.';

REVOKE ALL ON public.real_user_funnel_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.real_user_funnel_daily TO service_role;
