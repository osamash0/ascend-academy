-- ─────────────────────────────────────────────────────────────────────────────
-- Durable record of what an account erasure still has to delete.
--
-- GDPR erasure (backend/services/erasure.py) builds a manifest of storage keys
-- BEFORE deleting auth.users, because the cascade removes the lectures rows
-- that were the only map from a person to their files. The manifest is kept
-- here so a failed file delete is retried by the worker instead of becoming an
-- unrecoverable orphan (MILESTONE_2026_08 F2).
--
-- No FK to auth.users on purpose: the row must outlive the account it erases.
-- The row is deleted once its files are gone. Service role only.
-- APPLY BY HAND (psql, one transaction). Never `supabase db push`.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_erasure_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id  uuid NOT NULL,
  manifest    jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'awaiting_auth_delete'
              CHECK (status IN ('awaiting_auth_delete', 'pending')),
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_erasure_jobs_status_created_idx
  ON public.account_erasure_jobs (status, created_at);

ALTER TABLE public.account_erasure_jobs ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (which bypasses RLS) reads or writes.
REVOKE ALL ON public.account_erasure_jobs FROM PUBLIC;
REVOKE ALL ON public.account_erasure_jobs FROM anon, authenticated;
-- Explicit, rather than relying on Supabase's default privileges.
GRANT ALL ON public.account_erasure_jobs TO service_role;
