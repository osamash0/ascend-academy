-- ============================================================================
-- Surface institution_verified (+ shared catalog courses) on get_friend_requests
-- so the verified badge + academic affinity show on friend-request cards too.
-- Recreates the function (return-type change → DROP first). Idempotent.
-- ============================================================================

SET check_function_bodies = off;

DROP FUNCTION IF EXISTS public.get_friend_requests();
CREATE OR REPLACE FUNCTION public.get_friend_requests()
RETURNS TABLE (
  user_id              UUID,
  display_name         TEXT,
  avatar_url           TEXT,
  institution          TEXT,
  social_roles         TEXT[],
  total_xp             INTEGER,
  current_level        INTEGER,
  active_today         BOOLEAN,
  direction            TEXT,
  mutual_friends       INTEGER,
  mutual_courses       INTEGER,
  shared_courses       INTEGER,
  institution_verified BOOLEAN,
  created_at           TIMESTAMPTZ
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
    public.shared_catalog_courses_count(auth.uid(), other.user_id),
    COALESCE(other.institution_verified, FALSE),
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
