-- LLM cost + token accounting: public.llm_calls (Roadmap Foundation 10x, Phase 1 P1-1)
--
-- Before this table, LLM usage was completely unmetered in dollar/token
-- terms: backend/services/ai/orchestrator.py's ProviderRotator counted
-- *requests* per day, not tokens or cost, and per-process rather than
-- fleet-wide. There was no way to answer "how much did this user/course/
-- feature cost us this month" and no persisted record to build such a
-- report from.
--
-- One row per LLM completion, written by backend/services/ai/cost.py's
-- `log_llm_call()` (asyncpg, best-effort — a logging failure must never
-- break the actual LLM response path, so failures there are caught and
-- logged, not surfaced). `user_id`/`course_id` are nullable: most orchestrator
-- call sites don't thread these through yet (Roadmap fast-follow), so a NULL
-- user_id means "cost/tokens are still counted, just not attributed to a
-- specific user" rather than "this call wasn't logged".
--
-- RLS: service-role only, mirroring public.backend_cache
-- (20260506000003_backend_cache_table.sql) — no direct client access;
-- PostgREST never exposes this table to anon/authenticated.

CREATE TABLE IF NOT EXISTS public.llm_calls (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id             UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    course_id           UUID        REFERENCES public.courses(id) ON DELETE SET NULL,
    feature             TEXT        NOT NULL,
    provider            TEXT        NOT NULL,
    model               TEXT        NOT NULL,
    prompt_tokens       INTEGER     NOT NULL DEFAULT 0,
    completion_tokens   INTEGER     NOT NULL DEFAULT 0,
    est_cost_usd        NUMERIC(12, 6) NOT NULL DEFAULT 0
);

-- Admin "per-user monthly spend" and cost-by-feature/provider reporting are
-- the two read patterns this table exists to serve.
CREATE INDEX IF NOT EXISTS idx_llm_calls_user_created_at
    ON public.llm_calls (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_feature_created_at
    ON public.llm_calls (feature, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_provider_created_at
    ON public.llm_calls (provider, created_at);

ALTER TABLE public.llm_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role select on llm_calls"
    ON public.llm_calls FOR SELECT
    USING (auth.role() = 'service_role');

CREATE POLICY "Service role insert on llm_calls"
    ON public.llm_calls FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role delete on llm_calls"
    ON public.llm_calls FOR DELETE
    USING (auth.role() = 'service_role');
