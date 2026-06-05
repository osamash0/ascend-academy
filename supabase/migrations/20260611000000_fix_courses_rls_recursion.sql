-- Fix infinite recursion in courses RLS policies.
--
-- Root cause:
-- 1. The SELECT policy "Students view explicitly enrolled courses" on courses
--    queries course_enrollments.
-- 2. The SELECT policy "Professors view enrollments for their courses" on course_enrollments
--    queries courses back.
-- Postgres evaluates both through RLS, creating an infinite loop.
--
-- Fix:
-- Introduce a SECURITY DEFINER helper that reads courses.professor_id directly
-- (bypassing RLS). Re-create "Professors view enrollments for their courses"
-- using this helper.

CREATE OR REPLACE FUNCTION public.course_professor_id(course_uuid UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT professor_id FROM public.courses WHERE id = course_uuid;
$$;

DROP POLICY IF EXISTS "Professors view enrollments for their courses" ON public.course_enrollments;
CREATE POLICY "Professors view enrollments for their courses"
ON public.course_enrollments FOR SELECT
TO authenticated
USING (
    public.course_professor_id(course_id) = auth.uid()
);
