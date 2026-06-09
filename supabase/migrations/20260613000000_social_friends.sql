-- ============================================================================
-- Social Gamification backend
--   * profiles.institution + profiles.social_roles
--   * xp_events table + weekly-XP tracking (add_xp_to_user now logs events)
--   * friend_requests table (the friends graph) + RLS
--   * SECURITY DEFINER RPCs for all cross-user reads/writes
--       (profiles RLS stays "own row only" — same posture as get_public_leaderboard)
-- Idempotent: safe to re-run.
-- ============================================================================

-- Functions reference tables defined later in this same migration; defer body
-- validation so creation order doesn't matter (everything exists at runtime).
SET check_function_bodies = off;

-- ── Profile attributes ──────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS institution  TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS social_roles TEXT[] NOT NULL DEFAULT '{}';

-- Update only the social fields of the caller's own profile. XP/level/streak stay
-- locked behind their dedicated SECURITY DEFINER RPCs.
CREATE OR REPLACE FUNCTION public.set_my_social_profile(
  p_institution TEXT,
  p_social_roles TEXT[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  UPDATE public.profiles
     SET institution  = NULLIF(btrim(p_institution), ''),
         social_roles = COALESCE(p_social_roles, '{}')
   WHERE user_id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_social_profile(TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_social_profile(TEXT, TEXT[]) TO authenticated;

-- Convenience read for the signed-in user's social extras (not exposed by the
-- existing profile fetch).
CREATE OR REPLACE FUNCTION public.get_my_social_extras()
RETURNS TABLE (institution TEXT, social_roles TEXT[], weekly_xp INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.institution,
    p.social_roles,
    COALESCE((
      SELECT SUM(e.xp)::INTEGER FROM public.xp_events e
      WHERE e.user_id = auth.uid() AND e.created_at >= (now() - interval '7 days')
    ), 0) AS weekly_xp
  FROM public.profiles p
  WHERE p.user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.get_my_social_extras() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_social_extras() TO authenticated;

-- ── XP events ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xp_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  xp         INTEGER NOT NULL,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_xp_events_user_created
  ON public.xp_events (user_id, created_at DESC);

ALTER TABLE public.xp_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own xp events" ON public.xp_events;
CREATE POLICY "Users can view own xp events"
  ON public.xp_events FOR SELECT TO authenticated
  USING (user_id = auth.uid());
-- No direct INSERT/UPDATE/DELETE policy: events are written only by add_xp_to_user
-- (SECURITY DEFINER) so they cannot be forged.

-- Re-create add_xp_to_user to also log a timestamped event (preserves existing
-- total_xp / level behaviour).
CREATE OR REPLACE FUNCTION public.add_xp_to_user(p_xp INTEGER)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id     UUID := auth.uid();
  new_total_xp INTEGER;
  new_level    INTEGER;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.xp_events (user_id, xp) VALUES (_user_id, p_xp);

  UPDATE public.profiles
     SET total_xp = total_xp + p_xp
   WHERE user_id = _user_id
   RETURNING total_xp INTO new_total_xp;

  new_level := FLOOR(new_total_xp / 100) + 1;

  UPDATE public.profiles
     SET current_level = new_level
   WHERE user_id = _user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.add_xp_to_user(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_xp_to_user(INTEGER) TO authenticated;

-- Weekly XP total for the signed-in user.
CREATE OR REPLACE FUNCTION public.get_weekly_xp()
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(xp), 0)::INTEGER FROM public.xp_events
  WHERE user_id = auth.uid() AND created_at >= (now() - interval '7 days');
$$;
REVOKE ALL ON FUNCTION public.get_weekly_xp() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_weekly_xp() TO authenticated;

-- Per-day XP for the last 7 days (for the profile chart). Always returns 7 rows.
CREATE OR REPLACE FUNCTION public.get_weekly_xp_by_day()
RETURNS TABLE (day DATE, xp INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH days AS (
    SELECT (current_date - offs)::date AS day
    FROM generate_series(6, 0, -1) AS offs
  )
  SELECT d.day,
         COALESCE(SUM(e.xp), 0)::INTEGER AS xp
  FROM days d
  LEFT JOIN public.xp_events e
    ON e.user_id = auth.uid() AND e.created_at::date = d.day
  GROUP BY d.day
  ORDER BY d.day;
$$;
REVOKE ALL ON FUNCTION public.get_weekly_xp_by_day() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_weekly_xp_by_day() TO authenticated;

-- ── Friends graph ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.friend_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  addressee_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  CONSTRAINT friend_requests_no_self CHECK (requester_id <> addressee_id),
  CONSTRAINT friend_requests_unique_pair UNIQUE (requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS idx_friend_requests_addressee ON public.friend_requests (addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_requester ON public.friend_requests (requester_id, status);

ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;

-- Users may read only rows they participate in. All writes go through RPCs.
DROP POLICY IF EXISTS "Users can view own friend edges" ON public.friend_requests;
CREATE POLICY "Users can view own friend edges"
  ON public.friend_requests FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- Helper: the set of a user's accepted-friend user_ids.
CREATE OR REPLACE FUNCTION public.friend_ids_of(_uid UUID)
RETURNS TABLE (friend_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN requester_id = _uid THEN addressee_id ELSE requester_id END
  FROM public.friend_requests
  WHERE status = 'accepted' AND (_uid IN (requester_id, addressee_id));
$$;

-- Relationship status of the signed-in user toward another user.
CREATE OR REPLACE FUNCTION public.relationship_status(_me UUID, _other UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT CASE
             WHEN fr.status = 'accepted' THEN 'friends'
             WHEN fr.status = 'pending' AND fr.requester_id = _me THEN 'pending_outgoing'
             WHEN fr.status = 'pending' AND fr.addressee_id = _me THEN 'incoming'
             ELSE 'none'
           END
    FROM public.friend_requests fr
    WHERE (fr.requester_id = _me AND fr.addressee_id = _other)
       OR (fr.requester_id = _other AND fr.addressee_id = _me)
    ORDER BY (fr.status = 'accepted') DESC, fr.created_at DESC
    LIMIT 1
  ), 'none');
$$;

CREATE OR REPLACE FUNCTION public.mutual_friends_count(_me UUID, _other UUID)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM (
    SELECT friend_id FROM public.friend_ids_of(_me)
    INTERSECT
    SELECT friend_id FROM public.friend_ids_of(_other)
  ) m;
$$;

CREATE OR REPLACE FUNCTION public.mutual_courses_count(_me UUID, _other UUID)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM (
    SELECT course_id FROM public.course_enrollments WHERE user_id = _me
    INTERSECT
    SELECT course_id FROM public.course_enrollments WHERE user_id = _other
  ) c;
$$;

-- A reusable shape for a public social profile row.
-- (Returned by get_friends / search_users / get_user_profile.)

-- Send (or auto-accept reciprocal) a friend request.
CREATE OR REPLACE FUNCTION public.send_friend_request(p_addressee UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
  _reverse public.friend_requests%ROWTYPE;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _me = p_addressee THEN RAISE EXCEPTION 'Cannot friend yourself'; END IF;

  -- If they already sent ME a pending request, accept it instead.
  SELECT * INTO _reverse FROM public.friend_requests
   WHERE requester_id = p_addressee AND addressee_id = _me AND status = 'pending';
  IF FOUND THEN
    UPDATE public.friend_requests SET status = 'accepted', responded_at = now()
     WHERE id = _reverse.id;
    RETURN 'friends';
  END IF;

  -- Otherwise create / revive my outgoing request.
  INSERT INTO public.friend_requests (requester_id, addressee_id, status)
  VALUES (_me, p_addressee, 'pending')
  ON CONFLICT (requester_id, addressee_id)
  DO UPDATE SET status = 'pending', created_at = now(), responded_at = NULL
  WHERE public.friend_requests.status <> 'accepted';

  RETURN 'pending_outgoing';
END;
$$;
REVOKE ALL ON FUNCTION public.send_friend_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_friend_request(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_friend_request(p_requester UUID, p_accept BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.friend_requests
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         responded_at = now()
   WHERE requester_id = p_requester AND addressee_id = _me AND status = 'pending';
  RETURN CASE WHEN p_accept THEN 'friends' ELSE 'none' END;
END;
$$;
REVOKE ALL ON FUNCTION public.respond_friend_request(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(UUID, BOOLEAN) TO authenticated;

-- Cancel an outgoing pending request (deletes the edge).
CREATE OR REPLACE FUNCTION public.cancel_friend_request(p_addressee UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _me UUID := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  DELETE FROM public.friend_requests
   WHERE requester_id = _me AND addressee_id = p_addressee AND status = 'pending';
  RETURN 'none';
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_friend_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_friend_request(UUID) TO authenticated;

-- Remove an existing friend (deletes the accepted edge in either direction).
CREATE OR REPLACE FUNCTION public.remove_friend(p_user UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _me UUID := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  DELETE FROM public.friend_requests
   WHERE status = 'accepted'
     AND ((requester_id = _me AND addressee_id = p_user)
       OR (requester_id = p_user AND addressee_id = _me));
  RETURN 'none';
END;
$$;
REVOKE ALL ON FUNCTION public.remove_friend(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_friend(UUID) TO authenticated;

-- The signed-in user's friends (rich profile data for lists + friends leaderboard).
CREATE OR REPLACE FUNCTION public.get_friends()
RETURNS TABLE (
  user_id      UUID,
  display_name TEXT,
  avatar_url   TEXT,
  institution  TEXT,
  social_roles TEXT[],
  total_xp     INTEGER,
  weekly_xp    INTEGER,
  current_level INTEGER,
  current_streak INTEGER,
  active_today BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.user_id,
    p.display_name,
    p.avatar_url,
    p.institution,
    p.social_roles,
    p.total_xp,
    COALESCE((SELECT SUM(e.xp)::INTEGER FROM public.xp_events e
              WHERE e.user_id = p.user_id AND e.created_at >= (now() - interval '7 days')), 0),
    p.current_level,
    p.current_streak,
    (p.last_active_date = current_date)
  FROM public.friend_ids_of(auth.uid()) f
  JOIN public.profiles p ON p.user_id = f.friend_id
  ORDER BY p.total_xp DESC;
$$;
REVOKE ALL ON FUNCTION public.get_friends() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_friends() TO authenticated;

-- Pending friend requests involving the signed-in user (both directions).
CREATE OR REPLACE FUNCTION public.get_friend_requests()
RETURNS TABLE (
  user_id         UUID,
  display_name    TEXT,
  avatar_url      TEXT,
  institution     TEXT,
  social_roles    TEXT[],
  total_xp        INTEGER,
  current_level   INTEGER,
  active_today    BOOLEAN,
  direction       TEXT,          -- 'incoming' | 'outgoing'
  mutual_friends  INTEGER,
  mutual_courses  INTEGER,
  created_at      TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    other.user_id, other.display_name, other.avatar_url, other.institution,
    other.social_roles, other.total_xp, other.current_level,
    (other.last_active_date = current_date),
    CASE WHEN fr.addressee_id = auth.uid() THEN 'incoming' ELSE 'outgoing' END,
    public.mutual_friends_count(auth.uid(), other.user_id),
    public.mutual_courses_count(auth.uid(), other.user_id),
    fr.created_at
  FROM public.friend_requests fr
  JOIN public.profiles other
    ON other.user_id = CASE WHEN fr.requester_id = auth.uid()
                            THEN fr.addressee_id ELSE fr.requester_id END
  WHERE fr.status = 'pending'
    AND (fr.requester_id = auth.uid() OR fr.addressee_id = auth.uid())
  ORDER BY fr.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_friend_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_friend_requests() TO authenticated;

-- Discover users (search). Excludes the caller. Returns relationship + mutual data.
CREATE OR REPLACE FUNCTION public.search_users(
  p_query       TEXT DEFAULT '',
  p_institution TEXT DEFAULT NULL,
  p_role        TEXT DEFAULT NULL,
  p_common_only BOOLEAN DEFAULT FALSE,
  p_limit       INTEGER DEFAULT 50
)
RETURNS TABLE (
  user_id        UUID,
  display_name   TEXT,
  avatar_url     TEXT,
  institution    TEXT,
  social_roles   TEXT[],
  total_xp       INTEGER,
  current_level  INTEGER,
  active_today   BOOLEAN,
  relationship   TEXT,
  mutual_friends INTEGER,
  mutual_courses INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.user_id, p.display_name, p.avatar_url, p.institution, p.social_roles,
    p.total_xp, p.current_level, (p.last_active_date = current_date),
    public.relationship_status(auth.uid(), p.user_id),
    public.mutual_friends_count(auth.uid(), p.user_id),
    public.mutual_courses_count(auth.uid(), p.user_id)
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'student'
  WHERE p.user_id <> auth.uid()
    AND (COALESCE(btrim(p_query), '') = ''
         OR p.display_name ILIKE '%' || p_query || '%'
         OR p.institution  ILIKE '%' || p_query || '%')
    AND (p_institution IS NULL OR p.institution = p_institution)
    AND (p_role IS NULL OR p_role = ANY (p.social_roles))
    AND (NOT p_common_only OR public.mutual_courses_count(auth.uid(), p.user_id) > 0)
  ORDER BY public.mutual_friends_count(auth.uid(), p.user_id) DESC, p.total_xp DESC
  LIMIT LEAST(p_limit, 100);
$$;
REVOKE ALL ON FUNCTION public.search_users(TEXT, TEXT, TEXT, BOOLEAN, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_users(TEXT, TEXT, TEXT, BOOLEAN, INTEGER) TO authenticated;

-- A single user's public profile + relationship for the friend-profile page.
CREATE OR REPLACE FUNCTION public.get_user_profile(p_user UUID)
RETURNS TABLE (
  user_id        UUID,
  display_name   TEXT,
  avatar_url     TEXT,
  institution    TEXT,
  social_roles   TEXT[],
  total_xp       INTEGER,
  weekly_xp      INTEGER,
  current_level  INTEGER,
  current_streak INTEGER,
  active_today   BOOLEAN,
  relationship   TEXT,
  mutual_friends INTEGER,
  mutual_courses INTEGER
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
    public.mutual_courses_count(auth.uid(), p.user_id)
  FROM public.profiles p
  WHERE p.user_id = p_user;
$$;
REVOKE ALL ON FUNCTION public.get_user_profile(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_profile(UUID) TO authenticated;

-- Courses a given user is enrolled in (titles), for profile course lists.
CREATE OR REPLACE FUNCTION public.get_user_courses(p_user UUID)
RETURNS TABLE (course_id UUID, title TEXT, mutual BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.id, c.title,
         EXISTS (SELECT 1 FROM public.course_enrollments me
                 WHERE me.user_id = auth.uid() AND me.course_id = c.id)
  FROM public.course_enrollments ce
  JOIN public.courses c ON c.id = ce.course_id
  WHERE ce.user_id = p_user
  ORDER BY c.title;
$$;
REVOKE ALL ON FUNCTION public.get_user_courses(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_courses(UUID) TO authenticated;

-- Global leaderboard keyed by user_id (consistent with the rest of the social
-- feature), with weekly XP + social fields. Includes the caller.
CREATE OR REPLACE FUNCTION public.get_global_leaderboard(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  user_id        UUID,
  display_name   TEXT,
  avatar_url     TEXT,
  institution    TEXT,
  social_roles   TEXT[],
  total_xp       INTEGER,
  weekly_xp      INTEGER,
  current_level  INTEGER,
  current_streak INTEGER,
  active_today   BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.user_id, p.display_name, p.avatar_url, p.institution, p.social_roles, p.total_xp,
    COALESCE((SELECT SUM(e.xp)::INTEGER FROM public.xp_events e
              WHERE e.user_id = p.user_id AND e.created_at >= (now() - interval '7 days')), 0),
    p.current_level, p.current_streak, (p.last_active_date = current_date)
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'student'
  ORDER BY p.total_xp DESC
  LIMIT LEAST(p_limit, 100);
$$;
REVOKE ALL ON FUNCTION public.get_global_leaderboard(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_global_leaderboard(INTEGER) TO authenticated;

-- ── One-click demo network bootstrap ──────────────────────────────────────────
-- Wires the seeded demo peers to the signed-in user (friends + a couple of
-- pending requests) so the experience is populated. No-op if the user already
-- has any friend edges. All rows are REAL; the user can act on them normally.
CREATE OR REPLACE FUNCTION public.bootstrap_demo_friends()
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
  _existing INTEGER;
  _uid UUID;
  _friends TEXT[] := ARRAY['layla','jonas','sofia','mateo','hannah'];
  _incoming TEXT[] := ARRAY['emma','noah'];
  _slug TEXT;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT COUNT(*) INTO _existing FROM public.friend_requests
   WHERE requester_id = _me OR addressee_id = _me;
  IF _existing > 0 THEN RETURN 'skipped'; END IF;

  -- accepted friendships
  FOREACH _slug IN ARRAY _friends LOOP
    SELECT user_id INTO _uid FROM public.profiles WHERE email = _slug || '@learnstation-demo.com';
    IF _uid IS NOT NULL THEN
      INSERT INTO public.friend_requests (requester_id, addressee_id, status, responded_at)
      VALUES (_uid, _me, 'accepted', now())
      ON CONFLICT (requester_id, addressee_id) DO NOTHING;
    END IF;
  END LOOP;

  -- incoming pending requests (peer -> me)
  FOREACH _slug IN ARRAY _incoming LOOP
    SELECT user_id INTO _uid FROM public.profiles WHERE email = _slug || '@learnstation-demo.com';
    IF _uid IS NOT NULL THEN
      INSERT INTO public.friend_requests (requester_id, addressee_id, status)
      VALUES (_uid, _me, 'pending')
      ON CONFLICT (requester_id, addressee_id) DO NOTHING;
    END IF;
  END LOOP;

  -- one outgoing pending (me -> yuki)
  SELECT user_id INTO _uid FROM public.profiles WHERE email = 'yuki@learnstation-demo.com';
  IF _uid IS NOT NULL THEN
    INSERT INTO public.friend_requests (requester_id, addressee_id, status)
    VALUES (_me, _uid, 'pending')
    ON CONFLICT (requester_id, addressee_id) DO NOTHING;
  END IF;

  RETURN 'seeded';
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_demo_friends() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_demo_friends() TO authenticated;
