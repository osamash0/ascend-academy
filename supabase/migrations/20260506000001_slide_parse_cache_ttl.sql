-- Slide Parse Checkpoint Cache — TTL expiry upgrade
--
-- Problem: slide_parse_cache rows have no expiry. Checkpoint rows written
-- during a PDF parse accumulate indefinitely, even though they are only
-- useful for ~7 days (the resume window while a professor retries a failed
-- upload). This migration:
--
--   1. Adds an `expires_at` column (default NOW() + 7 days).
--   2. Back-fills existing rows so they expire 7 days from now rather than
--      being left with NULL (which would exclude them from TTL queries).
--   3. Creates a `cleanup_slide_parse_cache()` helper function that deletes
--      all expired rows. Call it on-demand from the /api/upload/cleanup-cache
--      admin endpoint or via pg_cron.
--   4. Adds an index on `expires_at` so the cleanup query stays fast even
--      with millions of checkpoint rows.

-- Step 1: add the column
ALTER TABLE slide_parse_cache
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
        DEFAULT (NOW() + INTERVAL '7 days');

-- Step 2: back-fill existing NULLs
UPDATE slide_parse_cache
SET expires_at = NOW() + INTERVAL '7 days'
WHERE expires_at IS NULL;

-- Step 3: index for fast cleanup scans
CREATE INDEX IF NOT EXISTS idx_slide_parse_cache_expires_at
    ON slide_parse_cache (expires_at);

-- Step 4: cleanup helper function (SECURITY DEFINER so it runs as the table
--         owner — safe because it only deletes from slide_parse_cache)
CREATE OR REPLACE FUNCTION public.cleanup_slide_parse_cache()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM slide_parse_cache
    WHERE expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- Grant EXECUTE only to the service role (backend), not to anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.cleanup_slide_parse_cache() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_slide_parse_cache() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_slide_parse_cache() FROM authenticated;
