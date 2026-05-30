-- Fix infinite recursion in assignments RLS policies.
--
-- Root cause: the `assignments` SELECT policy queries `assignment_enrollments`,
-- and the `assignment_enrollments` ALL policy queries `assignments` back.
-- Postgres evaluates both through RLS, creating an infinite loop.
--
-- Fix: introduce a SECURITY DEFINER helper that reads assignments.professor_id
-- directly (bypassing RLS). The join-table policies use this function instead
-- of re-querying `assignments` through the policy stack.

CREATE OR REPLACE FUNCTION public.assignment_owner_id(assignment_uuid UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT professor_id FROM public.assignments WHERE id = assignment_uuid;
$$;

-- Re-create assignment_enrollments professor policy using the helper.
DROP POLICY IF EXISTS "Professors manage their assignment_enrollments" ON public.assignment_enrollments;
CREATE POLICY "Professors manage their assignment_enrollments"
ON public.assignment_enrollments FOR ALL
TO authenticated
USING (
    public.assignment_owner_id(assignment_id) = auth.uid()
    AND public.has_role(auth.uid(), 'professor')
)
WITH CHECK (
    public.assignment_owner_id(assignment_id) = auth.uid()
    AND public.has_role(auth.uid(), 'professor')
);

-- Re-create assignment_lectures professor policy using the helper.
DROP POLICY IF EXISTS "Professors manage their own assignment_lectures" ON public.assignment_lectures;
CREATE POLICY "Professors manage their own assignment_lectures"
ON public.assignment_lectures FOR ALL
TO authenticated
USING (
    public.assignment_owner_id(assignment_id) = auth.uid()
    AND public.has_role(auth.uid(), 'professor')
)
WITH CHECK (
    public.assignment_owner_id(assignment_id) = auth.uid()
    AND public.has_role(auth.uid(), 'professor')
);

-- Re-create assignment_lectures student SELECT policy using the helper.
DROP POLICY IF EXISTS "Enrolled students view assignment_lectures" ON public.assignment_lectures;
CREATE POLICY "Enrolled students view assignment_lectures"
ON public.assignment_lectures FOR SELECT
TO authenticated
USING (
    public.assignment_owner_id(assignment_id) = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.assignment_enrollments ae
        WHERE ae.assignment_id = assignment_lectures.assignment_id
          AND ae.user_id = auth.uid()
    )
);
