-- ============================================================================
-- Link a (separate) university email and verify by DOMAIN trust.
-- Most students sign up with a personal email; this lets them attach their
-- institutional address. If its domain matches a known university's
-- email_domains we mark institution_verified = TRUE. One address per account
-- (unique) to limit trivial reuse. NOTE: domain-trust is a soft check (no
-- ownership proof / emailed code) — upgrade to OTP when an email sender exists.
-- Idempotent.
-- ============================================================================

SET check_function_bodies = off;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS university_email TEXT;

-- One account per institutional address.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_profiles_university_email
  ON public.profiles (lower(university_email)) WHERE university_email IS NOT NULL;

-- Read the caller's current verification state (auth profile fetch doesn't
-- include these columns).
CREATE OR REPLACE FUNCTION public.get_my_verification()
RETURNS TABLE (university_email TEXT, institution_verified BOOLEAN, institution TEXT, university_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT university_email, institution_verified, institution, university_id
  FROM public.profiles WHERE user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.get_my_verification() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_verification() TO authenticated;

-- Link + (domain-)verify an institutional email for the signed-in user.
-- reason ∈ 'verified' | 'invalid' | 'taken' | 'unknown_domain' | 'mismatch'
CREATE OR REPLACE FUNCTION public.link_university_email(p_email TEXT)
RETURNS TABLE (verified BOOLEAN, university TEXT, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me        UUID := auth.uid();
  _email     TEXT := lower(btrim(p_email));
  _domain    TEXT;
  _uni_id    UUID;
  _uni_name  TEXT;
  _profile_uni UUID;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF _email IS NULL OR position('@' IN _email) < 2 OR _email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'invalid'; RETURN;
  END IF;

  -- Address already claimed by someone else?
  IF EXISTS (SELECT 1 FROM public.profiles
             WHERE lower(university_email) = _email AND user_id <> _me) THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'taken'; RETURN;
  END IF;

  _domain := split_part(_email, '@', 2);
  SELECT id, name INTO _uni_id, _uni_name
  FROM public.universities WHERE _domain = ANY (email_domains) LIMIT 1;

  -- Unknown domain: store the address but don't verify.
  IF _uni_id IS NULL THEN
    UPDATE public.profiles SET university_email = _email WHERE user_id = _me;
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'unknown_domain'; RETURN;
  END IF;

  -- If the profile already committed to a DIFFERENT university (e.g. picked a
  -- program elsewhere in onboarding), don't silently override it.
  SELECT university_id INTO _profile_uni FROM public.profiles WHERE user_id = _me;
  IF _profile_uni IS NOT NULL AND _profile_uni <> _uni_id THEN
    RETURN QUERY SELECT FALSE, _uni_name, 'mismatch'; RETURN;
  END IF;

  UPDATE public.profiles
     SET university_email     = _email,
         university_id        = COALESCE(university_id, _uni_id),
         institution          = COALESCE(NULLIF(btrim(institution), ''), _uni_name),
         institution_verified = TRUE
   WHERE user_id = _me;

  RETURN QUERY SELECT TRUE, _uni_name, 'verified';
END;
$$;
REVOKE ALL ON FUNCTION public.link_university_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_university_email(TEXT) TO authenticated;
