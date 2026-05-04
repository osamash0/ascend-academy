-- Privilege-escalation hardening: remove the permissive client-side INSERT
-- policy on public.user_roles. Role assignment is performed exclusively by
-- the SECURITY DEFINER trigger public.handle_new_user() at signup time, so
-- end users never need direct INSERT rights on this table. Without this
-- migration any authenticated user could escalate themselves to professor
-- by inserting their own row with role='professor'.
DROP POLICY IF EXISTS "Users can insert their own role on signup"
  ON public.user_roles;

-- Belt-and-suspenders: explicitly forbid client INSERT/UPDATE/DELETE on
-- user_roles. SECURITY DEFINER functions and the service role are not
-- subject to RLS and continue to work.
DROP POLICY IF EXISTS "No client writes to user_roles"
  ON public.user_roles;
CREATE POLICY "No client writes to user_roles"
  ON public.user_roles
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- Re-create the SELECT policy explicitly so users can still read their own
-- role assignments (needed for the UI and for the backend fallback path).
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
CREATE POLICY "Users can view their own roles"
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
