-- supabase/migrations/20261025000000_luna_sessions.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Luna study sessions (spec: docs/superpowers/specs/2026-10-24-luna-study-sessions-design.md).
--
-- A session is a learner studying one Lesson with Luna: a plan, the turns,
-- a wrap-up. learner_memory is the short list of what Luna knows about how
-- this person learns. Practice made from a session becomes review_cards with
-- an owner, visible to that owner only.
--
-- The backend reads and writes through the service role and checks ownership
-- itself; RLS is the second wall. Learners may read their own rows, and may
-- edit or delete their own memory lines. Supabase grants new tables to
-- anon/authenticated directly, so both are set explicitly.
-- Apply by hand after probing pg_catalog. Never `supabase db push`.
-- One transaction: it applies whole or not at all. lock_timeout keeps the
-- ALTER on review_cards from queueing behind live traffic; on timeout, re-run.
-- Safe to re-run (IF NOT EXISTS / DROP ... IF EXISTS throughout).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.luna_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  space_id        TEXT NOT NULL CHECK (length(space_id) BETWEEN 1 AND 64),
  lecture_id      UUID REFERENCES public.lectures(id) ON DELETE SET NULL,
  goal            TEXT NOT NULL DEFAULT '' CHECK (length(goal) <= 300),
  plan            JSONB NOT NULL DEFAULT '[]'::jsonb,
  recap           TEXT NOT NULL DEFAULT '' CHECK (length(recap) <= 2000),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'wrapped', 'abandoned')),
  wrap            JSONB,
  kept            BOOLEAN NOT NULL DEFAULT false,
  turn_count      INTEGER NOT NULL DEFAULT 0 CHECK (turn_count >= 0),
  in_flight_until TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS luna_sessions_user_space_idx ON public.luna_sessions (user_id, space_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.luna_turns (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL REFERENCES public.luna_sessions(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_turn_id UUID NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('learner', 'luna', 'move')),
  content        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (session_id, client_turn_id, role)
);
CREATE INDEX IF NOT EXISTS luna_turns_session_idx ON public.luna_turns (session_id, created_at);
CREATE INDEX IF NOT EXISTS luna_turns_user_idx ON public.luna_turns (user_id);

CREATE TABLE IF NOT EXISTS public.learner_memory (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('preference', 'shaky', 'strong', 'goal')),
  space_id          TEXT CHECK (space_id IS NULL OR length(space_id) BETWEEN 1 AND 64),
  text              TEXT NOT NULL CHECK (length(btrim(text)) > 0 AND length(text) <= 80),
  source_session_id UUID REFERENCES public.luna_sessions(id) ON DELETE SET NULL,
  active            BOOLEAN NOT NULL DEFAULT true,
  retired_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learner_memory_user_idx ON public.learner_memory (user_id, active, updated_at);
CREATE INDEX IF NOT EXISTS learner_memory_source_session_idx ON public.learner_memory (source_session_id)
  WHERE source_session_id IS NOT NULL;

-- Practice made in a session: the same engine, an owner.
ALTER TABLE public.review_cards ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS review_cards_owner_idx ON public.review_cards (owner_id) WHERE owner_id IS NOT NULL;
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.review_cards'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.review_cards DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
-- NOT VALID first so the ADD takes only a brief lock; VALIDATE then scans
-- existing rows without blocking writes.
ALTER TABLE public.review_cards ADD CONSTRAINT review_cards_source_type_check
  CHECK (source_type IN ('quiz_question', 'concept_qa', 'concept_cloze', 'luna_session')) NOT VALID;
ALTER TABLE public.review_cards VALIDATE CONSTRAINT review_cards_source_type_check;

-- Enrolled students see the lecture's shared cards, never someone's own.
DROP POLICY IF EXISTS "review_cards_student_enrolled" ON public.review_cards;
CREATE POLICY "review_cards_student_enrolled" ON public.review_cards
  FOR SELECT USING (
    hidden_at IS NULL AND owner_id IS NULL AND EXISTS (
      SELECT 1 FROM public.assignment_lectures al
      JOIN public.assignment_enrollments ae ON ae.assignment_id = al.assignment_id
      WHERE al.lecture_id = review_cards.lecture_id
        AND ae.user_id = auth.uid()
    )
  );
-- Two older policies would otherwise expose an owned card to the lecture's
-- professor (read/update/delete) and to the lecture's student owner.
DROP POLICY IF EXISTS "review_cards_professor_owns_lecture" ON public.review_cards;
CREATE POLICY "review_cards_professor_owns_lecture" ON public.review_cards
  FOR ALL USING (
    owner_id IS NULL AND EXISTS (
      SELECT 1 FROM public.lectures l
      WHERE l.id = review_cards.lecture_id
        AND l.professor_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "review_cards_private_owner" ON public.review_cards;
CREATE POLICY "review_cards_private_owner" ON public.review_cards
  FOR SELECT USING (
    owner_id IS NULL AND EXISTS (
      SELECT 1 FROM public.lectures l
      WHERE l.id = review_cards.lecture_id AND l.student_owner_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "review_cards_owner" ON public.review_cards;
CREATE POLICY "review_cards_owner" ON public.review_cards
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

ALTER TABLE public.luna_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.luna_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learner_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "luna_sessions_own_read" ON public.luna_sessions;
CREATE POLICY "luna_sessions_own_read" ON public.luna_sessions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "luna_turns_own_read" ON public.luna_turns;
CREATE POLICY "luna_turns_own_read" ON public.luna_turns
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "learner_memory_own_read" ON public.learner_memory;
CREATE POLICY "learner_memory_own_read" ON public.learner_memory
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "learner_memory_own_edit" ON public.learner_memory;
CREATE POLICY "learner_memory_own_edit" ON public.learner_memory
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "learner_memory_own_delete" ON public.learner_memory;
CREATE POLICY "learner_memory_own_delete" ON public.learner_memory
  FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.luna_sessions, public.luna_turns, public.learner_memory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.luna_sessions, public.luna_turns TO authenticated;
GRANT SELECT, DELETE ON public.learner_memory TO authenticated;
GRANT UPDATE (text, updated_at) ON public.learner_memory TO authenticated;
GRANT ALL ON public.luna_sessions, public.luna_turns, public.learner_memory TO service_role;

COMMIT;
