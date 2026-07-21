-- P3-3 (docs/ROADMAP_10X_FOUNDATION.md §8): real upsert constraint + HNSW index
-- for `slide_embeddings`.
--
-- Before this migration, `slide_embeddings` had no unique constraint on the
-- triple the application treats as its logical key, so `cache.py`'s
-- `store_slide_embedding` emulated an upsert with an explicit
-- delete-then-insert (see that function's docstring, written when the table
-- was promoted in 20260430120000). That's racy under concurrent parses of
-- the same PDF (two writers can both pass the delete and both insert,
-- leaving duplicate rows) and churns dead tuples under the vector index on
-- every re-parse, degrading ivfflat recall over time.
--
-- Two changes:
--
-- 1. UNIQUE(pdf_hash, slide_index, pipeline_version) — the key
--    `store_slide_embedding` already treats as authoritative. `pdf_hash` is
--    nullable (rows can be written before a lecture_id/pdf_hash link is
--    fully established); Postgres treats NULLs as distinct for uniqueness
--    purposes, so this constraint never rejects legitimate NULL-pdf_hash
--    rows — it only enforces idempotency for the (pdf_hash IS NOT NULL) case
--    that `store_slide_embedding`'s delete-then-insert branch already
--    exists to protect.
--
--    Deploy-safety note for prod (not needed here — this migration chain
--    only ever runs against an empty/fresh database, so there is nothing to
--    violate yet): a real prod backfill of this migration MUST run a dedup
--    pass first, e.g.
--        DELETE FROM slide_embeddings a USING slide_embeddings b
--        WHERE a.id < b.id
--          AND a.pdf_hash = b.pdf_hash
--          AND a.slide_index = b.slide_index
--          AND a.pipeline_version = b.pipeline_version
--          AND a.pdf_hash IS NOT NULL;
--    before `ADD CONSTRAINT`, or the `ALTER TABLE` below fails outright on
--    any duplicates the old delete-then-insert race already produced.
--
-- 2. Replace the ivfflat vector index with hnsw (embedding vector_cosine_ops).
--    ivfflat's recall degrades as the table outgrows the `lists` value it
--    was built with, and rebuilding to keep pace needs a periodic REINDEX
--    with data already loaded. hnsw builds incrementally, needs no `lists`
--    tuning, and its default build parameters (m=16, ef_construction=64)
--    are adequate at current and near-term corpus size — revisit only if a
--    future 10x-scale benchmark (deferred; see roadmap acceptance criteria)
--    shows otherwise.

-- Safe re-run: only add the constraint if it isn't already there.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'slide_embeddings_pdf_hash_slide_index_pipeline_version_key'
    ) THEN
        ALTER TABLE public.slide_embeddings
            ADD CONSTRAINT slide_embeddings_pdf_hash_slide_index_pipeline_version_key
            UNIQUE (pdf_hash, slide_index, pipeline_version);
    END IF;
END
$$;

DROP INDEX IF EXISTS public.slide_embeddings_vector_idx;

CREATE INDEX IF NOT EXISTS slide_embeddings_vector_idx
    ON public.slide_embeddings USING hnsw (embedding vector_cosine_ops);
