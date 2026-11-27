-- Three policy holes found by read-only pg_catalog probes of prod on
-- 2026-11-11. Each permitted something the app never does itself; none was
-- tested by exploitation. Prod data was checked against every new rule the
-- same day: no lecture sits in a course its professor_id does not own, no
-- private upload carries a course_id, every enrolment is in a published
-- course, and all 162 poster objects are keyed lectures/<uuid>/...
--
--   1. lectures: "Owners can create lectures" checked professor_id only, so a
--      user could insert a lesson into someone else's Space, where that
--      Space's members then saw it ("Students view lectures for enrolled
--      courses" looks at course_id alone). The UPDATE policy had no WITH
--      CHECK, so moving one's own lesson there worked too. An owner's lesson
--      write now has to leave the lesson in no Space or in one the writer
--      owns. Private uploads need nothing here: lectures_owner_consistency
--      already keeps their course_id NULL.
--   2. lecture-posters: SELECT was bucket_id only, so any signed-in user could
--      list and sign every poster (page 1 of the deck), private uploads
--      included. A poster now follows its lesson: readable exactly when the
--      caller can read the lectures row (the subquery runs under the caller's
--      own lectures RLS).
--   3. course_enrollments: a student could enrol themselves in any course,
--      draft or archived included. The client may now enrol only where
--      join_space (backend/services/v4_spaces_service.py) would: published,
--      not archived. The app enrols through the backend, which bypasses RLS,
--      so no live path depends on the old wider rule.
--
-- A fourth hole from the same probe, get_user_profile(uuid) answering for any
-- user id, is closed separately by 20261113000100_get_user_profile_honours_
-- visibility.sql (#185).
--
-- Backend writes use the service role or the table owner and are unaffected.
-- Prod's migration ledger is unreliable: apply by hand, verify in pg_catalog
-- (docs/runbooks/apply-a-migration-by-hand.md).

-- ── 1. lectures: writes stay inside the writer's own Spaces ─────────────────
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

-- ── 2. lecture-posters: a poster follows its lesson ─────────────────────────
DROP POLICY IF EXISTS "Authenticated users can read lecture posters" ON storage.objects;
DROP POLICY IF EXISTS "Read lecture posters for visible lessons" ON storage.objects;
CREATE POLICY "Read lecture posters for visible lessons"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'lecture-posters'
    AND (
        CASE
            WHEN (string_to_array(name, '/'))[1] = 'lectures'
             AND (string_to_array(name, '/'))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            THEN EXISTS (
                SELECT 1 FROM public.lectures l
                WHERE l.id = ((string_to_array(name, '/'))[2])::uuid
            )
            ELSE false
        END
    )
);

-- ── 3. course_enrollments: self-enrolment only where join_space would ──────
DROP POLICY IF EXISTS "Students can insert own enrollments" ON public.course_enrollments;
CREATE POLICY "Students can insert own enrollments"
ON public.course_enrollments FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid()
    AND public.has_role(auth.uid(), 'student')
    AND EXISTS (
        SELECT 1 FROM public.courses c
        WHERE c.id = course_enrollments.course_id
          AND c.status = 'published'
          AND NOT COALESCE(c.is_archived, false)
    )
);
