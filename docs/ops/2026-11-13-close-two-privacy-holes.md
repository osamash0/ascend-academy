# Close two privacy holes (2026-11-13)

*Two migrations, prepared and tested against a full local replay of `supabase/migrations/` (db suite: 415 passed). **Not applied to prod.** Apply by hand only with Abi's go, per `docs/runbooks/apply-a-migration-by-hand.md`. Every probe below is read-only; the behaviour probes run inside `BEGIN … ROLLBACK`.*

| Migration | Changes |
|---|---|
| `20261113000000_professor_events_own_lectures_only.sql` | Replaces "Professors view events for their enrolled students" on `learning_events` with "Professors view events about their own lectures": the old rule (enrolled in one of your courses, no v4 reader questions) **and** `event_data->>'lectureId'` is a lecture you own. Drops the professor policy on `learning_events_daily_rollup`. On `learning_events_legacy_20260721`, drops the professor policies and revokes everything from `anon`/`authenticated`. The two optional tables are guarded with `to_regclass`, because prod is not partitioned. |
| `20261113000100_get_user_profile_honours_visibility.sql` | `get_user_profile(uuid)` returns a row only for yourself, a friend, someone who sent you an open request, or a person with `show_in_spaces` on. The signature and columns stay the same. Grants: `REVOKE … FROM PUBLIC, anon`, `GRANT … TO authenticated`. |

Why the first one narrows the policy instead of dropping it: the older screens `/professor/analytics/:lectureId` and `/advanced` are still routed for the professor role. They call `/api/analytics/*` and Ask, and those read `learning_events` with the professor's JWT (`analytics_service.get_auth_client`). Each of those reads filters on `lectureId` of the professor's own lecture, so their figures do not change. The v4 owner's view never used the policy, because it reads through the service connection.

## Before applying (read-only)

```sql
-- 1. What prod really has on the event tables. Stop if a professor policy other
--    than "Professors view events for their enrolled students" shows up.
SELECT tablename, policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('learning_events', 'learning_events_daily_rollup', 'learning_events_legacy_20260721')
ORDER BY 1, 2;

-- 2. Which optional tables exist (prod: probably neither).
SELECT to_regclass('public.learning_events_daily_rollup'), to_regclass('public.learning_events_legacy_20260721');

-- 3. The second migration needs show_in_spaces (20261030000000). Must return one row.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'show_in_spaces';

-- 4. Today's function ignores the setting: expect false.
SELECT pg_get_functiondef('public.get_user_profile(uuid)'::regprocedure) LIKE '%show_in_spaces%';
```

## Apply (only with Abi's go, from `origin/main` after merge)

```bash
set -a; source .env; set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/20261113000000_professor_events_own_lectures_only.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/20261113000100_get_user_profile_honours_visibility.sql
```

No backend or frontend deploy is needed. No code changes ship with these migrations.

## After applying (read-only)

```sql
-- Hole 1: exactly one professor policy is left, and it names lectureId and keeps v4_reader out.
SELECT tablename, policyname,
       position('lectureId' IN qual) > 0 AS own_lectures,
       position('v4_reader' IN qual) > 0 AS no_v4_questions
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('learning_events', 'learning_events_daily_rollup', 'learning_events_legacy_20260721')
  AND policyname ILIKE 'professor%';
-- expect one row: learning_events | Professors view events about their own lectures | t | t

-- The backup, if it exists, is closed to signed-in accounts (expect false, false).
SELECT has_table_privilege('authenticated', 'public.learning_events_legacy_20260721', 'SELECT'),
       has_table_privilege('anon',          'public.learning_events_legacy_20260721', 'SELECT')
WHERE to_regclass('public.learning_events_legacy_20260721') IS NOT NULL;

-- Hole 2: the function reads the setting, keeps its search_path, anon cannot run it.
SELECT prosecdef, proconfig,
       pg_get_functiondef(oid) LIKE '%show_in_spaces%'                         AS honours_setting,
       has_function_privilege('anon',          oid, 'EXECUTE')                 AS anon_exec,
       has_function_privilege('authenticated', oid, 'EXECUTE')                 AS auth_exec
FROM pg_proc WHERE oid = 'public.get_user_profile(uuid)'::regprocedure;
-- expect: t | {search_path=public} | t | f | t
```

Behaviour probes. These return counts, never rows, and are rolled back:

```sql
-- Pick a professor who owns a course, and a user with show_in_spaces off.
SELECT ur.user_id AS prof FROM user_roles ur JOIN courses c ON c.professor_id = ur.user_id
WHERE ur.role = 'professor' LIMIT 1;
SELECT user_id AS quiet FROM profiles WHERE NOT show_in_spaces LIMIT 2;

BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', '<prof>', 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', '<prof>', true);
SET LOCAL ROLE authenticated;
-- Every event a professor can still see from other people names one of their lectures: expect 0.
SELECT count(*) FROM learning_events e
WHERE e.user_id <> '<prof>'
  AND NOT EXISTS (SELECT 1 FROM lectures l WHERE l.professor_id = '<prof>' AND l.id::text = e.event_data->>'lectureId');
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', '<quiet 1>', 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', '<quiet 1>', true);
SET LOCAL ROLE authenticated;
SELECT count(*) FROM get_user_profile('<quiet 1>');  -- yourself: expect 1
SELECT count(*) FROM get_user_profile('<quiet 2>');  -- a stranger with the setting off: expect 0 (unless the two are friends)
ROLLBACK;
```

Write the results into the PR that carries the migrations, with the date.

## Not covered here (same pattern, own decision)

- `student_progress` and `achievements` still carry the "enrolled in any of your courses" professor policy from `20260621000000`. `student_progress` has a `lecture_id` column, so it can be narrowed the same way.
- `search_users`, `get_friend_suggestions` and `get_user_courses` (the classic social feature) still list name, picture and institution, or the courses someone is enrolled in, without checking `show_in_spaces`. With v4 on, students are redirected away from those pages, but the RPCs can still be called directly. Closing them changes who can be found in classic friend search, which is a product choice.
