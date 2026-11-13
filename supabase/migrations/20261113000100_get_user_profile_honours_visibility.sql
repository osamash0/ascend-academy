-- get_user_profile follows the person's "show me in Spaces" choice (LS-036).
--
-- Until now any signed-in account could call get_user_profile(<any uuid>) over
-- PostgREST and get that person's name, picture, institution, roles, XP and
-- streak, whatever they had chosen in Settings. 20261030000000_show_in_spaces
-- made being seen off by default and taught the v4 API and the classic
-- leaderboard to respect it; this function was missed.
--
-- Now a row comes back only when the caller may see that person, by the same
-- rule as backend/services/v4_spaces_service.py:
--   * it is the caller,
--   * the two are friends (an accepted request, a choice both made), or
--   * the person switched show_in_spaces on.
-- Plus one case the classic friend page (src/features/social/pages/
-- FriendProfile.tsx) needs to offer Accept/Decline: the person sent the caller
-- a request that is still open. Sending it was their own choice to be seen by
-- the caller, and get_friend_requests() already shows them that name and
-- picture. Anyone else gets no row, which the page shows as "could not be
-- found", so it does not even confirm the account exists.
--
-- Same signature and columns as 20260615000200, so callers and the generated
-- types are unchanged. Prod's migration ledger is unreliable: apply by hand
-- (docs/runbooks/apply-a-migration-by-hand.md), verify in pg_catalog.

CREATE OR REPLACE FUNCTION public.get_user_profile(p_user UUID)
RETURNS TABLE (
  user_id              UUID,
  display_name         TEXT,
  avatar_url           TEXT,
  institution          TEXT,
  social_roles         TEXT[],
  total_xp             INTEGER,
  weekly_xp            INTEGER,
  current_level        INTEGER,
  current_streak       INTEGER,
  active_today         BOOLEAN,
  relationship         TEXT,
  mutual_friends       INTEGER,
  mutual_courses       INTEGER,
  shared_courses       INTEGER,
  institution_verified BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.user_id, p.display_name, p.avatar_url, p.institution, p.social_roles,
    p.total_xp,
    COALESCE((SELECT SUM(e.xp)::INTEGER FROM public.xp_events e
              WHERE e.user_id = p.user_id AND e.created_at >= (now() - interval '7 days')), 0),
    p.current_level, p.current_streak, (p.last_active_date = current_date),
    public.relationship_status(auth.uid(), p.user_id),
    public.mutual_friends_count(auth.uid(), p.user_id),
    public.mutual_courses_count(auth.uid(), p.user_id),
    public.shared_catalog_courses_count(auth.uid(), p.user_id),
    COALESCE(p.institution_verified, FALSE)
  FROM public.profiles p
  WHERE p.user_id = p_user
    AND auth.uid() IS NOT NULL
    AND (
      p.user_id = auth.uid()
      OR p.show_in_spaces
      OR public.relationship_status(auth.uid(), p.user_id) IN ('friends', 'incoming')
    );
$$;

REVOKE ALL ON FUNCTION public.get_user_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_profile(UUID) TO authenticated;
