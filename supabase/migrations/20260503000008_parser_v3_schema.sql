-- Parser v3 schema migration — rollout step 1 of the clean-slate pipeline
-- documented in project_docs/parser_v3_architecture.md.
--
-- Adds the four tables that back the v3 pipeline:
--   parse_runs      — run-level state machine (one row per (pdf_hash, version))
--   parse_pages     — per-slide checkpoint (one row = one transaction, P2)
--   slide_chunks    — grounded-tutor retrieval store (pgvector, P5)
--   tutor_messages  — Socratic tutor conversation log
--
-- This migration is intentionally additive: no existing tables are dropped or
-- altered. The v2 pipeline (file_parse_service + slide_parse_cache +
-- pdf_parse_cache) keeps running unchanged until the rest of the v3 rollout
-- lands and the feature flag is flipped.
--
-- RLS pattern: backend-only (service_role full access; anon/authenticated have
-- no policies → no access), matching pipeline_run_metrics. tutor_messages
-- additionally exposes per-student SELECT/INSERT scoped by auth.uid().

-- ── pgvector ────────────────────────────────────────────────────────────────
-- IF NOT EXISTS so re-running the migration is a no-op once the extension is
-- registered. Supabase ships pgvector in every project; the nightly db test
-- harness uses the pgvector/pgvector:pg15 container image.
CREATE EXTENSION IF NOT EXISTS vector;


-- ── parse_runs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parse_runs (
    run_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pdf_hash         TEXT NOT NULL,
    lecture_id       UUID REFERENCES public.lectures(id) ON DELETE CASCADE,
    pipeline_version TEXT NOT NULL,
    status           TEXT NOT NULL,
    page_count       INT,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ,
    outline          JSONB,
    error            TEXT,
    UNIQUE (pdf_hash, pipeline_version)
);

CREATE INDEX IF NOT EXISTS idx_parse_runs_lecture
    ON public.parse_runs(lecture_id);

ALTER TABLE public.parse_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role select on parse_runs" ON public.parse_runs;
CREATE POLICY "service role select on parse_runs"
    ON public.parse_runs FOR SELECT
    TO service_role USING (true);

DROP POLICY IF EXISTS "service role insert on parse_runs" ON public.parse_runs;
CREATE POLICY "service role insert on parse_runs"
    ON public.parse_runs FOR INSERT
    TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "service role update on parse_runs" ON public.parse_runs;
CREATE POLICY "service role update on parse_runs"
    ON public.parse_runs FOR UPDATE
    TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service role delete on parse_runs" ON public.parse_runs;
CREATE POLICY "service role delete on parse_runs"
    ON public.parse_runs FOR DELETE
    TO service_role USING (true);


-- ── parse_pages ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parse_pages (
    run_id      UUID NOT NULL REFERENCES public.parse_runs(run_id) ON DELETE CASCADE,
    page_index  INT  NOT NULL,
    status      TEXT NOT NULL,
    route       TEXT,
    extract     JSONB,
    content     JSONB,
    image_url   TEXT,
    error       TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, page_index)
);

CREATE INDEX IF NOT EXISTS idx_parse_pages_status
    ON public.parse_pages(run_id, status);

ALTER TABLE public.parse_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role select on parse_pages" ON public.parse_pages;
CREATE POLICY "service role select on parse_pages"
    ON public.parse_pages FOR SELECT
    TO service_role USING (true);

DROP POLICY IF EXISTS "service role insert on parse_pages" ON public.parse_pages;
CREATE POLICY "service role insert on parse_pages"
    ON public.parse_pages FOR INSERT
    TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "service role update on parse_pages" ON public.parse_pages;
CREATE POLICY "service role update on parse_pages"
    ON public.parse_pages FOR UPDATE
    TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service role delete on parse_pages" ON public.parse_pages;
CREATE POLICY "service role delete on parse_pages"
    ON public.parse_pages FOR DELETE
    TO service_role USING (true);


-- ── slide_chunks ────────────────────────────────────────────────────────────
-- One retrievable unit for the grounded tutor. Embeddings are written by
-- Stage 6 (FastEmbed bge-small, 384-d). The IVFFlat cosine index is the
-- production retrieval path; lists=100 is a reasonable starting value for
-- the expected order of ~10k–100k chunks across all lectures.
CREATE TABLE IF NOT EXISTS public.slide_chunks (
    id               BIGSERIAL PRIMARY KEY,
    lecture_id       UUID NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
    page_index       INT  NOT NULL,
    chunk_index      INT  NOT NULL,
    text             TEXT NOT NULL,
    section          TEXT,
    embedding        vector(384),
    pipeline_version TEXT NOT NULL,
    UNIQUE (lecture_id, page_index, chunk_index, pipeline_version)
);

CREATE INDEX IF NOT EXISTS idx_slide_chunks_lecture
    ON public.slide_chunks(lecture_id);

CREATE INDEX IF NOT EXISTS idx_slide_chunks_vec
    ON public.slide_chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

ALTER TABLE public.slide_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role select on slide_chunks" ON public.slide_chunks;
CREATE POLICY "service role select on slide_chunks"
    ON public.slide_chunks FOR SELECT
    TO service_role USING (true);

DROP POLICY IF EXISTS "service role insert on slide_chunks" ON public.slide_chunks;
CREATE POLICY "service role insert on slide_chunks"
    ON public.slide_chunks FOR INSERT
    TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "service role update on slide_chunks" ON public.slide_chunks;
CREATE POLICY "service role update on slide_chunks"
    ON public.slide_chunks FOR UPDATE
    TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service role delete on slide_chunks" ON public.slide_chunks;
CREATE POLICY "service role delete on slide_chunks"
    ON public.slide_chunks FOR DELETE
    TO service_role USING (true);


-- ── tutor_messages ──────────────────────────────────────────────────────────
-- Conversation memory for the grounded Socratic tutor. Two policy layers:
--   • service_role: full access (the tutor backend writes both sides)
--   • authenticated: per-row SELECT/INSERT scoped to auth.uid() so a student
--     can read their own session and (via the client) post their own messages
CREATE TABLE IF NOT EXISTS public.tutor_messages (
    id          BIGSERIAL PRIMARY KEY,
    lecture_id  UUID NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('student','tutor')),
    content     TEXT NOT NULL,
    cited_pages INT[] DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tutor_msgs_session
    ON public.tutor_messages(lecture_id, user_id, created_at);

ALTER TABLE public.tutor_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "students read own tutor messages" ON public.tutor_messages;
CREATE POLICY "students read own tutor messages"
    ON public.tutor_messages FOR SELECT
    TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "students insert own tutor messages" ON public.tutor_messages;
CREATE POLICY "students insert own tutor messages"
    ON public.tutor_messages FOR INSERT
    TO authenticated WITH CHECK (auth.uid() = user_id AND role = 'student');

DROP POLICY IF EXISTS "service role select on tutor_messages" ON public.tutor_messages;
CREATE POLICY "service role select on tutor_messages"
    ON public.tutor_messages FOR SELECT
    TO service_role USING (true);

DROP POLICY IF EXISTS "service role insert on tutor_messages" ON public.tutor_messages;
CREATE POLICY "service role insert on tutor_messages"
    ON public.tutor_messages FOR INSERT
    TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "service role update on tutor_messages" ON public.tutor_messages;
CREATE POLICY "service role update on tutor_messages"
    ON public.tutor_messages FOR UPDATE
    TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service role delete on tutor_messages" ON public.tutor_messages;
CREATE POLICY "service role delete on tutor_messages"
    ON public.tutor_messages FOR DELETE
    TO service_role USING (true);
