-- Migration: 20260621000000_scope_professor_read_policies.sql
-- Description:
--   The "Professors can view all events/progress/achievements" RLS policies on
--   learning_events, student_progress and achievements granted SELECT to ANY
--   user holding the 'professor' role over EVERY student's row, with no scoping
--   to the professor's own courses:
--       USING (public.has_role(auth.uid(), 'professor'))
--   Combined with open professor self-signup (20260615000800_professor_signup_any_domain),
--   that means anyone who registers as a professor can read every student's
--   learning events, progress and achievements platform-wide — a cross-tenant
--   data exposure.
--
--   This migration rescopes those policies so a professor may only read the data
--   of students enrolled in one of THEIR OWN courses (courses.professor_id =
--   auth.uid() via course_enrollments). A professor with no courses/enrollments
--   (e.g. a freshly self-registered account) now sees nothing.
--
--   Note: legitimate professor analytics is unaffected as long as students
--   enroll in a course to access its lectures (which is the existing flow via
--   course_enrollments). If a path exists to generate learning_events for a
--   professor's lecture WITHOUT enrolling, those events would no longer be
--   visible to the professor — verify the enrollment flow if analytics counts
--   look low after deploy. The backend's trusted service_role reads (if any)
--   bypass RLS and are not affected.

-- ── learning_events ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Professors can view all events" ON public.learning_events;
CREATE POLICY "Professors view events for their enrolled students"
ON public.learning_events FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'professor')
  AND EXISTS (
    SELECT 1
    FROM public.course_enrollments ce
    JOIN public.courses c ON c.id = ce.course_id
    WHERE c.professor_id = auth.uid()
      AND ce.user_id = learning_events.user_id
  )
);

-- ── student_progress ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Professors can view all progress" ON public.student_progress;
CREATE POLICY "Professors view progress for their enrolled students"
ON public.student_progress FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'professor')
  AND EXISTS (
    SELECT 1
    FROM public.course_enrollments ce
    JOIN public.courses c ON c.id = ce.course_id
    WHERE c.professor_id = auth.uid()
      AND ce.user_id = student_progress.user_id
  )
);

-- ── achievements ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Professors can view all achievements" ON public.achievements;
CREATE POLICY "Professors view achievements for their enrolled students"
ON public.achievements FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'professor')
  AND EXISTS (
    SELECT 1
    FROM public.course_enrollments ce
    JOIN public.courses c ON c.id = ce.course_id
    WHERE c.professor_id = auth.uid()
      AND ce.user_id = achievements.user_id
  )
);
