-- ─────────────────────────────────────────────────────────────────────────────
-- Notes: private writing, anchored to a Lesson (v4).
--
-- Doc 2 rule 5: "A Note is private, appears nowhere else, and is the object
-- you are most likely to want across Spaces at once." Until now v4 kept notes
-- in an in-memory fixture store, so a note written in the live reader was
-- gone on reload.
--
-- A note outlives its anchor: deleting the lecture or the course nulls the
-- link (ON DELETE SET NULL) and the note keeps the names it was written
-- under, because losing the anchor must not lose the writing. Deleting the
-- account deletes the notes (CASCADE) — they are the author's and nobody
-- else's.
--
-- The backend reads and writes through the service role, checking ownership
-- itself; RLS is the second wall, owner-only. Supabase grants new tables to
-- anon/authenticated directly, so anon is revoked explicitly.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lecture_id   UUID REFERENCES public.lectures(id) ON DELETE SET NULL,
  course_id    UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  -- The names it was written under, for when the anchor is gone.
  lesson_title TEXT NOT NULL DEFAULT '',
  space_name   TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 20000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notes_user_updated_idx ON public.notes (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS notes_lecture_idx ON public.notes (lecture_id);

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Notes are their author's" ON public.notes;
CREATE POLICY "Notes are their author's" ON public.notes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.notes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO authenticated;
GRANT ALL ON public.notes TO service_role;
