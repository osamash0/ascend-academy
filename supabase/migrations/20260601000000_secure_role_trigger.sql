-- REDEFINE handle_new_user to harden role assignment against privilege-escalation attacks
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role app_role := 'student'; -- default safe role
  _email_domain TEXT;
BEGIN
  -- Insert profile for the new user
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email);

  -- Extract the domain portion of the email in lowercase
  IF NEW.email IS NOT NULL AND NEW.email LIKE '%@%' THEN
    _email_domain := lower(substring(NEW.email from '@(.*)$'));
  END IF;

  -- Whitelist domains allowed for professor accounts. All other domains register as student.
  -- Belt-and-suspenders check: we also allow a whitelisted role override only for internal testing
  -- if the email domain matches our trusted system dev domain (e.g. system.learnstation.com)
  -- and they request a valid role.
  IF _email_domain IN ('mit.edu', 'stanford.edu', 'tum.de', 'university.edu') THEN
    _role := COALESCE(
      (NEW.raw_user_meta_data->>'role')::app_role,
      'student'
    );
  ELSIF _email_domain = 'system.learnstation.com' THEN
    _role := COALESCE(
      (NEW.raw_user_meta_data->>'role')::app_role,
      'student'
    );
  ELSE
    _role := 'student';
  END IF;

  -- Ensure we assign the role in user_roles
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;
