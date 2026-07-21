# RPC / PostgREST Exposure Audit (S-1)

> Deliverable for `docs/ROADMAP_10X_FOUNDATION.md` §14, **S-1 · Systematic
> PostgREST / RPC exposure audit**. Branch: `fix/s1-rpc-exposure-audit`.
>
> Method: every `SECURITY DEFINER` function across `supabase/migrations/*.sql`
> (83 migration files as of this audit) was enumerated by grepping
> `SECURITY DEFINER`, cross-referenced against every `REVOKE`/`GRANT ... ON
> FUNCTION` statement in the same migration set, and checked against the
> actual call sites in `src/` and `backend/` (`grep -rn '\.rpc('`) to
> determine intended caller. Every finding below that changed grant posture
> was verified against a **real local Postgres 18** (Homebrew, no Docker in
> this sandbox): the bootstrap (`backend/tests/db/sql/00_bootstrap.sql`) plus
> all 83 migrations were applied to a scratch database, the pre-fix exploit
> was reproduced as the `anon` role with zero JWT claims, and then re-run
> post-fix to confirm it is blocked while the legitimate caller path still
> works.

## Summary

- **61** distinct `SECURITY DEFINER` functions currently defined.
- **47** tables in `public`, **100%** with `ALTER TABLE ... ENABLE ROW LEVEL
  SECURITY`. Zero views/materialized views expose `public` data.
- **198** `CREATE POLICY` statements across the migration set; `grep -n "TO
  anon" supabase/migrations/*.sql` matches **zero** `public.*` table policies
  (only the `storage.objects` avatar-bucket policy is `TO public`, and that
  is an intentional public-avatar-read design, not a finding).
- **3** functions already locked down on `fix/p0-security-rpc-lockdown`
  (P0-1, a separate unmerged branch — not duplicated here).
- **9** functions were found `PUBLIC`-executable with no legitimate reason
  and are locked down by this branch's migration,
  `supabase/migrations/20260721000000_s1_rpc_exposure_lockdown.sql`.
- The remaining **~49** functions were either already correctly
  `REVOKE`d/`GRANT`ed, or are safe by construction (trigger functions, which
  Postgres refuses to invoke directly regardless of grants) — see the
  per-function table below.

## Already fixed (P0-1, branch `fix/p0-security-rpc-lockdown` — not duplicated here)

| Function | Migration | Verdict |
|---|---|---|
| `reset_all_analytics()` | `20260614000000` | Fixed on P0-1: `REVOKE ALL FROM PUBLIC, anon, authenticated`; `GRANT EXECUTE TO service_role`. |
| `restore_analytics(uuid)` | `20260614000000` | Same as above. |
| `increment_upload_quota(uuid, text, int)` | `20260710040000` | Same as above. |
| `grant_xp(int, text, text)` | `20260616000000` | Was already `authenticated`-only + self-scoped via `auth.uid()`; P0-1 added a 1–500 hard cap on `p_xp`. |

## NEW findings locked down by this branch (S-1)

Migration: `supabase/migrations/20260721000000_s1_rpc_exposure_lockdown.sql`.
Tests: `backend/tests/db/test_s1_rpc_exposure_lockdown.py` (13 tests, all
passing against a real local Postgres — see below).

### Finding A — social-graph PII leak (HIGH: real, verified unauthenticated data exposure)

| Function | Signature | Migration:line |
|---|---|---|
| `friend_ids_of` | `(uuid)` | `20260613000000_social_friends.sql:174` |
| `relationship_status` | `(uuid, uuid)` | `20260613000000_social_friends.sql:184` |
| `mutual_friends_count` | `(uuid, uuid)` | `20260613000000_social_friends.sql:203` |
| `mutual_courses_count` | `(uuid, uuid)` | `20260613000000_social_friends.sql:214` |
| `shared_catalog_courses_count` | `(uuid, uuid)` | `20260615000200_academic_personalization.sql:18` |

**Why this is real.** Each of these `SECURITY DEFINER` functions takes an
arbitrary *caller-supplied* uuid (or pair of uuids) and returns raw
social-graph data for that user — with no `auth.uid()` ownership check
inside the function body, and (pre-fix) no `REVOKE` in any migration.
Postgres's implicit "grant `EXECUTE` to `PUBLIC` on function creation"
default therefore made them directly callable over PostgREST with the
public anon key. This differs from `get_friends()` / `search_users()` /
`get_user_profile()`, which correctly scope results to `auth.uid()` — these
five are the *unscoped internal helpers* those functions call, and they were
never meant to be called directly.

