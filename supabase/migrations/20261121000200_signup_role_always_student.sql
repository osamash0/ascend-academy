-- Every self-service sign-up gets the student role.
--
-- 20260615000800 let handle_new_user() honour a 'professor' role requested in
-- the sign-up metadata. That metadata is set by the client, so any caller of
-- the auth API could make themselves a professor, which bypasses the per-user
-- parse budget (only students' parses are refused) and the professor-only
-- policies. The app's own sign-up form always sends 'student', and since
-- 20260713000000 any user can create courses without the professor role, so
-- nothing in the product needs self-assigned professors. Professors are now
-- granted server-side or by an admin, as admins already are.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email);

  -- The role requested in the sign-up metadata is ignored on purpose.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'student'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Trigger function only; same ACL decision as 20261011000000, restated for the definer lint.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
