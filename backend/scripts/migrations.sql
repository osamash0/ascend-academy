-- Master Migration: Setup all required tables and functions for PDF Parsing & Analytics
-- This script is idempotent (can be run multiple times safely)

-- 0. Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Create base slide_embeddings table if it doesn't exist
CREATE TABLE IF NOT EXISTS slide_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lecture_id UUID REFERENCES lectures(id) ON DELETE CASCADE,
    slide_index INT NOT NULL,
    embedding vector(768),
    metadata JSONB DEFAULT '{}'::jsonb,
    content_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Ensure pdf_hash column exists (for semantic routing before lecture creation)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='slide_embeddings' AND column_name='pdf_hash') THEN
        ALTER TABLE slide_embeddings ADD COLUMN pdf_hash TEXT;
    END IF;
END $$;

-- 3. Create/Update match_slides RPC to return pdf_hash
CREATE OR REPLACE FUNCTION match_slides (
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
  FROM slide_embeddings se
  WHERE 1 - (se.embedding <=> query_embedding) > match_threshold
  ORDER BY se.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 4. Create persistent parse result cache
CREATE TABLE IF NOT EXISTS pdf_parse_cache (
    pdf_hash TEXT PRIMARY KEY,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ
);

-- 5. Create table for pedagogical blueprints
CREATE TABLE IF NOT EXISTS lecture_blueprints (
    pdf_hash TEXT PRIMARY KEY,
    blueprint_json JSONB NOT NULL,
    version INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Ensure index for vector search exists
CREATE INDEX IF NOT EXISTS slide_embeddings_vector_idx ON slide_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
