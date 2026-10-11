-- ─────────────────────────────────────────────────────────────────────────────
-- Revoke anon EXECUTE on every SECURITY DEFINER function in public.
--
-- Supabase's default privileges grant EXECUTE on each new public function
-- DIRECTLY to anon, authenticated and service_role. Our migrations mostly did
-- `REVOKE ALL ... FROM PUBLIC`, which removes the PUBLIC grant but leaves the
-- direct anon (and authenticated) grants in place. A 2026-10-11 probe of prod
-- found 42 SECURITY DEFINER functions anon could call. CI never saw it because
-- the test bootstrap had no such defaults; it does now, and
-- backend/tests/db/test_anon_security_definer_exposure.py asserts the result.
--
-- Nothing in the app calls one of these before sign-in (the catalog lookups
-- in academicService run only on ProtectedRoute pages), so none stay public.
--
-- Every statement goes through to_regprocedure(): prod and the migration set
-- have drifted (some functions exist only on one side), and a revoke on a
-- missing function must be a no-op, not an error.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION pg_temp.revoke_exec(p_signatures text[], p_roles text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  _sig text;
  _fn  regprocedure;
BEGIN
  FOREACH _sig IN ARRAY p_signatures LOOP
    _fn := to_regprocedure(_sig);
    IF _fn IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %s', _fn, p_roles);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.grant_exec(p_signatures text[], p_role text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  _sig text;
  _fn  regprocedure;
BEGIN
  FOREACH _sig IN ARRAY p_signatures LOOP
    _fn := to_regprocedure(_sig);
    IF _fn IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s', _fn, p_role);
    END IF;
  END LOOP;
END;
$$;

-- ── 1. Real vulnerability: write any user's XP / streak ─────────────────────
-- The original 2026-01 overloads take a caller-supplied user id and have no
-- auth.uid() check. On prod they were still executable via PUBLIC, so anyone
-- holding the anon key could add unlimited XP to, or reset the streak of, any
-- user. Signed-in users could do the same, so authenticated loses them too.
-- No code calls these overloads; the app uses the self-scoped
-- add_xp_to_user(int) / update_user_streak(bool) / grant_xp instead.
SELECT pg_temp.revoke_exec(ARRAY[
  'public.add_xp_to_user(uuid, integer)',
  'public.update_user_streak(uuid, boolean)'
], 'PUBLIC, anon, authenticated');

-- ── 2. Internal helpers that must not be called directly by any client ──────
-- _grant_badge takes a caller-supplied user id; it is only meant to run inside
-- award_badge / evaluate_badges (SECURITY DEFINER, so they run as owner and
-- need no grant). Its migration revoked PUBLIC but never authenticated, so any
-- signed-in user could award any badge (and its XP) to any account.
-- The learning_events partition functions are service_role-only by design
-- (backend/scripts/learning_events_retention.py) and include a DROP.
SELECT pg_temp.revoke_exec(ARRAY[
  'public._grant_badge(uuid, text)',
  'public.ensure_learning_events_partition(date)',
  'public.list_learning_events_partitions_older_than(integer)',
  'public.archive_learning_events_partition_to_rollup(text)',
  'public.drop_learning_events_partition(text)'
], 'PUBLIC, anon, authenticated');

-- ── 3. Trigger functions ─────────────────────────────────────────────────────
-- Postgres checks EXECUTE only when a trigger is created, never when it
-- fires, so no client role needs to call these. authenticated is left alone
-- to keep this change to the anon surface.
SELECT pg_temp.revoke_exec(ARRAY[
  'public.handle_new_user()',
  'public.handle_new_better_auth_user()',
  'public.enforce_assignment_lecture_ownership()',
  'public.invalidate_analytics_cache_on_event()',
  'public.invalidate_analytics_cache_on_progress()',
  'public.purge_backend_cache_on_role_change()'
], 'PUBLIC, anon');

-- ── 4. Signed-in RPCs (guarded or self-scoped by auth.uid()) ────────────────
-- Each either raises 'Not authenticated' when auth.uid() IS NULL or filters on
-- auth.uid() and so returns/changes nothing for anon. The anon grant is
-- harmless today but one edit away from a hole, so it goes. authenticated is
-- granted explicitly first so revoking PUBLIC can never strip the real caller.
-- Includes the catalog lookups (get_universities, get_faculties,
-- get_degree_programs, get_suggested_courses): unguarded but read-only public
-- reference data, and only used on signed-in pages (Onboarding, Ascent's
-- AcademicProfileEditor).
DO $$
DECLARE
  _signed_in text[] := ARRAY[
    -- gamification
    'public.add_xp_to_user(integer)',
    'public.update_user_streak(boolean)',
    'public.grant_xp(integer, text, text)',
    'public.award_badge(text)',
    'public.evaluate_badges()',
    'public.record_daily_activity()',
    'public.get_weekly_xp()',
    'public.get_weekly_xp_by_day()',
    'public.get_global_leaderboard(integer)',
    'public.get_public_leaderboard(integer)',
    -- social
    'public.bootstrap_demo_friends()',
    'public.send_friend_request(uuid)',
    'public.respond_friend_request(uuid, boolean)',
    'public.cancel_friend_request(uuid)',
    'public.remove_friend(uuid)',
    'public.get_friends()',
    'public.get_friend_requests()',
    'public.get_friend_suggestions(integer)',
    'public.get_friend_activity(integer)',
    'public.search_users(text, text, text, boolean, integer)',
    'public.get_user_profile(uuid)',
    'public.get_user_courses(uuid)',
    'public.get_my_social_extras()',
    'public.set_my_social_profile(text, text[])',
    -- academic profile / catalog
    'public.get_universities()',
    'public.get_faculties(uuid)',
    'public.get_degree_programs(uuid)',
    'public.get_suggested_courses(uuid, integer)',
    'public.get_my_catalog_courses()',
    'public.get_recommended_courses(integer)',
    'public.set_academic_profile(uuid, uuid, uuid, integer)',
    'public.confirm_catalog_courses(jsonb)',
    'public.verify_my_institution()',
    'public.get_my_verification()',
    'public.link_university_email(text)',
    'public.get_institution_match_suggestion()',
    'public.upsert_course_visit(uuid, uuid)',
    -- onboarding (record_* have no explicit guard, but a NULL user_id fails
    -- the onboarding_progress primary key, so anon can't write)
    'public.complete_activation_onboarding(text, text)',
    'public.record_onboarding_activation(text, uuid)',
    'public.record_onboarding_second_session()'
  ];
BEGIN
  PERFORM pg_temp.grant_exec(_signed_in, 'authenticated');
  PERFORM pg_temp.revoke_exec(_signed_in, 'PUBLIC, anon');
END;
$$;
