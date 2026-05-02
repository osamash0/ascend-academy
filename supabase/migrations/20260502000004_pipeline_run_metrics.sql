-- Routing telemetry: one row per parse run summarising route counts and
-- fallback counters.  Inserted fire-and-forget at deck finalize so a
-- telemetry write never blocks the parse stream.
--
-- Backend-only RLS, same pattern as slide_parse_cache: SELECT/INSERT
-- gated to the service role since the row is written by the parse
-- service and only ever read by the diagnostics endpoint (which runs
-- under supabase_admin and enforces ownership in app code).

CREATE TABLE IF NOT EXISTS pipeline_run_metrics (
    pdf_hash         TEXT NOT NULL,
    pipeline_version TEXT NOT NULL DEFAULT '1',
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ,
    totals           JSONB NOT NULL DEFAULT '{}'::jsonb,
    fallbacks        JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (pdf_hash, pipeline_version, started_at)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_run_metrics_hash_version
    ON pipeline_run_metrics(pdf_hash, pipeline_version, started_at DESC);

ALTER TABLE pipeline_run_metrics ENABLE ROW LEVEL SECURITY;

-- Backend-only: anon/authenticated have no policies → no access.
-- supabase_admin bypasses RLS so the parse service and diagnostics
-- endpoint can read/write freely.
CREATE POLICY "service role only select on pipeline_run_metrics"
    ON pipeline_run_metrics FOR SELECT
    TO service_role USING (true);

CREATE POLICY "service role only insert on pipeline_run_metrics"
    ON pipeline_run_metrics FOR INSERT
    TO service_role WITH CHECK (true);
