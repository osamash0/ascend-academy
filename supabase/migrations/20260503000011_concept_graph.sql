-- ─────────────────────────────────────────────────────────────────────────────
-- Cross-course knowledge graph (Task #33)
--
-- Persists a canonical concept catalog that spans every lecture and course.
-- `concepts` holds dedupe targets keyed by an embedding; `concept_lectures`
-- links concepts to the lectures (and slides within them) that touch them;
-- `concept_mastery` is a per-user cache of mastery score per concept.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Canonical concepts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.concepts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name  TEXT NOT NULL,
    name_key        TEXT NOT NULL UNIQUE,           -- lower(canonical_name) for fast dedupe
    aliases         TEXT[] NOT NULL DEFAULT '{}',   -- raw concept-tag strings observed in lectures
    embedding       vector(768),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS concepts_embedding_idx
    ON public.concepts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

CREATE INDEX IF NOT EXISTS concepts_aliases_gin
    ON public.concepts USING gin (aliases);

-- ── Concept ↔ lecture link table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.concept_lectures (
    concept_id      UUID NOT NULL REFERENCES public.concepts(id) ON DELETE CASCADE,
    lecture_id      UUID NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
    slide_indices   INT[] NOT NULL DEFAULT '{}',
    weight          REAL NOT NULL DEFAULT 1.0,      -- # of questions/slides touching it
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (concept_id, lecture_id)
);

CREATE INDEX IF NOT EXISTS concept_lectures_lecture_idx
    ON public.concept_lectures(lecture_id);

CREATE INDEX IF NOT EXISTS concept_lectures_concept_idx
    ON public.concept_lectures(concept_id);

-- ── Per-user mastery cache ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.concept_mastery (
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    concept_id      UUID NOT NULL REFERENCES public.concepts(id) ON DELETE CASCADE,
    attempts        INT NOT NULL DEFAULT 0,
    correct         INT NOT NULL DEFAULT 0,
    mastery_score   REAL NOT NULL DEFAULT 0.0,      -- 0..1, Laplace-smoothed
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, concept_id)
);

CREATE INDEX IF NOT EXISTS concept_mastery_user_idx
    ON public.concept_mastery(user_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.concepts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concept_lectures  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concept_mastery   ENABLE ROW LEVEL SECURITY;

-- Concept catalog is public (read-only) to authenticated users.  Writes are
-- restricted to the service role used by the backend ingestion service.
CREATE POLICY "Authenticated read concepts"
    ON public.concepts FOR SELECT
    TO authenticated USING (true);

CREATE POLICY "Authenticated read concept_lectures"
    ON public.concept_lectures FOR SELECT
    TO authenticated USING (true);

-- Mastery rows are scoped strictly to the owning user.  Professors don't
-- need cross-user mastery here — they have analytics endpoints for that.
CREATE POLICY "Users read own mastery"
    ON public.concept_mastery FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users upsert own mastery"
    ON public.concept_mastery FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own mastery"
    ON public.concept_mastery FOR UPDATE
    USING (auth.uid() = user_id);

-- ── Cosine-similarity RPC for dedupe lookup ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_concepts(
    query_embedding vector(768),
    match_threshold float,
    match_count int
)
RETURNS TABLE (
    id          uuid,
    canonical_name text,
    name_key    text,
    similarity  float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.canonical_name,
        c.name_key,
        1 - (c.embedding <=> query_embedding) AS similarity
    FROM public.concepts c
    WHERE c.embedding IS NOT NULL
      AND 1 - (c.embedding <=> query_embedding) > match_threshold
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
