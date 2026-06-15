-- Allow professor accounts from any email domain.
--
-- Previously handle_new_user only honored a requested 'professor' role for a
-- hard-coded whitelist of university domains and forced everyone else to
-- 'student'. That made it impossible to create a professor account from an
-- arbitrary email. We now honor the role requested at signup
-- (user_metadata.role) regardless of domain.
--
-- SECURITY: we still refuse to let anyone self-assign 'admin' via signup
-- metadata. Only 'student' and 'professor' may be requested; anything else
-- (including 'admin' or a malformed value) falls back to 'student'. Admin must
-- still be granted server-side / by another admin.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _requested TEXT;
  _role app_role := 'student'; -- default safe role
BEGIN
  -- Insert profile for the new user
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email);

  -- Honor the role requested at signup, but only allow the self-serve roles.
  -- 'admin' can never be granted this way.
  _requested := NEW.raw_user_meta_data->>'role';
  IF _requested IN ('student', 'professor') THEN
    _role := _requested::app_role;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;
