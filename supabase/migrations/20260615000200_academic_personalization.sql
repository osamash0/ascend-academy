-- ============================================================================
-- Phase 2 — personalization powered by the academic fingerprint.
--   * shared_catalog_courses_count() helper
--   * academic-aware search_users (scores shared catalog courses + same
--       program/faculty + near semester, on top of mutual friends + XP)
--   * get_friend_suggestions() — "Suggested for you" (excludes existing edges)
--   * institution_verified surfaced on the social read RPCs (verified badge)
--   * structured cohort fields on get_global_leaderboard (client-side filtering
--       by university / faculty / semester / verified)
-- Recreates several RPCs from 20260613000000 with added OUT columns, so each is
-- DROPped first (Postgres requires it for a return-type change).
-- Idempotent.
-- ============================================================================

SET check_function_bodies = off;

-- Count of catalog courses two users have in common (academic affinity signal).
CREATE OR REPLACE FUNCTION public.shared_catalog_courses_count(_me UUID, _other UUID)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM (
    SELECT catalog_course_id FROM public.student_catalog_courses WHERE user_id = _me
    INTERSECT
    SELECT catalog_course_id FROM public.student_catalog_courses WHERE user_id = _other
  ) s;
$$;

-- ── search_users: now academic-aware ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.search_users(TEXT, TEXT, TEXT, BOOLEAN, INTEGER);
CREATE OR REPLACE FUNCTION public.search_users(
  p_query       TEXT DEFAULT '',
  p_institution TEXT DEFAULT NULL,
  p_role        TEXT DEFAULT NULL,
  p_common_only BOOLEAN DEFAULT FALSE,
  p_limit       INTEGER DEFAULT 50
)
RETURNS TABLE (
  user_id              UUID,
  display_name         TEXT,
  avatar_url           TEXT,
  institution          TEXT,
  social_roles         TEXT[],
  total_xp             INTEGER,
  current_level        INTEGER,
  active_today         BOOLEAN,
  relationship         TEXT,
  mutual_friends       INTEGER,
  mutual_courses       INTEGER,
  shared_courses       INTEGER,
  institution_verified BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH me AS (
    SELECT degree_program_id, faculty_id, current_semester
    FROM public.profiles WHERE user_id = auth.uid()
  )
  SELECT
    p.user_id, p.display_name, p.avatar_url, p.institution, p.social_roles,
    p.total_xp, p.current_level, (p.last_active_date = current_date),
    public.relationship_status(auth.uid(), p.user_id),
    public.mutual_friends_count(auth.uid(), p.user_id),
    public.mutual_courses_count(auth.uid(), p.user_id),
    public.shared_catalog_courses_count(auth.uid(), p.user_id),
    COALESCE(p.institution_verified, FALSE)
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'student'
  CROSS JOIN me
  WHERE p.user_id <> auth.uid()
    AND (COALESCE(btrim(p_query), '') = ''
         OR p.display_name ILIKE '%' || p_query || '%'
         OR p.institution  ILIKE '%' || p_query || '%')
    AND (p_institution IS NULL OR p.institution = p_institution)
    AND (p_role IS NULL OR p_role = ANY (p.social_roles))
    AND (NOT p_common_only OR public.mutual_courses_count(auth.uid(), p.user_id) > 0)
  ORDER BY
    (public.shared_catalog_courses_count(auth.uid(), p.user_id) * 3
     + CASE WHEN me.degree_program_id IS NOT NULL
                 AND p.degree_program_id IS NOT DISTINCT FROM me.degree_program_id THEN 5 ELSE 0 END
     + CASE WHEN me.faculty_id IS NOT NULL
                 AND p.faculty_id IS NOT DISTINCT FROM me.faculty_id THEN 2 ELSE 0 END
     + CASE WHEN me.current_semester IS NOT NULL AND p.current_semester IS NOT NULL
                 AND abs(p.current_semester - me.current_semester) <= 1 THEN 2 ELSE 0 END
     + public.mutual_friends_count(auth.uid(), p.user_id)) DESC,
    p.total_xp DESC
  LIMIT LEAST(p_limit, 100);
$$;
REVOKE ALL ON FUNCTION public.search_users(TEXT, TEXT, TEXT, BOOLEAN, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_users(TEXT, TEXT, TEXT, BOOLEAN, INTEGER) TO authenticated;

-- ── get_friend_suggestions: "Suggested for you" ──────────────────────────────
-- Students the caller isn't already connected to (no edge in either direction),
-- ranked by academic affinity + mutual friends. Never empty when peers exist.
CREATE OR REPLACE FUNCTION public.get_friend_suggestions(p_limit INTEGER DEFAULT 12)
RETURNS TABLE (
  user_id              UUID,
  display_name         TEXT,
  avatar_url           TEXT,
  institution          TEXT,
  social_roles         TEXT[],
  total_xp             INTEGER,
  current_level        INTEGER,
  active_today         BOOLEAN,
  relationship         TEXT,
  mutual_friends       INTEGER,
  mutual_courses       INTEGER,
  shared_courses       INTEGER,
  institution_verified BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH me AS (
    SELECT degree_program_id, faculty_id, current_semester
    FROM public.profiles WHERE user_id = auth.uid()
  )
  SELECT
    p.user_id, p.display_name, p.avatar_url, p.institution, p.social_roles,
    p.total_xp, p.current_level, (p.last_active_date = current_date),
    'none'::TEXT,
    public.mutual_friends_count(auth.uid(), p.user_id),
    public.mutual_courses_count(auth.uid(), p.user_id),
    public.shared_catalog_courses_count(auth.uid(), p.user_id),
    COALESCE(p.institution_verified, FALSE)
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'student'
  CROSS JOIN me
  WHERE p.user_id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.friend_requests fr
      WHERE (fr.requester_id = auth.uid() AND fr.addressee_id = p.user_id)
         OR (fr.requester_id = p.user_id AND fr.addressee_id = auth.uid())
    )
  ORDER BY
    (public.shared_catalog_courses_count(auth.uid(), p.user_id) * 3
     + CASE WHEN me.degree_program_id IS NOT NULL
                 AND p.degree_program_id IS NOT DISTINCT FROM me.degree_program_id THEN 5 ELSE 0 END
     + CASE WHEN me.faculty_id IS NOT NULL
                 AND p.faculty_id IS NOT DISTINCT FROM me.faculty_id THEN 2 ELSE 0 END
     + CASE WHEN me.current_semester IS NOT NULL AND p.current_semester IS NOT NULL
                 AND abs(p.current_semester - me.current_semester) <= 1 THEN 2 ELSE 0 END
     + public.mutual_friends_count(auth.uid(), p.user_id)) DESC,
    p.total_xp DESC
  LIMIT LEAST(p_limit, 50);
$$;
REVOKE ALL ON FUNCTION public.get_friend_suggestions(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_friend_suggestions(INTEGER) TO authenticated;

-- ── get_global_leaderboard: add verified + cohort fields (client-side filter) ─
DROP FUNCTION IF EXISTS public.get_global_leaderboard(INTEGER);
CREATE OR REPLACE FUNCTION public.get_global_leaderboard(p_limit INTEGER DEFAULT 50)
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
  institution_verified BOOLEAN,
  university_id        UUID,
  university_name      TEXT,
  faculty_id           UUID,
  faculty_name         TEXT,
  current_semester     INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
  ORDER BY p.total_xp DESC
  LIMIT LEAST(p_limit, 100);
$$;
REVOKE ALL ON FUNCTION public.get_global_leaderboard(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_global_leaderboard(INTEGER) TO authenticated;

-- ── get_friends / get_user_profile: surface institution_verified ─────────────
DROP FUNCTION IF EXISTS public.get_friends();
CREATE OR REPLACE FUNCTION public.get_friends()
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
  institution_verified BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.user_id, p.display_name, p.avatar_url, p.institution, p.social_roles, p.total_xp,
    COALESCE((SELECT SUM(e.xp)::INTEGER FROM public.xp_events e
              WHERE e.user_id = p.user_id AND e.created_at >= (now() - interval '7 days')), 0),
    p.current_level, p.current_streak, (p.last_active_date = current_date),
    COALESCE(p.institution_verified, FALSE)
  FROM public.friend_ids_of(auth.uid()) fr
  JOIN public.profiles p ON p.user_id = fr.friend_id
  ORDER BY p.total_xp DESC;
$$;
REVOKE ALL ON FUNCTION public.get_friends() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_friends() TO authenticated;

DROP FUNCTION IF EXISTS public.get_user_profile(UUID);
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
  WHERE p.user_id = p_user;
$$;
REVOKE ALL ON FUNCTION public.get_user_profile(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_profile(UUID) TO authenticated;
