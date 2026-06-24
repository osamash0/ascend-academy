-- Add generated full-text search column to slides
ALTER TABLE public.slides
ADD COLUMN IF NOT EXISTS fts tsvector
GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content_text, '')), 'C')
) STORED;

-- Index the fts column for fast BM25 queries
CREATE INDEX IF NOT EXISTS slides_fts_idx ON public.slides USING GIN (fts);

-- Create the Hybrid Search RPC
CREATE OR REPLACE FUNCTION hybrid_search_slides(
    query_text TEXT,
    query_embedding VECTOR(768),
    match_count INT DEFAULT 5,
    rrf_k INT DEFAULT 60
) RETURNS TABLE (
    id UUID,
    lecture_id UUID,
    pdf_hash TEXT,
    slide_index INT,
    metadata JSONB,
    content_hash TEXT,
    similarity FLOAT
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    WITH semantic_search AS (
        SELECT 
            se.id,
            se.lecture_id,
            se.pdf_hash,
            se.slide_index,
            se.metadata,
            se.content_hash,
            1 - (se.embedding <=> query_embedding) AS similarity,
            RANK() OVER (ORDER BY se.embedding <=> query_embedding) AS rank
        FROM public.slide_embeddings se
        ORDER BY se.embedding <=> query_embedding
        LIMIT match_count * 2
    ),
    text_search AS (
        SELECT 
            se.id,
            se.lecture_id,
            se.pdf_hash,
            se.slide_index,
            se.metadata,
            se.content_hash,
            1 - (se.embedding <=> query_embedding) AS similarity,
            RANK() OVER (ORDER BY ts_rank(s.fts, websearch_to_tsquery('english', query_text)) DESC) AS rank
        FROM public.slides s
        JOIN public.slide_embeddings se 
          ON s.lecture_id = se.lecture_id AND (s.slide_number - 1) = se.slide_index
        WHERE s.fts @@ websearch_to_tsquery('english', query_text)
        ORDER BY ts_rank(s.fts, websearch_to_tsquery('english', query_text)) DESC
        LIMIT match_count * 2
    ),
    full_outer_join AS (
        SELECT 
            COALESCE(ss.id, ts.id) AS id,
            COALESCE(ss.lecture_id, ts.lecture_id) AS lecture_id,
            COALESCE(ss.pdf_hash, ts.pdf_hash) AS pdf_hash,
            COALESCE(ss.slide_index, ts.slide_index) AS slide_index,
            COALESCE(ss.metadata, ts.metadata) AS metadata,
            COALESCE(ss.content_hash, ts.content_hash) AS content_hash,
            COALESCE(ss.similarity, ts.similarity) AS similarity,
            COALESCE(1.0 / (rrf_k + ss.rank), 0.0) + 
            COALESCE(1.0 / (rrf_k + ts.rank), 0.0) AS rrf_score
        FROM semantic_search ss
        FULL OUTER JOIN text_search ts ON ss.id = ts.id
    )
    SELECT 
        fj.id,
        fj.lecture_id,
        fj.pdf_hash,
        fj.slide_index,
        fj.metadata,
        fj.content_hash,
        fj.similarity
    FROM full_outer_join fj
    ORDER BY fj.rrf_score DESC
    LIMIT match_count;
END;
$$;
