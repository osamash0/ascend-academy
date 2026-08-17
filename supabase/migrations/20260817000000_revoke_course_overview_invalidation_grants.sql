-- S-1 follow-up: revoke default PUBLIC EXECUTE on the course-overview cache
-- invalidation functions.
--
-- These four SECURITY DEFINER functions were introduced by
-- 20260503000020_invalidate_course_overview_triggers.sql (since renamed to
-- ...023 to repair a timestamp collision) without an explicit grant. Postgres
-- grants EXECUTE to PUBLIC by default on function creation, so they have been
-- reachable with the public anon key over PostgREST ever since.
--
-- Three of them RETURN trigger, which PostgREST will not expose as an RPC, so
-- they were never callable in practice. They are revoked here anyway so the
-- ACL states the intent instead of depending on a client-library property.
--
-- `_invalidate_course_overview(uuid)` is the one that actually mattered: it
-- takes a uuid and returns void, so any anon caller could evict an arbitrary
-- course's cached `professor_overview` row -- an unauthenticated cache-busting
-- lever against the analytics layer. Only the trigger functions call it, and
-- they execute as their own definer, so no role needs EXECUTE.
--
-- The grants were also added to ...023 itself, which is what a fresh database
-- replays. This migration is the forward fix for databases that already
-- applied the original file and will therefore never re-run it.

REVOKE ALL ON FUNCTION public._invalidate_course_overview(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_course_overview_on_lecture() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_course_overview_on_slide() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_course_overview_on_quiz() FROM PUBLIC, anon, authenticated;
