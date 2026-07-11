-- Phase 1 (course-at-once ingestion): group parse_runs into batches and thread
-- course assignment through to the server-authoritative parse job, closing the
-- gap where course assignment only happened client-side after parsing.
ALTER TABLE public.parse_runs
    ADD COLUMN IF NOT EXISTS batch_id UUID NULL,
    ADD COLUMN IF NOT EXISTS course_id UUID NULL REFERENCES public.courses(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS filename TEXT NULL,
    -- Persisted so a retry (no re-upload of bytes) reproduces the original
    -- request faithfully instead of always defaulting to full AI synthesis.
    ADD COLUMN IF NOT EXISTS parsing_mode TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_parse_runs_batch ON public.parse_runs(batch_id);
CREATE INDEX IF NOT EXISTS idx_parse_runs_user_status ON public.parse_runs(user_id, status);
