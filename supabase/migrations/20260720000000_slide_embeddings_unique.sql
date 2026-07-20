-- Add composite unique constraint to support atomic upserts
ALTER TABLE public.slide_embeddings
ADD CONSTRAINT uq_slide_embeddings_upsert UNIQUE (pdf_hash, slide_index, pipeline_version);
