-- Migration: 20260620000000_protect_profile_privileged_columns.sql
-- Description:
--   The "Users can update their own profile" RLS policy on public.profiles is
--   column-unrestricted (USING auth.uid() = user_id, no column scoping). Because
--   regular clients talk to PostgREST with the anon key under RLS, any logged-in
--   user can PATCH their own profile row directly and set:
--     * institution_verified  — the institution-trust flag, otherwise only set
--                               by the SECURITY DEFINER link_university_email()
--                               after verifying the email domain.
--     * total_xp / current_level / current_streak / best_streak — the
--                               server-authoritative gamification state, otherwise
--                               only mutated by grant_xp()/evaluate_badges().
--   That lets a user forge the verified badge and inflate XP/level/streaks
--   (poisoning the leaderboard and minting badges, since evaluate_badges() reads
--   these columns straight from the profile row).
--
--   RLS WITH CHECK cannot reference OLD, so we enforce column immutability with a
--   BEFORE UPDATE trigger that reverts these columns to their previous values
--   whenever the update is performed directly by an end-user role. Trusted
--   contexts are unaffected: SECURITY DEFINER functions run as their owner
--   (postgres) and the backend uses the service_role key, so legitimate writes
--   via link_university_email()/grant_xp()/evaluate_badges() and the backend
--   continue to work.
--
--   Note: only these 5 columns are protected. full_name, display_name,
--   avatar_url, preferred_language, university_id/email and the academic-catalog
--   fields remain freely user-editable (they are not trust/integrity flags), so
--   onboarding and Settings are unaffected.

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
-- SECURITY INVOKER (the default) is REQUIRED here: the trigger must observe the
-- role of the statement that fired it. A SECURITY DEFINER trigger would always
-- evaluate current_user as its own owner and defeat the check below.
AS $$
BEGIN
  -- Constrain only direct writes by end-user roles. SECURITY DEFINER functions
  -- execute as their owner (postgres) and the trusted backend uses service_role;
  -- both must remain able to set these columns.
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.institution_verified := OLD.institution_verified;
    NEW.total_xp             := OLD.total_xp;
    NEW.current_level        := OLD.current_level;
    NEW.current_streak       := OLD.current_streak;
    NEW.best_streak          := OLD.best_streak;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_privileged_columns ON public.profiles;
CREATE TRIGGER protect_profile_privileged_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_privileged_columns();
