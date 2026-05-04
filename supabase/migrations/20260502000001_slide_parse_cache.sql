-- Per-slide output cache for checkpoint/resume during PDF parsing.
-- Stores the full slide result so a timed-out pipeline can resume without re-processing.

CREATE TABLE IF NOT EXISTS slide_parse_cache (
    pdf_hash         TEXT NOT NULL,
    slide_index      INT  NOT NULL,
    pipeline_version TEXT NOT NULL DEFAULT '1',
    slide_data       JSONB NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (pdf_hash, slide_index, pipeline_version)
);

CREATE INDEX IF NOT EXISTS idx_slide_parse_cache_hash_version
    ON slide_parse_cache(pdf_hash, pipeline_version);

-- RLS: backend-only cache table, permissive policies (same pattern as pdf_parse_cache)
ALTER TABLE slide_parse_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public select on slide_parse_cache"
    ON slide_parse_cache FOR SELECT USING (true);

CREATE POLICY "Allow public insert on slide_parse_cache"
    ON slide_parse_cache FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update on slide_parse_cache"
    ON slide_parse_cache FOR UPDATE USING (true) WITH CHECK (true);

-- Add pipeline_version as a top-level indexed column to slide_embeddings.
-- Existing rows default to '1' (old pipeline), which will not match the new
-- PIPELINE_VERSION = "2", so stale checkpoints are automatically excluded.
ALTER TABLE slide_embeddings
    ADD COLUMN IF NOT EXISTS pipeline_version TEXT DEFAULT '1';

CREATE INDEX IF NOT EXISTS idx_slide_embeddings_version
    ON slide_embeddings(pdf_hash, pipeline_version);
