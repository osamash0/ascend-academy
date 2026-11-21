-- Lectures may only be attached to a course the caller owns.
--
-- "Owners can create lectures" (20260713000000) checked only that a new row
-- names its creator (professor_id = auth.uid()), not that the creator owns
-- the course in course_id. Through PostgREST any signed-in account could
-- therefore add a lecture, with slides and quiz questions it owns, to another
-- person's course, and every member of that course would see it. The UPDATE
-- policies had the same gap: an owner could move a lecture into someone
-- else's course by changing course_id.
--
-- course_id may stay NULL (lectures outside a course, private uploads).
-- course_professor_id() is the existing SECURITY DEFINER helper (S-1), so the
-- check does not recurse into the courses policies.
-- The backend writes with the service role and is not affected.

DROP POLICY IF EXISTS "Owners can create lectures" ON public.lectures;
CREATE POLICY "Owners can create lectures"
ON public.lectures FOR INSERT
TO authenticated
WITH CHECK (
    professor_id = auth.uid()
    AND (course_id IS NULL OR public.course_professor_id(course_id) = auth.uid())
);

DROP POLICY IF EXISTS "Owners can update their own lectures" ON public.lectures;
CREATE POLICY "Owners can update their own lectures"
ON public.lectures FOR UPDATE
TO authenticated
USING (professor_id = auth.uid())
WITH CHECK (
    professor_id = auth.uid()
    AND (course_id IS NULL OR public.course_professor_id(course_id) = auth.uid())
);

DROP POLICY IF EXISTS "Students insert own private lectures" ON public.lectures;
CREATE POLICY "Students insert own private lectures"
ON public.lectures FOR INSERT
TO authenticated
WITH CHECK (
    student_owner_id = auth.uid()
    AND visibility = 'private_student'
    AND (course_id IS NULL OR public.course_professor_id(course_id) = auth.uid())
);

DROP POLICY IF EXISTS "Students update own private lectures" ON public.lectures;
CREATE POLICY "Students update own private lectures"
ON public.lectures FOR UPDATE
TO authenticated
USING (student_owner_id = auth.uid())
WITH CHECK (
    student_owner_id = auth.uid()
    AND visibility = 'private_student'
    AND (course_id IS NULL OR public.course_professor_id(course_id) = auth.uid())
);
