-- Preserve the latest unfinished material batch so students can resume the
-- editable course proposal after closing the browser or following a toast.
ALTER TABLE public.onboarding_progress
  ADD COLUMN IF NOT EXISTS active_batch_id UUID;
