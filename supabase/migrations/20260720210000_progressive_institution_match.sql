-- University matching is a progressive personalization prompt, not an
-- implicit profile edit. Let the client discover a safe suggestion first;
-- `verify_my_institution` remains the explicit confirmation path.
ALTER TABLE public.onboarding_progress
  ADD COLUMN IF NOT EXISTS university_match_dismissed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.get_institution_match_suggestion()
RETURNS TABLE (university TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
  _email TEXT;
  _confirmed_at TIMESTAMPTZ;
  _domain TEXT;
  _suggested_university_id UUID;
  _profile_university_id UUID;
  _already_verified BOOLEAN;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email, email_confirmed_at INTO _email, _confirmed_at
  FROM auth.users
  WHERE id = _me;

  IF _email IS NULL OR _confirmed_at IS NULL OR _email NOT LIKE '%@%' THEN
    RETURN;
  END IF;

  SELECT university_id, institution_verified
  INTO _profile_university_id, _already_verified
  FROM public.profiles
  WHERE user_id = _me;

  IF COALESCE(_already_verified, FALSE) THEN
    RETURN;
  END IF;

  _domain := lower(substring(_email FROM '@(.*)$'));
  SELECT id INTO _suggested_university_id
  FROM public.universities
  WHERE _domain = ANY(email_domains)
  LIMIT 1;

  IF _suggested_university_id IS NULL
    OR (_profile_university_id IS NOT NULL AND _profile_university_id <> _suggested_university_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT name FROM public.universities WHERE id = _suggested_university_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_institution_match_suggestion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_institution_match_suggestion() TO authenticated;
