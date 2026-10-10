-- One avatar system: every person shows their photo, else their own Luna,
-- else initials (src/features/avatar/UserAvatar.tsx).
--
-- 1. get_luna_loadouts(user_ids) — lets the app draw *other* people's Luna in
--    leaderboards, friend lists and Spaces. The social RPCs only return
--    avatar_url, and widening every one of them is a much bigger change; this
--    is one batched read instead. It returns cosmetic columns only (the same
--    class of data as avatar_url / display_name, which those RPCs already
--    expose to any signed-in user) and nothing else from profiles.
--    Depends on 20261010000000_profile_luna_loadout.sql (luna_loadout).
--
-- 2. Harden the public `avatars` bucket: raster images only (no SVG, which a
--    public bucket would serve as an active document) and a 2 MB cap. The
--    client re-encodes every upload to a 512px WebP first, so real uploads
--    are ~30-80 KB; the cap only stops direct API abuse. Existing objects are
--    untouched.

CREATE OR REPLACE FUNCTION public.get_luna_loadouts(p_user_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  luna_loadout jsonb,
  luna_suit_color text,
  luna_visor_tint text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.luna_loadout, p.luna_suit_color, p.luna_visor_tint
    FROM public.profiles p
   WHERE auth.uid() IS NOT NULL
     AND p.user_id = ANY (p_user_ids[1:200]);
$$;

-- Supabase's default privileges also grant EXECUTE to anon on new public
-- functions, which a REVOKE FROM PUBLIC does not remove — revoke it by name.
REVOKE ALL ON FUNCTION public.get_luna_loadouts(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_luna_loadouts(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_luna_loadouts(uuid[]) TO authenticated;

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/png'],
       file_size_limit = 2097152
 WHERE id = 'avatars';
