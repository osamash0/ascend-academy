-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Slide Embeddings Table for Semantic Cache and Intelligent Routing
CREATE TABLE IF NOT EXISTS slide_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lecture_id UUID REFERENCES lectures(id) ON DELETE CASCADE,
    slide_index INT NOT NULL,
    embedding vector(768), -- Adjusted to text-embedding-004 default
    metadata JSONB DEFAULT '{}'::jsonb, -- {slide_type, vision_used, parse_success, tokens, model}
    content_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for faster cosine similarity search
CREATE INDEX IF NOT EXISTS slide_embeddings_vector_idx ON slide_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Table to store narrative blueprints separately for easier querying
CREATE TABLE IF NOT EXISTS lecture_blueprints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pdf_hash TEXT UNIQUE NOT NULL,
    blueprint_json JSONB NOT NULL,
    version INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RPC for Cosine Similarity Search
CREATE OR REPLACE FUNCTION match_slides (
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  lecture_id uuid,
  slide_index int,
  metadata jsonb,
  content_hash text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    se.id,
    se.lecture_id,
    se.slide_index,
    se.metadata,
    se.content_hash,
    1 - (se.embedding <=> query_embedding) AS similarity
  FROM slide_embeddings se
  WHERE 1 - (se.embedding <=> query_embedding) > match_threshold
  ORDER BY se.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
