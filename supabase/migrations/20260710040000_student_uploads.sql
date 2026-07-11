-- Roadmap Phase 3.1: Student self-serve uploads ("My Materials"), behind
-- FEATURE_STUDENT_UPLOADS. A student can upload a personal PDF that runs
-- through the same parse pipeline as a professor's lecture (slides, quizzes,
-- tutor chat, semantic search, review cards) but stays private to the
-- uploader: never surfaced in course listings, professor analytics,
-- leaderboards, or the shared concept graph.
--
-- Additive only (flag-not-delete): existing `lectures` rows are all
-- visibility='course' with professor_id set and student_owner_id NULL, so
-- the new CHECK constraint holds for every row that already exists.

-- ── 1. Lectures: add the private-ownership lane ─────────────────────────────

ALTER TABLE public.lectures
    ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'course'
        CHECK (visibility IN ('course', 'private_student')),
    ADD COLUMN IF NOT EXISTS student_owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- professor_id was NOT NULL — a private-student lecture has no professor.
ALTER TABLE public.lectures ALTER COLUMN professor_id DROP NOT NULL;

ALTER TABLE public.lectures
    ADD CONSTRAINT lectures_owner_consistency CHECK (
        (visibility = 'course' AND professor_id IS NOT NULL AND student_owner_id IS NULL)
        OR
        (visibility = 'private_student' AND student_owner_id IS NOT NULL
             AND professor_id IS NULL AND course_id IS NULL)
    );

CREATE INDEX IF NOT EXISTS idx_lectures_student_owner
    ON public.lectures(student_owner_id) WHERE student_owner_id IS NOT NULL;

-- ── 2. RLS: lectures ─────────────────────────────────────────────────────────
-- Existing policies (20260612000000) already scope professor/course-student
-- visibility; add the owner-only lane for private uploads. Backend writes go
-- through the service asyncpg connection (bypasses RLS) — these policies are
-- the defense-in-depth layer against direct client (supabase-js) access.

CREATE POLICY "Students view own private lectures"
ON public.lectures FOR SELECT TO authenticated
USING (student_owner_id = auth.uid());

CREATE POLICY "Students insert own private lectures"
ON public.lectures FOR INSERT TO authenticated
WITH CHECK (student_owner_id = auth.uid() AND visibility = 'private_student');

CREATE POLICY "Students update own private lectures"
ON public.lectures FOR UPDATE TO authenticated
USING (student_owner_id = auth.uid())
WITH CHECK (student_owner_id = auth.uid() AND visibility = 'private_student');

CREATE POLICY "Students delete own private lectures"
ON public.lectures FOR DELETE TO authenticated
USING (student_owner_id = auth.uid());

-- ── 3. RLS: slides / quiz_questions ──────────────────────────────────────────
-- These were "Anyone can view" (USING (true)) — wide open to every
-- authenticated user regardless of the parent lecture's visibility (and
-- regardless of whether that user could even SELECT the lecture row itself
-- — e.g. a non-enrolled student). Tighten to respect private_student
-- visibility while leaving that wide-open course-lecture behavior in place.
--
-- A plain `EXISTS (SELECT 1 FROM lectures WHERE ...)` would NOT do this
-- safely: evaluating it recurses into `lectures`' own RLS policies for the
-- querying role, so a non-enrolled student's EXISTS check would spuriously
-- fail even for a 'course' lecture (lectures' SELECT policy requires
-- assignment enrollment) — silently narrowing today's open behavior instead
-- of only gating the new private lane. A SECURITY DEFINER helper (same
-- pattern as `public.has_role`) checks the raw column values without
-- re-applying `lectures` RLS.

