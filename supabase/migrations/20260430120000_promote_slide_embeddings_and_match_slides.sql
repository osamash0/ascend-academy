-- Reproducibility fix (P0-3, docs/ROADMAP_10X_FOUNDATION.md §5): promote the
-- `slide_embeddings` table, `pdf_parse_cache` table, and `match_slides` RPC —
-- the backbone of the tutor/RAG retrieval path — from un-versioned scripts
-- into a real migration.
--
-- Before this, these three objects existed ONLY in `backend/scripts/
-- slide_embeddings.sql` and `backend/scripts/migrations.sql`, applied by hand
-- against the live project at some point, never captured here. Every later
-- real migration that touches these tables assumes they already exist
-- (`ALTER TABLE IF EXISTS slide_embeddings ...` in 20260501000001,
-- `ALTER TABLE slide_embeddings ADD COLUMN ... pipeline_version` in
-- 20260502000001, `CREATE OR REPLACE FUNCTION match_slides` in
-- 20260710030000's comments referencing it) — so `supabase db reset` from
-- migrations alone left the entire tutor/RAG path broken (missing table +
-- missing RPC). Placed at this early timestamp (right after
-- 20260430_lecture_blueprints.sql, before the 20260501/20260502 cache-RLS
-- and pipeline-version chain that already assumes these objects exist) so
-- migration order is preserved exactly as it has always run in practice.
--
-- The two script copies had also drifted into incompatible `match_slides`
-- contracts — one returns `pdf_hash`, one doesn't. `backend/services/ai/
-- retrieval.py` filters candidates on `r.get("pdf_hash")`
-- (`store_slide_embedding` in cache.py writes `pdf_hash`, and
-- `attach_lecture_id_to_embeddings` scopes its backfill by it too) — this is
-- the version actually relied upon, confirmed against real usage, not
-- guessed. `lecture_blueprints` appears in both scripts too, but is NOT
-- included here — it's already fully covered by two real migrations
-- (20260430_lecture_blueprints.sql, 20260506000002_lecture_blueprints_
-- composite_key.sql); the script copies of it are dead, superseded
-- duplicates, deleted alongside the scripts themselves in this change.
--
-- `pdf_parse_cache`'s shape here matches actual usage in
-- backend/services/cache.py (`get_cached_parse`/`store_cached_parse`: reads
-- and writes only `pdf_hash`, `result`, `created_at`) rather than either
-- script's version verbatim — `slide_embeddings.sql` didn't define this
-- table at all, and `migrations.sql`'s version additionally declared an
-- `expires_at` column that no code anywhere reads or writes; omitted as
-- dead weight rather than perpetuated.
--
-- RLS is deliberately NOT set up here: 20260501000001_fix_cache_rls.sql (the
-- very next migration chronologically) already enables it and adds policies
-- for both tables, later tightened to service-role-only by
-- 20260503000001_fix_cache_rls_backend_only.sql — that existing, correct
-- chain is left untouched and will apply immediately after this one, exactly
-- as it always has.
--
-- One deliberate, minimal hardening addition beyond a literal promotion:
-- `match_slides` gets `SET search_path = public` (it had none in either
-- script), closing the Supabase `function_search_path_mutable` lint
-- (docs/ROADMAP_10X_FOUNDATION.md §5, S-1) for the first time this function
-- is captured in version control. No other behavioral change — security
-- posture (SECURITY INVOKER, as both scripts had it) and the query itself
-- are otherwise unchanged.

CREATE EXTENSION IF NOT EXISTS vector;

-- ── slide_embeddings ─────────────────────────────────────────────────────────
-- No unique constraint on (pdf_hash, slide_index, pipeline_version): the
-- live write path (cache.py's store_slide_embedding) already works around
-- that absence with an explicit delete-then-insert and says so in its own
-- docstring. Adding the constraint + switching to a native upsert is a
-- separate, larger fix (roadmap P3-3) — out of scope for this promotion,
-- which only captures the schema exactly as it already behaves in
-- production, not a new behavior.

CREATE TABLE IF NOT EXISTS public.slide_embeddings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lecture_id       UUID REFERENCES public.lectures(id) ON DELETE CASCADE,
    pdf_hash         TEXT,
    slide_index      INT NOT NULL,
    embedding        vector(768),
    metadata         JSONB DEFAULT '{}'::jsonb,
    content_hash     TEXT,
    pipeline_version TEXT DEFAULT '1',
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS slide_embeddings_vector_idx
    ON public.slide_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── pdf_parse_cache ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pdf_parse_cache (
    pdf_hash    TEXT PRIMARY KEY,
    result      JSONB NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── match_slides ─────────────────────────────────────────────────────────────
-- The pdf_hash-returning contract — confirmed as the one real code depends
-- on (see header comment). This is the single canonical definition going
-- forward; the divergent non-pdf_hash version never existed here.

CREATE OR REPLACE FUNCTION public.match_slides (
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  lecture_id uuid,
  pdf_hash text,
  slide_index int,
  metadata jsonb,
  content_hash text,
  similarity float
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    se.id,
    se.lecture_id,
    se.pdf_hash,
    se.slide_index,
    se.metadata,
    se.content_hash,
    1 - (se.embedding <=> query_embedding) AS similarity
  FROM public.slide_embeddings se
  WHERE 1 - (se.embedding <=> query_embedding) > match_threshold
  ORDER BY se.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
