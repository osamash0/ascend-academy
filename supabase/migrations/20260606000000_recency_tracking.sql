-- Recency tracking for student UX
--
-- Two tables:
--   course_visits  — one row per (student, course); UPSERT keeps it bounded.
--                    Used to order the browse course-rows by LIFS / MRF.
--
--   lecture_visits — append-only session log one row per (student, lecture)
--                    open event. Used for "Recently Viewed" mixed list.
--
-- StudentProgress.updated_at already tracks per-lecture recency for the
-- "Continue Learning" rail; these tables extend it to the course level and
-- provide an independent visit log for the "Recently Viewed" panel.

-- ── course_visits ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.course_visits (
    user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    course_id       UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
    last_visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    visit_count     INT NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, course_id)
);

ALTER TABLE public.course_visits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS course_visits_user_recency_idx
    ON public.course_visits(user_id, last_visited_at DESC);

DROP POLICY IF EXISTS "Students read own course visits" ON public.course_visits;
CREATE POLICY "Students read own course visits"
    ON public.course_visits FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Students upsert own course visits" ON public.course_visits;
CREATE POLICY "Students upsert own course visits"
    ON public.course_visits FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid() AND public.has_role(auth.uid(), 'student'));

DROP POLICY IF EXISTS "Students update own course visits" ON public.course_visits;
CREATE POLICY "Students update own course visits"
    ON public.course_visits FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- ── lecture_visits ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lecture_visits (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    lecture_id  UUID REFERENCES public.lectures(id) ON DELETE CASCADE NOT NULL,
    course_id   UUID REFERENCES public.courses(id) ON DELETE SET NULL,
    visited_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lecture_visits ENABLE ROW LEVEL SECURITY;

-- Most recent first; cap queries to the last 100 rows per student.
CREATE INDEX IF NOT EXISTS lecture_visits_user_recency_idx
    ON public.lecture_visits(user_id, visited_at DESC);

DROP POLICY IF EXISTS "Students read own lecture visits" ON public.lecture_visits;
CREATE POLICY "Students read own lecture visits"
    ON public.lecture_visits FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Students insert own lecture visits" ON public.lecture_visits;
CREATE POLICY "Students insert own lecture visits"
    ON public.lecture_visits FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid() AND public.has_role(auth.uid(), 'student'));
