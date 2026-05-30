-- Migration to add columns from Document-Insight-Engine
-- These are added as nullable to not break existing functionality.

-- Add columns to lectures table
ALTER TABLE public.lectures 
ADD COLUMN IF NOT EXISTS lecture_type TEXT,
ADD COLUMN IF NOT EXISTS subject TEXT,
ADD COLUMN IF NOT EXISTS course_code TEXT,
ADD COLUMN IF NOT EXISTS key_topics JSONB;

-- Add columns to slides table
ALTER TABLE public.slides 
ADD COLUMN IF NOT EXISTS slide_type TEXT,
ADD COLUMN IF NOT EXISTS context_note TEXT;
