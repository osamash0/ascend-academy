-- Security fix (P0-1, docs/ROADMAP_10X_FOUNDATION.md §5): lock down three
-- SECURITY DEFINER RPCs that were reachable by anyone holding the public
-- Supabase anon key, verified against live source:
--
-- 1. public.reset_all_analytics() / public.restore_analytics(uuid)
--    (20260614000000_add_admin_role_and_error_logging.sql) shipped with NO
--    REVOKE, so Postgres's implicit default (EXECUTE granted to PUBLIC on
--    function creation) plus Supabase's own default-privilege grants to
--    `anon`/`authenticated` left them callable by any PostgREST client. Their
--    only guard, `IF auth.uid() IS NOT NULL AND NOT has_role(auth.uid(),
--    'admin') THEN RAISE`, is intentionally skipped when auth.uid() IS NULL —
--    that's correct for the trusted backend's service-role call
--    (backend/api/v1/admin.py's `require_admin`-gated route calls
--    `supabase_admin.rpc("reset_all_analytics")`, where auth.uid() is NULL
--    because the service-role key carries no user JWT claims) — but auth.uid()
--    is ALSO NULL for an anonymous PostgREST request with the public anon
--    key, so the same bypass let anyone wipe student_progress,
--    learning_events, visits, practice_attempts, achievements, notifications,
--    and zero every profile's XP with zero authentication.
--
--    Fix: REVOKE from PUBLIC/anon/authenticated so only the service role
--    (which the backend already gates behind `require_admin`) can call these
--    at all; the existing auth.uid()-IS-NULL guard behavior is left as-is
--    since it is now unreachable by anon/authenticated and correctly permits
--    the legitimate service-role path. `backend/core/database.py`'s
--    `supabase_admin` client authenticates with SUPABASE_SERVICE_ROLE_KEY,
--    which PostgREST maps to the Postgres `service_role` role — grant
--    EXECUTE to it explicitly rather than relying on whatever
--    platform-level default-privilege behavior a given project may or may
--    not have (the local test harness's bootstrap, for one, does not
--    blanket-grant function EXECUTE to service_role by default).
--
-- 2. public.increment_upload_quota(p_user_id, p_period, p_limit)
--    (20260710040000_student_uploads.sql) likewise shipped with no REVOKE and
--    trusts caller-supplied p_user_id/p_limit — a direct PostgREST call could
--    forge another user's quota or pass an inflated p_limit to bypass the
--    5/month cap. It is only ever called from the trusted backend over a
--    superuser asyncpg connection (backend/services/materials_service.py),
--    which REVOKE does not affect (superuser bypasses grants entirely) — so
--    locking out PUBLIC/anon/authenticated has no effect on the real caller.
--
-- 3. public.grant_xp(p_xp, p_reason, p_dedupe_key)
--    (20260616000000_gamification_engine.sql) already correctly REVOKEs from
--    PUBLIC and GRANTs only to `authenticated`, self-scoped via auth.uid() —
--    that part is fine and is the intended call path (gamification is
--    client-driven; src/services/gamificationService.ts calls this RPC
--    directly). But it had no cap on p_xp: an authenticated user could call
--    grant_xp(1000000, 'x') and inflate their own XP/level, poisoning the
--    leaderboard. Legitimate direct-client grants top out at 50
--    (course_created); the largest badge-bundled grant (via the internal
--    _grant_badge -> grant_xp call) is 500 (Polymath). Fix: cap at 500 and
--    reject negative/zero grants (no caller ever passes those).

-- ── 1. reset_all_analytics / restore_analytics: service-role only ──────────

REVOKE ALL ON FUNCTION public.reset_all_analytics() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_analytics(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_all_analytics() TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_analytics(UUID) TO service_role;

-- ── 2. increment_upload_quota: service-role only ────────────────────────────
-- (materials_service.py calls this over a superuser asyncpg connection, not
-- PostgREST, so the superuser bypasses grants entirely either way — this
-- GRANT covers any future/alternate caller that goes through PostgREST.)

REVOKE ALL ON FUNCTION public.increment_upload_quota(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_upload_quota(UUID, TEXT, INTEGER) TO service_role;

-- ── 3. grant_xp: add a hard cap so a client can't self-inflate XP ──────────

CREATE OR REPLACE FUNCTION public.grant_xp(
  p_xp         INTEGER,
  p_reason     TEXT,
  p_dedupe_key TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id   UUID := auth.uid();
  _inserted  INTEGER;
  _new_total INTEGER;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Hard cap: the largest legitimate single grant is a badge's bundled XP
  -- (max 500, seeded in badge_definitions); direct client grants are all
  -- <= 50. Anything above 500 can only be a forged/abusive call.
  IF p_xp <= 0 OR p_xp > 500 THEN
    RAISE EXCEPTION 'grant_xp: p_xp out of allowed range (1-500), got %', p_xp;
  END IF;

  -- A non-null dedupe_key makes the grant idempotent (one-time events / bonuses).
  INSERT INTO public.xp_events (user_id, xp, reason, dedupe_key)
  VALUES (_user_id, p_xp, p_reason, p_dedupe_key)
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS _inserted = ROW_COUNT;
  IF _inserted = 0 THEN
    RETURN;  -- duplicate one-time grant → no XP change
  END IF;

  UPDATE public.profiles
     SET total_xp = total_xp + p_xp
   WHERE user_id = _user_id
   RETURNING total_xp INTO _new_total;

  UPDATE public.profiles
     SET current_level = FLOOR(_new_total / 100) + 1
   WHERE user_id = _user_id;
END;
$$;

-- CREATE OR REPLACE preserves the function's existing ACL (REVOKE ALL FROM
-- PUBLIC + GRANT EXECUTE TO authenticated, set when it was first created in
-- 20260616000000) as long as the signature is unchanged, which it is here —
-- no fresh REVOKE/GRANT needed.
