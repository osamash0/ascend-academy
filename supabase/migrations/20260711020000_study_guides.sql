-- Roadmap Phase 4.4: per-course study guide, behind FEATURE_STUDY_GUIDE.
--
-- One cached, regeneratable guide per course: per-lecture synopses, merged
-- key concepts (deduped course-wide, reusing the Phase-3 concept graph) with
-- one-line definitions, and course_context facts (instructor/exam dates/
-- grading). Generated on first request and cached; `source_lecture_count`
-- lets the service detect "a new lecture was added since this was generated"
-- without an extra content-hash column.

CREATE TABLE IF NOT EXISTS public.study_guides (
    course_id            UUID PRIMARY KEY REFERENCES public.courses(id) ON DELETE CASCADE,
    content              JSONB NOT NULL,
    source_lecture_count INTEGER NOT NULL DEFAULT 0,
    generated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.study_guides ENABLE ROW LEVEL SECURITY;

-- Mirrors course_context's RLS shape exactly (20260711000000_course_context.sql)
-- so study-guide visibility never drifts from course visibility.

DROP POLICY IF EXISTS "Professors manage their own study guide" ON public.study_guides;
CREATE POLICY "Professors manage their own study guide"
ON public.study_guides FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.courses c
        WHERE c.id = study_guides.course_id
          AND c.professor_id = auth.uid()
          AND public.has_role(auth.uid(), 'professor')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.courses c
        WHERE c.id = study_guides.course_id
          AND c.professor_id = auth.uid()
          AND public.has_role(auth.uid(), 'professor')
    )
);

DROP POLICY IF EXISTS "Students view study guide for enrolled-lecture courses" ON public.study_guides;
CREATE POLICY "Students view study guide for enrolled-lecture courses"
ON public.study_guides FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.lectures l
        JOIN public.assignment_lectures al ON al.lecture_id = l.id
        JOIN public.assignment_enrollments ae ON ae.assignment_id = al.assignment_id
        WHERE l.course_id = study_guides.course_id
          AND ae.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Students view study guide for explicitly enrolled courses" ON public.study_guides;
CREATE POLICY "Students view study guide for explicitly enrolled courses"
ON public.study_guides FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.course_enrollments ce
        WHERE ce.course_id = study_guides.course_id
          AND ce.user_id = auth.uid()
    )
);
