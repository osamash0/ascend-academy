-- Lecture Blueprint Cache — fix keying strategy to (pdf_hash, version)
--
-- Problem: The original table declared `pdf_hash TEXT UNIQUE NOT NULL`,
-- meaning the unique constraint covers only the PDF hash.  The Python
-- code correctly filters by both pdf_hash and version on reads, but
-- store_cached_blueprint() calls:
--
--   .upsert(data, on_conflict="pdf_hash")
--
-- This means bumping BLUEPRINT_VERSION from 1 → 2 OVERWRITES the
-- existing version-1 row rather than inserting a distinct version-2 row.
-- The version column exists but is not part of the key — the keying
-- strategy documented in the caching review is not actually enforced.
--
-- Fix: drop the single-column unique constraint on pdf_hash, add a
-- composite unique constraint on (pdf_hash, version), and create a
-- matching composite index for fast lookups.
--
-- After this migration:
--   - (pdf_hash=X, version=1) and (pdf_hash=X, version=2) are distinct rows.
--   - Bumping BLUEPRINT_VERSION generates a new row; old versions are kept
--     until explicitly cleaned up by cleanup_old_blueprint_versions().
--   - The Python upsert must use on_conflict="pdf_hash,version".

-- Step 1: drop the old single-column constraint
--         (Supabase auto-names UNIQUE constraints as <table>_<col>_key)
ALTER TABLE public.lecture_blueprints
    DROP CONSTRAINT IF EXISTS lecture_blueprints_pdf_hash_key;

-- Step 2: add composite unique constraint
ALTER TABLE public.lecture_blueprints
    ADD CONSTRAINT lecture_blueprints_pdf_hash_version_key
    UNIQUE (pdf_hash, version);

-- Step 3: composite index that mirrors the constraint for fast lookups
--         (Postgres creates an index implicitly for UNIQUE constraints,
--          but we name it explicitly so we can reference it in EXPLAIN.)
CREATE INDEX IF NOT EXISTS idx_blueprint_pdf_hash_version
    ON public.lecture_blueprints (pdf_hash, version);

-- Step 4: cleanup helper — deletes blueprint rows whose version is older
--         than the current active version for each pdf_hash.  Safe to
--         call any time; SECURITY DEFINER so it bypasses RLS.
CREATE OR REPLACE FUNCTION public.cleanup_old_blueprint_versions(keep_version INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.lecture_blueprints
    WHERE version < keep_version;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- Only the service role (backend) may call this function.
REVOKE EXECUTE ON FUNCTION public.cleanup_old_blueprint_versions(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_blueprint_versions(INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_blueprint_versions(INTEGER) FROM authenticated;
