-- P2-1 (Foundation 10x roadmap): make RLS the authorization boundary for the
-- course catalog browse path.
--
-- GET /api/courses/browse (backend/api/v1/courses.py::browse_courses) has
-- always been a public catalog: any authenticated user (student or professor)
-- can see every OTHER professor's published, non-archived courses so they can
-- discover and enroll. That visibility was previously enforced only in
-- Python (supabase_admin fetch + a manual filter on status/is_archived/
-- professor role) -- the RLS policies on `courses` did not actually grant
-- this, because they only cover (a) a professor's own rows and (b) rows the
-- caller is already enrolled in. Converting browse_courses to the
-- RLS-enforcing per-user client (P2-1) requires a matching SELECT policy,
-- or every non-owned, non-enrolled course would vanish from the catalog.
--
-- This policy grants exactly the same rows the Python filter already
-- exposed: published, non-archived courses, to any authenticated user.
-- (The `professor_id` in `prof_ids` re-check in the old Python code was
-- always redundant -- courses can only be inserted by a caller who is
-- `professor_id = auth.uid() AND has_role(auth.uid(), 'professor')`, see
-- 20260503000012_courses.sql -- so every course row already belongs to a
-- professor.)
--
-- Multiple permissive SELECT policies on the same table combine with OR, so
-- this is additive: it does not change what a professor sees of their own
-- (possibly draft/archived) courses, or what an enrolled student sees of a
-- course regardless of its published state -- it only adds "anyone
-- authenticated can browse the published catalog," matching current
-- production behavior exactly.

DROP POLICY IF EXISTS "Authenticated users browse published courses" ON public.courses;
CREATE POLICY "Authenticated users browse published courses"
ON public.courses FOR SELECT
TO authenticated
USING (
    status = 'published'
    AND is_archived = false
);
