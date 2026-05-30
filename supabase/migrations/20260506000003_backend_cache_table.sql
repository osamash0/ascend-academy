-- Shared backend L2 token cache: backend_cache
--
-- This table is the shared key-value store used by all FastAPI workers to
-- cache validated Supabase Auth tokens (and any other short-lived backend
-- data). Without it, every authenticated request requires a round-trip to
-- Supabase Auth (100-250ms latency). With it, auth is resolved from the
-- database in ~2ms, and the result is shared across all worker processes.
--
-- Keys are stored as auth_token:<sha256(raw_token)> so the raw JWT never
-- touches this table.
--
-- TTL: rows carry an `expires_at` timestamp. The get_cache() function
-- filters by `expires_at > now()`, so stale rows are invisible even before
-- physical deletion. The cleanup_backend_cache() function below removes them.
--
-- RLS: service-role only. No client-side access to this table.

CREATE TABLE IF NOT EXISTS public.backend_cache (
    cache_key  TEXT        PRIMARY KEY,
    data       JSONB       NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for TTL cleanup scans (ORDER BY expires_at ASC)
CREATE INDEX IF NOT EXISTS idx_backend_cache_expires_at
    ON public.backend_cache (expires_at);

-- Enable RLS
ALTER TABLE public.backend_cache ENABLE ROW LEVEL SECURITY;

-- Service-role only — no authenticated or anon access
CREATE POLICY "Service role select on backend_cache"
    ON public.backend_cache FOR SELECT
    USING (auth.role() = 'service_role');

CREATE POLICY "Service role insert on backend_cache"
    ON public.backend_cache FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role update on backend_cache"
    ON public.backend_cache FOR UPDATE
    USING (auth.role() = 'service_role');

CREATE POLICY "Service role delete on backend_cache"
    ON public.backend_cache FOR DELETE
    USING (auth.role() = 'service_role');

-- Cleanup helper: deletes all expired rows.
-- Call from POST /api/upload/cleanup-cache or via pg_cron nightly.
CREATE OR REPLACE FUNCTION public.cleanup_backend_cache()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.backend_cache
    WHERE expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_backend_cache() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_backend_cache() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_backend_cache() FROM authenticated;
