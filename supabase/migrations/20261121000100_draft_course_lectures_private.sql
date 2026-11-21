-- Lectures of a draft course are visible only to the course owner, the
-- lecture owner, enrolled members and admins.
--
-- lecture_visible_to_caller() (20260710040000) hid only private student
-- uploads. A draft course (courses.status = 'draft', 20260713000000) hides
-- its lecture rows from other users, but the slides, quiz questions, mind
-- maps, localizations and PDF objects follow this helper, so any signed-in
-- account could read a draft's slides, and list them without knowing the
-- lecture id. The helper now also hides lectures of a draft course from
-- everyone except its owner, the lecture's owner, enrolled members and admins.
-- Lectures without a course, and lectures of published courses, behave as before.
-- The backend reads with the service role and is not affected.

CREATE OR REPLACE FUNCTION public.lecture_visible_to_caller(p_lecture_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT NOT EXISTS (
        SELECT 1 FROM public.lectures
        WHERE id = p_lecture_id
          AND visibility = 'private_student'
          AND student_owner_id IS DISTINCT FROM auth.uid()
    )
    AND NOT EXISTS (
        SELECT 1
        FROM public.lectures l
        JOIN public.courses c ON c.id = l.course_id
        WHERE l.id = p_lecture_id
          AND c.status = 'draft'
          AND c.professor_id IS DISTINCT FROM auth.uid()
          AND l.professor_id IS DISTINCT FROM auth.uid()
          AND NOT EXISTS (
              SELECT 1 FROM public.course_enrollments ce
              WHERE ce.course_id = c.id AND ce.user_id = auth.uid()
          )
          AND NOT public.has_role(auth.uid(), 'admin')
    );
$$;

-- Same ACL as before (S-1, 20260721000001); restated for the definer lint.
REVOKE ALL ON FUNCTION public.lecture_visible_to_caller(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lecture_visible_to_caller(UUID) TO authenticated, service_role;