CREATE OR REPLACE FUNCTION public.lecture_visible_to_caller(p_lecture_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT NOT EXISTS (
        SELECT 1 FROM public.lectures
        WHERE id = p_lecture_id
          AND visibility = 'private_student'
          AND student_owner_id IS DISTINCT FROM auth.uid()
    );
$$;

DROP POLICY IF EXISTS "Anyone can view slides" ON public.slides;
CREATE POLICY "View slides respecting lecture visibility"
ON public.slides FOR SELECT TO authenticated
USING (public.lecture_visible_to_caller(slides.lecture_id));

CREATE POLICY "Students manage own private-lecture slides"
ON public.slides FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.lectures l
        WHERE l.id = slides.lecture_id AND l.student_owner_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Anyone can view quiz questions" ON public.quiz_questions;
CREATE POLICY "View quiz questions respecting lecture visibility"
ON public.quiz_questions FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.slides s
        WHERE s.id = quiz_questions.slide_id
          AND public.lecture_visible_to_caller(s.lecture_id)
    )
);

CREATE POLICY "Students manage own private-lecture quiz questions"
ON public.quiz_questions FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.slides s
        JOIN public.lectures l ON l.id = s.lecture_id
        WHERE s.id = quiz_questions.slide_id AND l.student_owner_id = auth.uid()
    )
);

-- ── 4. RLS: review_cards ─────────────────────────────────────────────────────
-- The existing "review_cards_student_enrolled" policy only covers cards
-- reached via assignment enrollment (course lectures). Add the private-owner
-- branch so a student's own material's review cards are readable.

CREATE POLICY "review_cards_private_owner" ON public.review_cards
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.lectures l
        WHERE l.id = review_cards.lecture_id AND l.student_owner_id = auth.uid()
    )
);

-- ── 5. Monthly upload quota ──────────────────────────────────────────────────
-- Quota is the natural monetization boundary (roadmap 3.1). Default 5
-- uploads/month; enforced server-side via the atomic RPC below before a file
-- is ever enqueued for parsing.

CREATE TABLE IF NOT EXISTS public.upload_quotas (
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    period       TEXT NOT NULL,               -- 'YYYY-MM'
    uploads_used INTEGER NOT NULL DEFAULT 0,
    quota_limit  INTEGER NOT NULL DEFAULT 5,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, period)
);

ALTER TABLE public.upload_quotas ENABLE ROW LEVEL SECURITY;

-- Own-row read only; all writes go through increment_upload_quota() (SECURITY
-- DEFINER) called from the trusted backend — no direct client INSERT/UPDATE
-- policy is defined, so a forged client-side write is rejected outright.
CREATE POLICY "upload_quotas_own_select" ON public.upload_quotas
FOR SELECT USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.increment_upload_quota(
    p_user_id UUID, p_period TEXT, p_limit INTEGER
)
RETURNS TABLE(allowed BOOLEAN, uploads_used INTEGER, quota_limit INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_used INTEGER;
BEGIN
    -- Every bare column reference below is qualified with the table alias —
    -- RETURNS TABLE's output columns (allowed/uploads_used/quota_limit) are
    -- also implicit PL/pgSQL variables in this function's scope, and their
    -- names collide with upload_quotas' own columns, so an unqualified
    -- reference is ambiguous (caught by a real-Postgres test run).
    INSERT INTO upload_quotas AS uq (user_id, period, uploads_used, quota_limit)
    VALUES (p_user_id, p_period, 0, p_limit)
    ON CONFLICT (user_id, period) DO NOTHING;

    PERFORM 1 FROM upload_quotas uq WHERE uq.user_id = p_user_id AND uq.period = p_period FOR UPDATE;

    SELECT uq.uploads_used INTO v_used FROM upload_quotas uq
    WHERE uq.user_id = p_user_id AND uq.period = p_period;

    IF v_used >= p_limit THEN
        RETURN QUERY SELECT false, v_used, p_limit;
        RETURN;
    END IF;

    UPDATE upload_quotas uq
       SET uploads_used = uq.uploads_used + 1, updated_at = now(), quota_limit = p_limit
     WHERE uq.user_id = p_user_id AND uq.period = p_period
    RETURNING uq.uploads_used INTO v_used;

    RETURN QUERY SELECT true, v_used, p_limit;
END;
$$;
