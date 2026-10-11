-- Exam rehearsal history for the v4 reader (real courses).
--
-- One row per finished rehearsal: the score and, per question, which idea on
-- which page of which lecture it tested and whether it was answered right.
-- That is enough to show a learner their history and the ideas they keep
-- missing, and nothing more — no answers, no free text from the learner.
--
-- Additive only: one new table, nothing existing is altered. Writes go through
-- the backend (`/api/v1/v4/reader/courses/{id}/rehearsals`), which validates
-- them; clients may only read their own rows.

CREATE TABLE IF NOT EXISTS public.v4_rehearsal_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(title) <= 120),
  lecture_ids uuid[] NOT NULL CHECK (cardinality(lecture_ids) BETWEEN 1 AND 12),
  score       integer NOT NULL CHECK (score >= 0),
  total       integer NOT NULL CHECK (total BETWEEN 1 AND 20 AND score <= total),
  -- [{"lecture_id": uuid, "page": int, "idea": text, "kind": text, "correct": bool}, ...]
  results     jsonb NOT NULL CHECK (jsonb_typeof(results) = 'array'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS v4_rehearsal_attempts_user_course_idx
  ON public.v4_rehearsal_attempts (user_id, course_id, created_at DESC);

ALTER TABLE public.v4_rehearsal_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.v4_rehearsal_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v4_rehearsal_attempts TO authenticated;

DROP POLICY IF EXISTS v4_rehearsal_attempts_read_own ON public.v4_rehearsal_attempts;
CREATE POLICY v4_rehearsal_attempts_read_own ON public.v4_rehearsal_attempts
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
