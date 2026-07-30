-- Dead-letter queue for permanently-failed Arq jobs (Roadmap P2-3)
--
-- Today a job that exhausts Arq's max_tries has nowhere to land except a
-- WARNING log line and (if keep_result is set) a result blob in the 128MB
-- noeviction queue Redis that nobody polls. This table gives permanently
-- failed jobs a durable, inspectable, manually re-drainable home — payload
-- (function name + args/kwargs) plus the last error, written best-effort
-- from the worker's `after_job_end` hook (see backend/workers/dlq.py).
--
-- RLS: service-role only, mirroring backend_cache (20260506000003) — no
-- client-side access; only the FastAPI/worker backend (service-role key)
-- reads or writes this table.

CREATE TABLE IF NOT EXISTS public.dead_letter_jobs (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    function_name TEXT        NOT NULL,
    job_id        TEXT,
    args          JSONB       NOT NULL DEFAULT '[]'::jsonb,
    kwargs        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    job_try       INTEGER,
    error         TEXT        NOT NULL,
    failed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Manual drain workflow: an operator marks a row resolved after
    -- re-enqueuing / fixing the underlying cause, instead of deleting it
    -- outright (keeps an audit trail of what broke and when).
    resolved_at   TIMESTAMPTZ,
    resolved_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_failed_at
    ON public.dead_letter_jobs (failed_at DESC);

CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_unresolved
    ON public.dead_letter_jobs (function_name)
    WHERE resolved_at IS NULL;

ALTER TABLE public.dead_letter_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role select on dead_letter_jobs"
    ON public.dead_letter_jobs FOR SELECT
    USING (auth.role() = 'service_role');

CREATE POLICY "Service role insert on dead_letter_jobs"
    ON public.dead_letter_jobs FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role update on dead_letter_jobs"
    ON public.dead_letter_jobs FOR UPDATE
    USING (auth.role() = 'service_role');

CREATE POLICY "Service role delete on dead_letter_jobs"
    ON public.dead_letter_jobs FOR DELETE
    USING (auth.role() = 'service_role');
