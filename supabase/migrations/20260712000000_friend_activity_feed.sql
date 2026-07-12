-- Friend activity feed: recent badges earned + exams completed by a user's
-- accepted friends. Source tables (achievements, exam_attempts) are RLS'd
-- own-row-only, so this reads cross-user data the same way every other
-- social RPC does (get_friends, get_global_leaderboard) — SECURITY DEFINER,
-- explicit REVOKE/GRANT, joined through friend_ids_of(auth.uid()).
CREATE OR REPLACE FUNCTION public.get_friend_activity(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  event_type        TEXT,
  user_id           UUID,
  display_name      TEXT,
  avatar_url        TEXT,
  badge_key         TEXT,
  badge_display_name TEXT,
  badge_icon        TEXT,
  course_title      TEXT,
  score             REAL,
  created_at        TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM (
    SELECT
      'badge'::TEXT AS event_type,
      a.user_id,
      p.display_name,
      p.avatar_url,
      a.badge_name AS badge_key,
      bd.name AS badge_display_name,
      a.badge_icon,
      NULL::TEXT AS course_title,
      NULL::REAL AS score,
      a.earned_at AS created_at
    FROM public.achievements a
    JOIN public.friend_ids_of(auth.uid()) f ON f.friend_id = a.user_id
    JOIN public.profiles p ON p.user_id = a.user_id
    LEFT JOIN public.badge_definitions bd ON bd.key = a.badge_name

    UNION ALL

    SELECT
      'exam'::TEXT AS event_type,
      ea.user_id,
      p.display_name,
      p.avatar_url,
      NULL::TEXT AS badge_key,
      NULL::TEXT AS badge_display_name,
      NULL::TEXT AS badge_icon,
      c.title AS course_title,
      ea.score,
      ea.submitted_at AS created_at
    FROM public.exam_attempts ea
    JOIN public.friend_ids_of(auth.uid()) f ON f.friend_id = ea.user_id
    JOIN public.profiles p ON p.user_id = ea.user_id
    JOIN public.courses c ON c.id = ea.course_id
    WHERE ea.submitted_at IS NOT NULL
  ) feed
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.get_friend_activity(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_friend_activity(INTEGER) TO authenticated;
