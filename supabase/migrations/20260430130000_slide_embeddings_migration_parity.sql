-- S-2 (GDPR posture, docs/ROADMAP_10X_FOUNDATION.md §14): close the P0-3 gap
-- where `slide_embeddings` exists only in the un-versioned
-- `backend/scripts/slide_embeddings.sql`, never in `supabase/migrations/`.
--
-- MERGE NOTE: this branch was authored independently, before
-- `fix/p0-promote-slide-embeddings-migration` (P0-3) had landed on main —
-- P0-3's `20260430120000_promote_slide_embeddings_and_match_slides.sql`
-- (which this file is now timestamped to sort immediately after) already
-- creates `slide_embeddings` with the exact `ON DELETE CASCADE` FK this
-- migration exists to guarantee. Left in place rather than dropped because
-- it's fully defensive/idempotent (ADD COLUMN IF NOT EXISTS, a
-- constraint-existence-guarded ADD CONSTRAINT) — against a DB that already
-- ran P0-3's migration, every statement here is a documented no-op. It only
-- does real work in the hypothetical case P0-3 is ever reverted without
-- this file also being reverted.
-- A database bootstrapped from migrations alone (a fresh Supabase project,
-- CI, `db reset`) has NO cascade path for this table at all — which matters
-- for GDPR erasure specifically, because account deletion relies on
-- `ON DELETE CASCADE` from `auth.users` through `lectures` to clean up
-- everything derived from a user's uploads. On the live project the legacy
-- script's `lecture_id UUID REFERENCES lectures(id) ON DELETE CASCADE` is
-- presumably already in place; this migration makes that guarantee real for
-- every environment, including ones that only ever ran `supabase/
-- migrations/`.
--
-- Sequencing note: this migration is dated/named to sort immediately BEFORE
-- `20260501000001_fix_cache_rls.sql`, the first existing migration that
-- assumes `slide_embeddings` already exists (it ALTERs its RLS policies),
-- and before `20260502000001_slide_parse_cache.sql`, which ALTERs the table
-- to add `pipeline_version` and an index on `(pdf_hash, pipeline_version)`.
-- Both currently only work on a database that ran the legacy script (or the
-- nightly test suite's bootstrap stub, `backend/tests/db/sql/00_bootstrap.sql`)
-- first — on a migrations-only bootstrap without this file they fail
-- outright. This migration is authored later (S-2 pass) but slotted here so
-- migration order matches dependency order, which is what makes
-- `supabase db reset` reproducible.
--
-- Written defensively (ADD COLUMN IF NOT EXISTS + a guarded ADD CONSTRAINT,
-- not a bare CREATE TABLE) because `slide_embeddings` may already exist —
-- with a DIFFERENT shape and no FK — from either the legacy script or the
-- test bootstrap's stub (which deliberately omits the FK, since it runs
-- before `lectures` exists). Postgres has no `ADD CONSTRAINT IF NOT EXISTS`
-- syntax, hence the `DO $$ ... $$` guard on `pg_constraint`.
--
-- Deliberately does NOT touch existing GRANT/RLS-policy posture on this
-- table (the bootstrap/legacy-script default privileges already give it
-- some anon/authenticated exposure) — auditing and correcting that
-- particular exposure belongs to S-1's systematic RPC/table exposure pass,
-- not this GDPR-cascade fix, so as not to conflate two different findings
-- in one migration.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.slide_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);

ALTER TABLE public.slide_embeddings
    ADD COLUMN IF NOT EXISTS lecture_id UUID,
    ADD COLUMN IF NOT EXISTS slide_index INT,
    ADD COLUMN IF NOT EXISTS embedding vector(768),
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS pdf_hash TEXT,
    ADD COLUMN IF NOT EXISTS content_hash TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- slide_index has always been logically required (see the legacy script);
-- backfill any pre-existing NULLs to 0 before enforcing NOT NULL so this
-- migration never fails against real data.
UPDATE public.slide_embeddings SET slide_index = 0 WHERE slide_index IS NULL;
ALTER TABLE public.slide_embeddings ALTER COLUMN slide_index SET NOT NULL;

CREATE INDEX IF NOT EXISTS slide_embeddings_vector_idx
    ON public.slide_embeddings USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX IF NOT EXISTS slide_embeddings_lecture_id_idx
    ON public.slide_embeddings(lecture_id);

-- The actual GDPR-cascade fix: add the FK to lectures with ON DELETE
-- CASCADE if it isn't already present under any name.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'slide_embeddings'
          AND c.contype = 'f'
          AND c.confrelid = 'public.lectures'::regclass
    ) THEN
        ALTER TABLE public.slide_embeddings
            ADD CONSTRAINT slide_embeddings_lecture_id_fkey
            FOREIGN KEY (lecture_id) REFERENCES public.lectures(id) ON DELETE CASCADE;
    END IF;
END
$$;

ALTER TABLE public.slide_embeddings ENABLE ROW LEVEL SECURITY;