**Verified exploit (real local Postgres 18, no mocks):**
```
-- seeded: user 111...1 and user 222...2, accepted friend_requests row
SET ROLE anon;
SELECT * FROM friend_ids_of('11111111-1111-1111-1111-111111111111');
--  friend_id
-- ------------------------------------
--  22222222-2222-2222-2222-222222222222   <- the victim's real friend, no auth
SELECT relationship_status('111...1', '222...2');
--  'friends'                              <- confirmed, unauthenticated
```
Post-fix, the same calls raise `InsufficientPrivilege`
(`backend/tests/db/test_s1_rpc_exposure_lockdown.py::test_anon_cannot_read_friend_ids_of_arbitrary_user`
et al.).

**Intended caller.** None, directly. `grep -rn '\.rpc(' src/ backend/`
(and a broader repo-wide grep for each function name) turns up zero direct
call sites — `get_friends`/`relationship_status`-bearing rows
(`FriendButton.tsx`) are populated by `search_users`/`get_user_profile`'s own
internal computation, not a direct RPC to `relationship_status`. All five
are pure internal building blocks.

**Fix.** `REVOKE ALL ... FROM PUBLIC, anon, authenticated` — no `GRANT` to
any client-facing role. `get_friends()` (and friends) are themselves
`SECURITY DEFINER`, owned by the migration-applying/superuser role; a call
from inside one `SECURITY DEFINER` function's body to another executes
under the *outer function's owner*, not the original caller, so revoking
client-role `EXECUTE` on the inner helper does not break the legitimate path
— verified: `test_get_friends_still_works_after_lockdown` passes post-fix.

### Finding B — RLS-helper functions unnecessarily reachable by `anon` (LOW: info-oracle, no real data leak)

| Function | Signature | Migration:line |
|---|---|---|
| `has_role` | `(uuid, app_role)` | `20260122202809_...sql:16` |
| `assignment_owner_id` | `(uuid)` | `20260503000020_fix_assignments_rls_recursion.sql:11` |
| `course_professor_id` | `(uuid)` | `20260611000000_fix_courses_rls_recursion.sql:15` |
| `lecture_visible_to_caller` | `(uuid)` | `20260710040000_student_uploads.sql:72` |

**Why this matters (but only a little).** These four are the RLS
policy-recursion-breaking helpers the roadmap's §2 calls out as "genuinely
strong" — used inside `USING`/`WITH CHECK` clauses. Every policy that
references them is scoped `TO authenticated` (`grep -n "TO anon"
supabase/migrations/*.sql` matches none of them), so `authenticated` must
retain `EXECUTE` — RLS evaluates a `USING`-clause function call as the
*querying role*, not the function owner. But `anon`/`PUBLIC` have no
policy that ever needs them, and (pre-fix) had no `REVOKE` either — so
`anon` could call e.g. `has_role('<guessed-uuid>', 'admin')` or
`assignment_owner_id('<uuid>')` directly and get a raw boolean/uuid answer
for any id it can guess or enumerate. No PII is returned (a boolean or a
UUID, no names/emails), so this is a minor oracle, not a data leak — but it
has zero legitimate use and costs nothing to close.

**Fix.** `REVOKE ALL ... FROM PUBLIC, anon`; `GRANT EXECUTE ... TO
authenticated, service_role`. Verified: `authenticated` still passes
(`test_authenticated_can_still_call_has_role`,
`test_authenticated_can_still_call_course_professor_id`); `anon` now gets
`InsufficientPrivilege`.

## Safe as-is (no action) — remaining ~49 functions

Grouped by why they're safe:

**Trigger functions (`RETURNS trigger`) — Postgres refuses direct invocation
regardless of grant, so a missing `REVOKE` is inert:**
`enforce_assignment_lecture_ownership`, `invalidate_analytics_cache_on_event`,
`invalidate_analytics_cache_on_progress`,
`invalidate_course_overview_on_lecture`, `invalidate_course_overview_on_quiz`,
`invalidate_course_overview_on_slide`, `purge_backend_cache_on_role_change`,
`handle_new_user`. (`protect_profile_privileged_columns` is *not* actually
`SECURITY DEFINER` — a naive grep flagged it because its own comment block
explains why it deliberately is **not** one; confirmed by reading the
function body, `20260620000000_protect_profile_privileged_columns.sql:30`.)

