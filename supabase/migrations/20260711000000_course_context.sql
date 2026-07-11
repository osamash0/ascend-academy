-- Roadmap Phase 3.1: Course context ("course brain"), behind FEATURE_COURSE_BRAIN.
--
-- A 1:1 companion table to `courses` holding structured facts extracted from
-- administrative/organizational slides (syllabus, grading policy, exam
-- dates) so the tutor, quizzes, and a "Course facts" editor card can use them
-- without re-deriving them from raw slide text every time.
--
-- Additive only (flag-not-delete): a course with no row here simply has no
-- extracted facts yet — every existing course/lecture keeps working exactly
-- as before.

CREATE TABLE IF NOT EXISTS public.course_context (
    course_id       UUID PRIMARY KEY REFERENCES public.courses(id) ON DELETE CASCADE,
    instructor      TEXT,
    exam_dates      JSONB NOT NULL DEFAULT '[]',   -- array of {label, date} objects
    syllabus_facts  JSONB NOT NULL DEFAULT '{}',    -- free-form extracted facts
    grading_scheme  TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.course_context ENABLE ROW LEVEL SECURITY;

-- Mirrors courses' own RLS shape exactly (same three policies as
-- 20260503000012_courses.sql / 20260604000000_course_enrollments.sql) so
-- course_context visibility never drifts from course visibility.

DROP POLICY IF EXISTS "Professors manage their own course context" ON public.course_context;
CREATE POLICY "Professors manage their own course context"
ON public.course_context FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.courses c
        WHERE c.id = course_context.course_id
          AND c.professor_id = auth.uid()
          AND public.has_role(auth.uid(), 'professor')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.courses c
        WHERE c.id = course_context.course_id
          AND c.professor_id = auth.uid()
          AND public.has_role(auth.uid(), 'professor')
    )
);

DROP POLICY IF EXISTS "Students view context for enrolled-lecture courses" ON public.course_context;
CREATE POLICY "Students view context for enrolled-lecture courses"
ON public.course_context FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.lectures l
        JOIN public.assignment_lectures al ON al.lecture_id = l.id
        JOIN public.assignment_enrollments ae ON ae.assignment_id = al.assignment_id
        WHERE l.course_id = course_context.course_id
          AND ae.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Students view context for explicitly enrolled courses" ON public.course_context;
CREATE POLICY "Students view context for explicitly enrolled courses"
ON public.course_context FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.course_enrollments ce
        WHERE ce.course_id = course_context.course_id
          AND ce.user_id = auth.uid()
    )
);
