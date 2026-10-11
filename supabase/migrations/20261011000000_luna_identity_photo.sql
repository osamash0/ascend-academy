-- get_luna_loadouts also returns avatar_url, so any screen that only knows a
-- person's id (professor analytics, assignment pickers) shows the same face
-- as everywhere else: photo -> Luna -> initials. Without it, a student with a
-- photo looked like their photo on the leaderboard but like Luna on a
-- professor's page.
--
-- avatar_url is the same class of data the social RPCs already expose to any
-- signed-in user. The return type changes, so the function is dropped and
-- recreated; grants are restated, including the explicit anon revoke that
-- Supabase's default privileges make necessary (see 20261010010000).
-- Old clients keep working: they simply ignore the extra column.

DROP FUNCTION IF EXISTS public.get_luna_loadouts(uuid[]);

CREATE FUNCTION public.get_luna_loadouts(p_user_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  luna_loadout jsonb,
  luna_suit_color text,
  luna_visor_tint text,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.luna_loadout, p.luna_suit_color, p.luna_visor_tint, p.avatar_url
    FROM public.profiles p
   WHERE auth.uid() IS NOT NULL
     AND p.user_id = ANY (p_user_ids[1:200]);
$$;

REVOKE ALL ON FUNCTION public.get_luna_loadouts(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_luna_loadouts(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_luna_loadouts(uuid[]) TO authenticated;
