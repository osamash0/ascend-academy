-- Migration to add archiving capabilities to courses and lectures.
-- Adding is_archived BOOLEAN column to track archived status.
-- By default, all existing rows are set to true to clean up the deployment database
-- and make the workspace fresh, while keeping files and metadata in the archive.

-- 1. Add columns to public.courses
ALTER TABLE public.courses
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE NOT NULL;

-- 2. Add columns to public.lectures
ALTER TABLE public.lectures
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE NOT NULL;

-- 3. Add indexes for high performance querying
CREATE INDEX IF NOT EXISTS courses_is_archived_idx ON public.courses(is_archived);
CREATE INDEX IF NOT EXISTS lectures_is_archived_idx ON public.lectures(is_archived);

-- 4. Mark all currently existing courses and lectures as archived
UPDATE public.courses SET is_archived = TRUE;
UPDATE public.lectures SET is_archived = TRUE;