**Internal-only helper, already correctly locked to nobody but the owner:**
`_grant_badge` (`REVOKE ALL FROM PUBLIC` with no re-grant, called only from
`evaluate_badges`/`award_badge`, which run as owner).

**`_invalidate_course_overview(uuid)`** — cache-invalidation helper called
only from the trigger functions above; deletes at most a cache row keyed by
an id the caller must already know, no read path. Low-value target; left
as-is (candidate for a future tightening pass, not urgent).

**Already correctly `REVOKE`d + `GRANT`ed to `authenticated` (verified
present in the same or a later migration):** `add_xp_to_user`,
`update_user_streak`, `get_public_leaderboard`, `cleanup_backend_cache`,
`cleanup_old_blueprint_versions`, `cleanup_slide_parse_cache`,
`upsert_course_visit`, `set_my_social_profile`, `get_my_social_extras`,
`get_weekly_xp`, `get_weekly_xp_by_day`, `send_friend_request`,
`respond_friend_request`, `cancel_friend_request`, `remove_friend`,
`get_friends`, `get_friend_requests`, `search_users`, `get_user_profile`,
`get_user_courses`, `get_global_leaderboard`, `bootstrap_demo_friends`,
`get_my_verification`, `link_university_email`, `get_friend_suggestions`,
`record_daily_activity`, `get_universities`, `get_faculties`,
`get_degree_programs`, `get_suggested_courses`, `get_my_catalog_courses`,
`set_academic_profile`, `confirm_catalog_courses`, `verify_my_institution`,
`get_recommended_courses`, `award_badge`, `evaluate_badges`,
`get_friend_activity`. Each returns only data already scoped to
`auth.uid()` inside its own body (self-serve reads/writes) or public
reference data (catalog/university lists), matching real call sites in
`src/features/*`.

## Table / view exposure inventory

- **47/47 tables** have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. No
  table was found relying on the (absent) Postgres default of "no RLS = open
  to any role with a table grant."
- **0 views / materialized views** in `public` — nothing bypasses table RLS
  via a view.
- **198 policies total**, none scoped `TO anon` for any `public.*` table —
  every table-level policy requires `authenticated` (which itself requires a
  valid Supabase JWT) or is further scoped via `has_role`/ownership helpers.
- **Storage**: `storage.objects` has one `TO public` policy (`"Public Avatar
  Access"`, `SELECT` where `bucket_id = 'avatars'`,
  `20260312000000_avatars_bucket.sql:8`) — intentional: avatars are meant to
  be publicly viewable images, not a finding. All other storage policies
  (`INSERT`/`UPDATE`/`DELETE`, all buckets) are `TO authenticated` and
  self-scoped by `(storage.foldername(name))[1] = auth.uid()::text`.

## CI enforcement

`backend/scripts/lint_new_definer_functions.py` scans a given migration file
(or, with no args, every migration) for a `CREATE ... FUNCTION` whose body
contains `SECURITY DEFINER` but has no matching `REVOKE`/`GRANT ... ON
FUNCTION` for the same name in the same file, and exits non-zero if it finds
one. Wired into `.github/workflows/ci.yml` as the `migration-lint` job,
which computes the migration files newly added on the PR branch
(`git diff --diff-filter=A ... -- 'supabase/migrations/*.sql'`) and lints
only those — an existing migration that predates this check is not
retroactively broken, but any *new* migration must make an explicit
grant decision.

## Acceptance criteria mapping (§14 S-1)

- [x] Checked-in inventory of every DEFINER function + exposed relation with
      intended caller and grant posture — this document.
- [x] Raw anon-key PostgREST probe test suite —
      `backend/tests/db/test_s1_rpc_exposure_lockdown.py`, run against a real
      local Postgres via `SET ROLE anon`/`SET ROLE authenticated` +
      `request.jwt.claim.*` GUCs (same harness pattern as
      `test_lock_down_destructive_rpcs.py`).
- [x] CI check for new unguarded `SECURITY DEFINER` functions —
      `backend/scripts/lint_new_definer_functions.py` +
      `.github/workflows/ci.yml`'s `migration-lint` job.
