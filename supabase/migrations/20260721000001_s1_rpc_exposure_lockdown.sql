-- S-1 (docs/ROADMAP_10X_FOUNDATION.md §14): systematic PostgREST/RPC exposure
-- audit. Full inventory: docs/RPC_EXPOSURE_AUDIT.md. P0-1 (already fixed on
-- fix/p0-security-rpc-lockdown) locked down the three worst-known instances
-- (reset_all_analytics/restore_analytics/increment_upload_quota, plus a
-- grant_xp cap). This migration locks down the NEW genuine findings the
-- systematic pass surfaced beyond those three: five social-graph helper
-- functions that leak PII to an unauthenticated caller, and four RLS-helper
-- functions that were reachable by `anon` for no legitimate reason.
--
-- ── Finding A (real PII leak, verified against a real local Postgres) ──────
--
-- friend_ids_of(uuid), relationship_status(uuid,uuid),
-- mutual_friends_count(uuid,uuid), mutual_courses_count(uuid,uuid), and
-- shared_catalog_courses_count(uuid,uuid) (20260613000000_social_friends.sql,
-- 20260615000200_academic_personalization.sql) are SECURITY DEFINER helpers
-- with NO REVOKE anywhere in the migration chain — Postgres's implicit
-- EXECUTE-to-PUBLIC default left them directly callable over PostgREST with
-- the public anon key. Unlike `get_friends()` / `search_users()` (which
-- correctly scope every row to `auth.uid()`), these five take an arbitrary
-- caller-supplied uuid and return raw social-graph data for THAT user,
-- with no ownership check at all.
--
-- Verified live (see backend/tests/db/test_s1_rpc_exposure_lockdown.py and
-- the manual pre-fix repro run against a real local Postgres 18 instance
-- during this audit): seeding two users with an accepted friend_requests row
-- and then, as the `anon` role with zero JWT claims,
-- `SELECT * FROM friend_ids_of('<victim-uuid>')` returned the victim's real
-- friend's uuid, and `relationship_status(victim, friend)` returned
-- 'friends' — a complete, unauthenticated social-graph read for any known or
-- guessed user id, with no rate limit or ownership check.
--
-- grep across src/ and backend/ confirms these five are NEVER called
-- directly by any client — they exist purely as internal building blocks
-- for get_friends() / search_users() / get_user_profile(), which are
-- themselves SECURITY DEFINER and therefore execute (and call these helpers)
-- as their *owner*, not as the original caller — so revoking
-- PUBLIC/anon/authenticated here does not affect any real call path.
--
-- ── Finding B (unnecessary anon reachability of RLS helpers) ────────────────
--
-- has_role(uuid, app_role), assignment_owner_id(uuid), course_professor_id
-- (uuid), and lecture_visible_to_caller(uuid) are SECURITY DEFINER helpers
-- used inside `USING`/`WITH CHECK` clauses of RLS policies to break policy
-- recursion (see docs/ROADMAP_10X_FOUNDATION.md §2). Every policy that
-- references them is scoped `TO authenticated` (confirmed:
-- `grep -n 'TO anon' supabase/migrations/*.sql` matches only the storage
-- bucket policies, never a public-schema table) — so `authenticated` must
-- keep EXECUTE (policy evaluation runs as the querying role, not the
-- function owner, for a plain USING-clause call), but there is no
-- legitimate reason for `anon`/PUBLIC to be able to call them directly.
-- Impact if left open: `anon` can call e.g. `assignment_owner_id(<uuid>)` or
-- `has_role(<uuid>, 'admin')` directly over PostgREST and get a raw
-- true/false or ownership-uuid answer for any id it can guess or enumerate —
-- a low-severity but real oracle. Tighten to `authenticated`-only.

-- ── Finding A: revoke entirely — no client ever calls these directly ───────

REVOKE ALL ON FUNCTION public.friend_ids_of(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.relationship_status(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mutual_friends_count(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mutual_courses_count(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shared_catalog_courses_count(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── Finding B: tighten to authenticated-only (drop anon/PUBLIC reachability) ─

REVOKE ALL ON FUNCTION public.has_role(UUID, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.assignment_owner_id(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assignment_owner_id(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.course_professor_id(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.course_professor_id(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.lecture_visible_to_caller(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lecture_visible_to_caller(UUID) TO authenticated, service_role;

-- has_role/assignment_owner_id/course_professor_id/lecture_visible_to_caller
-- also need to remain callable by the function owner (postgres/supabase_admin)
-- for RLS evaluation on behalf of service_role queries and internal use by
-- other SECURITY DEFINER functions; superuser/owner execution is never
-- affected by REVOKE, so no additional grant is required for that path.
