-- Granular slide-level progress tracking
--
-- Replaces the blunt `completed_slides INTEGER[]` with a JSONB map that
-- carries four states per slide:
--
--   "visited"  — student explicitly navigated through this slide
--   "skipped"  — student jumped past it (gap in forward navigation)
--   "current"  — the slide they are on right now (at most one per row)
--   absent key — unvisited (not stored to keep the map compact)
--
-- The legacy `completed_slides` column is kept and kept in sync for backward
-- compatibility with analytics queries that still reference it.
--
-- Completion % = visited_count / total_slides   (skipped ≠ visited)

ALTER TABLE public.student_progress
  ADD COLUMN IF NOT EXISTS slide_states JSONB NOT NULL DEFAULT '{}';

-- updated_at (may already exist from a prior migration; ADD IF NOT EXISTS is safe)
ALTER TABLE public.student_progress
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Auto-touch updated_at on every write
CREATE OR REPLACE FUNCTION public.touch_student_progress_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS student_progress_touch_updated_at
  ON public.student_progress;

CREATE TRIGGER student_progress_touch_updated_at
  BEFORE UPDATE ON public.student_progress
  FOR EACH ROW EXECUTE FUNCTION public.touch_student_progress_updated_at();

-- Index makes "find all lectures with recent activity" queries fast
-- (used by the dashboard recency feed).
CREATE INDEX IF NOT EXISTS student_progress_user_updated_idx
  ON public.student_progress(user_id, updated_at DESC);
