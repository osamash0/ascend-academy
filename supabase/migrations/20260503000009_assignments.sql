-- Weekly assignments for professors
--
-- Tables:
--   assignments             — one row per professor-authored assignment
--   assignment_lectures     — assignment ↔ lecture join
--   assignment_enrollments  — assignment ↔ enrolled student join (the
--                             explicit roster used to scope visibility)
--
-- Visibility model:
--   - Professors fully manage their own assignments and the join rows
--     (lectures + enrollments) that point at them.
--   - Students see ONLY assignments they are explicitly enrolled in via
--     `assignment_enrollments`. There is no `courses` table yet, so the
--     enrollment is scoped per-assignment rather than per-course; this
--     gives least-privilege visibility without inventing a course domain.

-- ── assignments ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    professor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    course_id UUID NULL,                       -- reserved for future courses table
    title TEXT NOT NULL,
    description TEXT,
    due_at TIMESTAMP WITH TIME ZONE NOT NULL,
    min_quiz_score INTEGER,                    -- 0..100, NULL = no minimum
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    CHECK (min_quiz_score IS NULL OR (min_quiz_score >= 0 AND min_quiz_score <= 100))
);

ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS assignments_professor_idx
    ON public.assignments(professor_id);
CREATE INDEX IF NOT EXISTS assignments_due_at_idx
    ON public.assignments(due_at);

DROP POLICY IF EXISTS "Professors manage their own assignments" ON public.assignments;
CREATE POLICY "Professors manage their own assignments"
ON public.assignments FOR ALL
TO authenticated
USING (
    professor_id = auth.uid()
    AND public.has_role(auth.uid(), 'professor')
)
WITH CHECK (
    professor_id = auth.uid()
    AND public.has_role(auth.uid(), 'professor')
);


-- ── assignment_lectures (join) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.assignment_lectures (
    assignment_id UUID REFERENCES public.assignments(id) ON DELETE CASCADE NOT NULL,
    lecture_id UUID REFERENCES public.lectures(id) ON DELETE CASCADE NOT NULL,
    PRIMARY KEY (assignment_id, lecture_id)
);

ALTER TABLE public.assignment_lectures ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS assignment_lectures_lecture_idx
    ON public.assignment_lectures(lecture_id);

DROP POLICY IF EXISTS "Professors manage their own assignment_lectures" ON public.assignment_lectures;
CREATE POLICY "Professors manage their own assignment_lectures"
ON public.assignment_lectures FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.assignments a
        WHERE a.id = assignment_lectures.assignment_id
          AND a.professor_id = auth.uid()
    )
    AND public.has_role(auth.uid(), 'professor')
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.assignments a
        WHERE a.id = assignment_lectures.assignment_id
          AND a.professor_id = auth.uid()
    )
    AND public.has_role(auth.uid(), 'professor')
);


-- ── assignment_enrollments (roster) ──────────────────────────────────────────
-- Explicit per-assignment student roster. Visibility for everything in
-- this feature flows from this table.
CREATE TABLE IF NOT EXISTS public.assignment_enrollments (
    assignment_id UUID REFERENCES public.assignments(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    PRIMARY KEY (assignment_id, user_id)
);

ALTER TABLE public.assignment_enrollments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS assignment_enrollments_user_idx
    ON public.assignment_enrollments(user_id);

-- Professors managing their own assignment fully manage its roster.
DROP POLICY IF EXISTS "Professors manage their assignment_enrollments" ON public.assignment_enrollments;
CREATE POLICY "Professors manage their assignment_enrollments"
ON public.assignment_enrollments FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.assignments a
        WHERE a.id = assignment_enrollments.assignment_id
          AND a.professor_id = auth.uid()
    )
    AND public.has_role(auth.uid(), 'professor')
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.assignments a
        WHERE a.id = assignment_enrollments.assignment_id
          AND a.professor_id = auth.uid()
    )
    AND public.has_role(auth.uid(), 'professor')
);

-- Enrolled student can SELECT their own enrollment row.
DROP POLICY IF EXISTS "Students view their own enrollments" ON public.assignment_enrollments;
CREATE POLICY "Students view their own enrollments"
ON public.assignment_enrollments FOR SELECT
TO authenticated
USING (user_id = auth.uid());


-- ── Visibility policies (assignments + assignment_lectures) ──────────────────
-- Students see assignments / join rows ONLY if they are enrolled.
DROP POLICY IF EXISTS "Authenticated users can view assignments" ON public.assignments;
DROP POLICY IF EXISTS "Students view assignments from engaged professors" ON public.assignments;
DROP POLICY IF EXISTS "Enrolled students view assignments" ON public.assignments;
CREATE POLICY "Enrolled students view assignments"
ON public.assignments FOR SELECT
TO authenticated
USING (
    professor_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.assignment_enrollments ae
        WHERE ae.assignment_id = assignments.id
          AND ae.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Authenticated users can view assignment_lectures" ON public.assignment_lectures;
DROP POLICY IF EXISTS "Visible assignment_lectures track parent assignment" ON public.assignment_lectures;
DROP POLICY IF EXISTS "Enrolled students view assignment_lectures" ON public.assignment_lectures;
CREATE POLICY "Enrolled students view assignment_lectures"
ON public.assignment_lectures FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.assignments a
        WHERE a.id = assignment_lectures.assignment_id
          AND (
              a.professor_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.assignment_enrollments ae
                  WHERE ae.assignment_id = a.id
                    AND ae.user_id = auth.uid()
              )
          )
    )
);
