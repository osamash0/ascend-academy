-- Courses: top-level professor-owned subject containers grouping lectures.
--
-- A course is a lightweight folder for lectures (slide decks). Lectures
-- keep their existing semantics (one uploaded PDF per lecture); the
-- course is purely a grouping mechanism so professors can organise many
-- decks under one subject (e.g. "Database Management").
--
-- Visibility:
--   - Professors fully manage their own courses.
--   - Students see a course indirectly through the lectures they can
--     access (via assignment_enrollments). There is no per-course roster
--     in this iteration; students simply read a `course_id` off the
--     lecture rows they're already allowed to see and can fetch the
--     course row to render a label/breadcrumb.

CREATE TABLE IF NOT EXISTS public.courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    professor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    color TEXT,
    icon TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS courses_professor_idx
    ON public.courses(professor_id);

DROP POLICY IF EXISTS "Professors manage their own courses" ON public.courses;
CREATE POLICY "Professors manage their own courses"
ON public.courses FOR ALL
TO authenticated
USING (
    professor_id = auth.uid()
    AND public.has_role(auth.uid(), 'professor')
)
WITH CHECK (
    professor_id = auth.uid()
    AND public.has_role(auth.uid(), 'professor')
);

-- Students may read course rows that label a lecture they're enrolled
-- in via an assignment. We keep this scoped through assignments — the
-- only existing student visibility primitive — so we don't invent a new
-- per-course roster yet.
DROP POLICY IF EXISTS "Students view courses for enrolled lectures" ON public.courses;
CREATE POLICY "Students view courses for enrolled lectures"
ON public.courses FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.lectures l
        JOIN public.assignment_lectures al ON al.lecture_id = l.id
        JOIN public.assignment_enrollments ae ON ae.assignment_id = al.assignment_id
        WHERE l.course_id = courses.id
          AND ae.user_id = auth.uid()
    )
);


-- ── lectures.course_id ───────────────────────────────────────────────────────
-- Nullable on purpose: existing lectures have no course (Uncategorized).
ALTER TABLE public.lectures
    ADD COLUMN IF NOT EXISTS course_id UUID
    REFERENCES public.courses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS lectures_course_idx
    ON public.lectures(course_id);
