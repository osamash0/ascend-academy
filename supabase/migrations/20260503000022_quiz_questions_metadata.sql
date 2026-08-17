-- Add metadata column to quiz_questions for storing per-question enrichment
-- (concept tag, cognitive level, explanation) written by the AI content pipeline.
ALTER TABLE public.quiz_questions
  ADD COLUMN IF NOT EXISTS metadata JSONB;
