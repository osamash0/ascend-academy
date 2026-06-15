-- Add owner column to parse_runs table to fix IDOR
ALTER TABLE public.parse_runs
ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Backfill or set default? It's fine to leave existing rows with NULL if we don't care, 
-- but we should protect future accesses.

CREATE INDEX IF NOT EXISTS idx_parse_runs_user_id ON public.parse_runs(user_id);
