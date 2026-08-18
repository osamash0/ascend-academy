-- Migration: 20260818000000_fix_get_user_courses_enrollment_scope.sql
-- Description: M41 -- "Enrolled-course count disagrees across three surfaces."
--
-- `/profile` calls the `get_user_courses` RPC (defined in
-- 20260613000000_social_friends.sql), which counted ONLY rows in
-- `course_enrollments`. The dashboard course rail / `/library` go through
-- `GET /api/courses` (backend/api/v1/courses.py), whose
-- `_student_visible_course_ids` helper unions a broader, more complete
-- definition of "courses this student has access to": courses the user owns
-- (professor_id), courses they're directly enrolled in
-- (`course_enrollments`), AND courses they can reach via an assignment
-- enrollment (`assignment_enrollments` -> `assignment_lectures` ->
-- `lectures.course_id`). That mismatch is why `/profile` showed "2" while
-- the dashboard/library showed "3" (the third course being assignment-based
-- access, which `get_user_courses` never looked at).
--
-- Fix direction: broaden `get_user_courses` to match the `courses.py`
-- definition, so `/profile` becomes MORE inclusive, not less -- this cannot
-- cause a student to suddenly see fewer courses than they actually have
-- access to. `20260613000000_social_friends.sql` may already be applied to
-- some environments, so this is a NEW migration doing
-- `CREATE OR REPLACE FUNCTION` rather than an edit to the historical file.
-- The parameter signature and return shape (course_id UUID, title TEXT,
-- mutual BOOLEAN) are unchanged -- callers (src/features/social/api.ts
-- fetchUserCourses) need no changes.
--
-- `mutual` also now uses the same broadened definition for the caller
-- (auth.uid()), for consistency with what "the courses shown here" now
-- means for the profile owner (p_user).

CREATE OR REPLACE FUNCTION public.get_user_courses(p_user UUID)
RETURNS TABLE (course_id UUID, title TEXT, mutual BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH visible_courses AS (
    -- Courses p_user owns.
    SELECT c.id AS course_id
    FROM public.courses c
    WHERE c.professor_id = p_user

    UNION

    -- Courses p_user is directly enrolled in.
    SELECT ce.course_id
    FROM public.course_enrollments ce
    WHERE ce.user_id = p_user

    UNION

    -- Courses p_user can access via an assignment enrollment (same join
    -- shape as backend/api/v1/courses.py::_student_visible_course_ids).
    SELECT l.course_id
    FROM public.assignment_enrollments ae
    JOIN public.assignment_lectures al ON al.assignment_id = ae.assignment_id
    JOIN public.lectures l ON l.id = al.lecture_id
    WHERE ae.user_id = p_user
      AND l.course_id IS NOT NULL
  ),
  caller_courses AS (
    SELECT c.id AS course_id
    FROM public.courses c
    WHERE c.professor_id = auth.uid()

    UNION

    SELECT ce.course_id
    FROM public.course_enrollments ce
    WHERE ce.user_id = auth.uid()

    UNION

    SELECT l.course_id
    FROM public.assignment_enrollments ae
    JOIN public.assignment_lectures al ON al.assignment_id = ae.assignment_id
    JOIN public.lectures l ON l.id = al.lecture_id
    WHERE ae.user_id = auth.uid()
      AND l.course_id IS NOT NULL
  )
  SELECT vc.course_id, c.title,
         EXISTS (SELECT 1 FROM caller_courses cc WHERE cc.course_id = vc.course_id)
  FROM visible_courses vc
  JOIN public.courses c ON c.id = vc.course_id
  ORDER BY c.title;
$$;

REVOKE ALL ON FUNCTION public.get_user_courses(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_courses(UUID) TO authenticated;
