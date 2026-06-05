-- Migration: 20260612000000_scope_lecture_visibility.sql
-- Description: Restrict lecture SELECT visibility for students to only their enrolled courses or assignments.

-- 1. Drop the wide-open SELECT policy
DROP POLICY IF EXISTS "Anyone can view lectures" ON public.lectures;

-- 2. Add SELECT policy for professors (allow them to view all lectures they created)
CREATE POLICY "Professors view own lectures"
ON public.lectures FOR SELECT
TO authenticated
USING (
    professor_id = auth.uid()
    AND public.has_role(auth.uid(), 'professor')
);

-- 3. Add SELECT policy for students enrolled via assignments
CREATE POLICY "Students view lectures for enrolled assignments"
ON public.lectures FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.assignment_lectures al
        JOIN public.assignment_enrollments ae ON ae.assignment_id = al.assignment_id
        WHERE al.lecture_id = lectures.id
          AND ae.user_id = auth.uid()
    )
);
