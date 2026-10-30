-- LS-036: people choose whether the people in their Spaces see them.
--
-- Until now joining a Space put your name, picture and XP in the ranking of
-- everyone who shared any Space with you, and your face on its card. Public
-- Spaces can be joined by anyone, so that was "made accessible to an
-- indefinite number of people" without the person doing anything, which
-- Art. 25(2) GDPR rules out as a default. Now it is off until switched on in
-- Settings. Friends (an accepted request, a choice both made) always see each
-- other; the API applies that rule (backend/services/v4_spaces_service.py).
--
-- Prod's migration ledger is unreliable: apply by hand, verify in pg_catalog.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS show_in_spaces boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.show_in_spaces IS
    'Off by default (Art. 25(2) GDPR). On: the people in the owner''s Spaces see their name, picture and XP in rankings and on Space cards. Friends see each other either way.';

-- The classic platform-wide list (the classic /leaderboard, only reachable
-- with v4 off) lists only people who switched it on.
CREATE OR REPLACE FUNCTION public.get_global_leaderboard(p_limit integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text, institution text, social_roles text[], total_xp integer, weekly_xp integer, current_level integer, current_streak integer, active_today boolean, institution_verified boolean, university_id uuid, university_name text, faculty_id uuid, faculty_name text, current_semester integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id, p.display_name, p.avatar_url, p.institution, p.social_roles, p.total_xp,
    COALESCE((SELECT SUM(e.xp)::INTEGER FROM public.xp_events e
              WHERE e.user_id = p.user_id AND e.created_at >= (now() - interval '7 days')), 0),
    p.current_level, p.current_streak, (p.last_active_date = current_date),
    COALESCE(p.institution_verified, FALSE),
    p.university_id, u.name, p.faculty_id, f.name, p.current_semester
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'student'
  LEFT JOIN public.universities u ON u.id = p.university_id
  LEFT JOIN public.faculties f ON f.id = p.faculty_id
  WHERE p.show_in_spaces
  ORDER BY p.total_xp DESC
  LIMIT LEAST(p_limit, 100);
$function$;

REVOKE ALL ON FUNCTION public.get_global_leaderboard(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_global_leaderboard(INTEGER) TO authenticated;
