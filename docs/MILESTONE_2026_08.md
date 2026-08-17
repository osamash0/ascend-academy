# Milestone: 2026-08 consolidation

Tag: `milestone/2026-08-consolidation` — `main` @ `75017b4`, 2026-08-17.

The repo had drifted to **83 branches across 40 worktrees**, and the branch named
`main` was not the newest code. This milestone makes `main` the single trunk
again, brings production into agreement with it, and records what was archived
so nobody re-litigates it.

Read this before starting new work on `main`.

---

## Why it was urgent

`main` was the commit *"Merge branch 'terminal'"*, whose second parent was
`d338b25`. But `origin/terminal`'s tip was `7c3af43`, one commit later, which had
never been merged:

> **`fix(security): stop list_courses leaking every professor's courses`** —
> migration `20260719020000` added a permissive "browse published courses" RLS
> policy. Permissive policies OR together, so `list_courses` returned every
> professor's courses platform-wide. Reproduced against the live deployment: 20+
> courses across ~15 professors visible to a single account.

That fix was absent from `main` for roughly two weeks. It is now in.

## What the milestone contains

- **P0–P5 platform fleet** and **S1–S6 security fleet** (already on `main` before
  this work, via PR #9).
- **Six features** previously believed uncommitted, all verified present with
  their migrations: review engine (`20260710010000`), exam mode
  (`20260710020000`), student uploads (`20260710040000`), AI voice
  (`services/ai/voice.py`), async/load hardening (`redis_queue_url`,
  `job_locks.py`), brand voice.
- **PR #9** — the `list_courses` leak fix and the fleet consolidation.
- **PR #10** — recovered CI + test-hardening commits stranded on abandoned
  worktree branches, plus a freezegun clock leak they exposed.
- **PR #11** — two commits nearly lost to a faulty verification (below).
- **PR #12** — the Supabase egress fix: hero key art served from ~30–124 KB WebP
  posters instead of source PDFs. Measured on production storage: one course
  36 MB → 1087 kB (97.0%), full corpus 171 MB → 4223 kB (97.6%).
- **`fix(security)`: study-guide regenerate gated on ownership** — see below.

CI is green on all 11 checks, the first all-green run in 20+ attempts.

---

## Security fixes landed here

**Unauthorized study-guide regeneration** (`backend/api/v1/courses.py`).
`GET /api/courses/{id}/study-guide` depended on `verify_token` alone. Reading is
correctly open to anyone who can see the course, but `?regenerate=true` rides in
on the same GET and is a different operation: it skips the cache, spends an LLM
call, and overwrites the single shared `study_guides` row every other student
reads. Any enrolled student could trigger it from a browser address bar,
20×/minute. Confirmed by mutation — with the guard removed the request returns
200.

Gated on **ownership, not role**. `require_creator` resolves to
`require_role("professor", "student")`, which admits both the enrolled student
and a wholly unrelated professor. The predicate that matters is
`courses.professor_id == caller`.

Found while reviewing the commit that repaired the *client-side* professor gate
in `StudyGuide.tsx`. That gate had been dead — it read `profile.role`, a field
that does not exist — so the button never rendered and nobody found the server
hole behind it.

**Unguarded SECURITY DEFINER functions** (`20260817000000`). Four functions in
the course-overview cache invalidation chain had no explicit grant, so Postgres
left `EXECUTE` on `PUBLIC`. Three return `trigger` and were never callable via
PostgREST; `_invalidate_course_overview(uuid)` was — an unauthenticated caller
could evict any course's cached overview at will.

---

## Production database

Prod is `lkiiideqjoiksnycgplc`. Ground truth is `pg_catalog`, **not** the
Supabase ledger: `supabase_migrations.schema_migrations` holds **2 rows against
115 migration files**, so `supabase db push` would attempt to replay 113
migrations against a live database. Do not run it. Probe the catalog instead —
`git log` will point you at the script used here.

### Applied during this milestone

| Migration | Why |
|---|---|
| `20260721000001_s1_rpc_exposure_lockdown` | `friend_ids_of`, `relationship_status`, `mutual_friends_count`, `has_role` were **anon-executable** — the social graph was reachable with the public anon key |
| `20260817000000_revoke_course_overview_invalidation_grants` | closes `_invalidate_course_overview`, live on prod |
| `20260710030000_global_search` | prod had **none** of the 5 search RPCs the shipping code calls |
| `20260719020001_match_slides_by_lecture` | single-lecture tutor retrieval |
| `20260719000000_dead_letter_jobs` | `workers/dlq.py` INSERTs here; without it every permanently-failed job was silently lost |

Backup before the changes: `~/ascend-prod-backups/20260817-204936/` (schema +
226 function ACLs).

### Out-of-band DDL removed

Prod carried `hybrid_search_slides`, a `slides.fts GENERATED ALWAYS` column, and
`slides_fts_idx` — none of which appear in any repo migration. They were applied
directly from `origin/Refactoring` via an ad-hoc script. The index name collided
with `global_search.sql`'s, and because both use `IF NOT EXISTS`, applying ours
would have **silently no-opped** and left keyword search on a sequential scan.
The RPC and index were dropped; the generated column was left (dropping it
rewrites the whole `slides` table for no benefit).

### Still unapplied — deliberate

Deferred by scope decision, not oversight:

- `20260503000004_fix_profile_rls_and_leaderboard` → `get_public_leaderboard`
- `20260719000001_debounce_analytics_cache_invalidation`
- `20260719030000_eval_runs` → **`backend/eval/run_eval.py` fails at runtime without this**
- `20260721110000_activation_funnel_daily`
- `20260721010000_learning_events_partitioning_retention` → the riskiest; it
  time-partitions a live table (~5,060 rows). Give it its own pass.

Production otherwise contains nothing git cannot explain.

### Already closed, contrary to older notes

`reset_all_analytics`, `restore_analytics`, and `increment_upload_quota` are
locked down (`anon=false`). Prior audit notes describing a live
`reset_all_analytics` hole are **stale**.

---

## What was archived

26 `archive/*` tags, all pushed to origin. Every one is annotated with its
ahead/behind state at archive time and a recovery command:

```
git checkout -b <name> archive/<branch>
```

**Zero orphaned commits** — every commit in the repository is reachable from a
branch or a tag. Branch deletion was local only; remote branches were not
touched, so PR #7 (`add-loadtest-tooling`, still open) is unaffected.

### `origin/Refactoring` — rejected, do not revive without redesign

11 commits (2026-07-17) adding SQLModel + Alembic + RBAC + ApiToken + hybrid
search. Investigated in full; redundant where it works and regressive where it
does not:

- **The RBAC permission tables are never seeded.** No role or permission row
  exists anywhere on the branch, so the effective policy is `admin ⇒ all`,
  `course owner ⇒ all`, `everyone else ⇒ nothing` — strictly *narrower* than the
  existing `require_role`.
- **Two shipped regressions**: `enroll:course` runs with `check_course=False`, so
  students cannot enroll; `create_course` uses `check_course=True` on a
  collection POST with no `course_id`, so professors cannot create courses.
- **Five new `public` tables with RLS disabled**, including `api_tokens` (token
  hashes). The DB harness replays only `supabase/migrations/*.sql`, so
  `test_all_public_tables_have_rls_enabled` would never see them — a silent
  S-1/S-2 regression.
- **`verify_token` gains `Depends(get_session)`**, coupling all 113 routes to a
  SQLModel session that hard-fails without `DATABASE_URL`.
- **ApiToken is dead scaffolding** — no issuance endpoint exists, `expires_at` is
  never checked, the blocklist is skipped.
- `main` already does hybrid search (`rrf_fuse()`, same RRF constant 60, scoped
  in SQL), and its Arq worker is a strict superset (cron, DLQ, metrics hooks,
  dedicated noeviction queue Redis vs a shared evictable one).

Two ideas worth stealing as *fresh work*, not ports: `setweight()` field
weighting for `search_slides_keyword`, and `course_access` as a properly
RLS-protected table for TA/co-professor delegation.

---

## Open follow-ups

**F1 — Rotate the leaked Supabase service keys.** `184e574:.env` and
`8a34f6a:backend/.env` contain live `eyJhbG…` service JWTs. `1fcc2bd` untracked
them from HEAD but not from history. The nightly `secret-scan` job runs
`fetch-depth: 0` with no `.gitleaksignore`, which is why it fails on schedule —
this is a real finding, not scanner noise, and no `.dockerignore` change can fix
it. **Gitleaks passes on PRs and fails nightly**, because PR runs are shallow.
Rotate the keys, then either scrub history or add a documented allowlist.

**F2 — GDPR erasure ordering.** `auth.py` swallows storage-cleanup failures and
then deletes `auth.users` anyway, returning `200 "Account deleted."` Because
`lectures` cascades away and was the only `uid → pdf_hash` map, orphaned blobs
become unrecoverable. Conversely, embeddings and blobs are deleted *before* the
auth delete, so a failure there leaves a live account with no PDFs — and
`SettingsGdpr.test.tsx` currently asserts that state as correct. Two buckets are
never touched at all: **`avatars` (public — photos stay fetchable after
erasure)** and `lecture-pdfs`.

**F3 — GDPR export completeness.** `EXPORT_TABLES` misses 14 user-scoped tables,
including `tutor_messages` (AI chat transcripts), `courses`, `assignments`, and
`llm_calls`. `friend_requests` is exported by `requester_id` only, omitting half
the social graph. Needs a test asserting coverage or it re-drifts.

**F4 — No test composes the real endpoint with real RLS.** `fake_supabase.py` has
no RLS machinery, and `conftest.py` binds `get_auth_client` to the same
service-role fake, discarding the token. The real-Postgres test re-implements
`list_courses`'s filter in raw SQL rather than calling it. Both halves are
covered; they are never composed — so the permissive-policy OR-combination that
caused the original leak is still unguarded end to end.

**F5 — Dead index.** `slides_embedding_ivfflat` (1208 kB) sits on
`slides.embedding`, a column that is 100% NULL across all 5,445 rows, superseded
by `slide_embeddings`, with zero scans in 252 days.

**F6 — Stale generated types.** `src/integrations/supabase/types.ts` still
declares `hybrid_search_slides`, dropped from prod during this milestone.
Regenerate. Note these types are generated **from prod**, so they detect drift in
one direction only — they cannot reveal a migration prod never applied, which is
exactly how `eval_runs` and `activation_funnel_daily` stayed invisible.

**F7 — Two unreliable tests, with different causes. Don't conflate them.**

`test_check_duplicate.py::test_force_reparse_skips_cache` fails locally with a
429 from rate-limiter state leaking between tests, and passes in CI —
environment-dependent in both directions.

`Settings page (smoke) > lets a user opt out of future lifecycle reminders` is
**genuinely nondeterministic, roughly a coin flip — not order-dependent.**
Measured in a clean worktree with no other session's WIP, running it alone:
4 passed / 1 failed / 1 failed / then 3 consecutive clean runs. An earlier
characterisation of "fails 4/4 in isolation, passes in the full suite" was a
small sample plus luck. Recorded precisely because starting from the
order-dependent hypothesis sends you hunting for test pollution that isn't
there. It predates all of this milestone's branches and imports none of their
modules.

**F8 — Student self-enrollment is broken. CONFIRMED, live on `main`.**
A new student cannot enroll in anything: every catalog entry renders disabled and
labelled "Enrolled". Highest-priority open item here.

The chain, each link verified:

1. `src/services/studentService.ts:61` — `fetchStudentCourses` selects from
   `courses` with **no enrollment filter and no user filter at all**, just
   `.order('created_at')` and `.limit(100)`.
2. RLS does not scope it either. The `courses` SELECT policies on production are
   permissive and therefore **OR** together, and one of them —
   `"Authenticated users browse published courses"` —
   is `USING (status = 'published' AND is_archived = false)` with no enrollment
   condition. So any authenticated student reads every published course,
   regardless of the two enrollment-scoped policies sitting beside it.
3. `StudentCourseLibrary.tsx:222` pre-seeds from that result under the comment
   *"Pre-seed courseMeta with explicitly enrolled courses"*. **That comment is
   false** — it is every published course.
4. `:324` then wraps it as `enrolledCourseIds`, and
   `CourseCatalogSheet.tsx:168/:207` disables the enroll control on membership.

Reproduced against the live app with a real account holding **zero**
`course_enrollments` rows: all 20 catalog buttons `disabled: true` reading
"Enrolled", with 24+ courses in the rail. That run was against a tree that
already contained `7c3af43`, so the fix does not resolve it — and cannot:
`7c3af43` patched `backend/api/v1/courses.py` (the `list_courses` endpoint),
while `fetchStudentCourses` is a direct PostgREST table select that never reaches
that endpoint. Same bug class, different code path.

**This is the `list_courses` leak's twin.** Identical mechanism — a permissive
browse policy OR-ing away the enrollment scope — fixed on the backend endpoint by
`7c3af43` and still live on the client path. Worth checking whether any other
direct-from-client `courses` read has the same shape.

The fix is not a filter tweak: **there is no client-side enrolled-course accessor
at all.** Grep confirms zero `course_enrollments` reads anywhere under
`src/services/`, `src/features/`, or `src/pages/`. One has to be added.

**F9 — Duplicate PDFs in storage.** ~113 MB of duplicate objects inside the
`lecture-pdfs` bucket. Relevant to the egress budget that PR #12 addressed from
the other direction.

---

## The outbound guard has a blind spot — read this before trusting it

`backend/tests/network_guard.py` blocks outbound access in unit tests, and
`BlockedOutboundAccess` derives from `BaseException` specifically so product
code's `except Exception` handlers cannot swallow it. That part works.

But **the guard only fires if execution actually reaches the socket.** A green
unit suite therefore means *"no outbound call was reached"*, **not** *"no
outbound call exists on these paths"*. Anything sitting behind a cheap local
precondition that fails on synthetic fixture data is invisible to it.

Three independent instances surfaced on 2026-08-17:

1. **The poster hook.** `store_lecture_poster` performs a real Storage upload,
   and the orchestrator fixture had no stub for it. It did not fail, because the
   fixture's `b"%PDF-fake"` bytes cannot be parsed by fitz — `render_poster`
   returns `None` and the function short-circuits before constructing a client.
   Making the fixture realistic produced six `BlockedOutboundAccess` raises. The
   stub that now exists is justified by that latent exposure, not by a
   present-day failure.
2. **Inside the guard's own test.** `get_db_connection` raised
   `RuntimeError("Database pool not initialized")` before attempting a socket
   whenever `DATABASE_URL` was unset, so the guard was never exercised —
   green locally off a populated `.env`, red in CI. Fixed at the environment
   level: `conftest.py` now *assigns* (not `setdefault`) an unroutable DSN, so a
   developer's exported value cannot reintroduce the divergence.
3. **The SCA job.** `npm audit` had never run at all, because `pip-audit` failed
   first and short-circuited the job — hiding 7 vulnerabilities (5 high, all
   `undici` via `jsdom`) behind a red X that said something else entirely.

The environment-level fix removes one whole class of this. **The residual class
survives**: a fake `DATABASE_URL` does nothing for a parse step that rejects fake
bytes. Treat guard-green as evidence about reachability, not coverage.

**The third instance is the worst of the three, and needs a different reflex.**
The first two hid behind *green*. The SCA one hid behind *red with a known,
already-diagnosed cause* — and red-for-a-stated-reason is exactly where people
stop looking. A job that exits at step one reports a truthful failure and a
completely silent second half. So:

- when something is **green**, ask what wasn't covered — widen coverage;
- when something is **red for a known reason**, ask what never *ran* — a
  multi-step job's later steps may never have executed at all.

### A fourth shape: the comment that lies

F8's root cause is not any of the above. `StudentCourseLibrary.tsx:222` carries
the comment *"Pre-seed courseMeta with explicitly enrolled courses"* over a query
that fetches every published course. Two lines later, `:324` names the result
`enrolledCourseIds` and downstream code disables the enroll button on it.

Nothing was unreachable and nothing failed to execute — the code did exactly what
it said, and what it *said* was wrong. A reader auditing that file sees a comment
asserting the guarantee they were about to check for, and moves on. That is how
this survived a leak fix aimed at the very same mechanism.

Worth treating a comment asserting a data guarantee as a claim to verify, not a
premise to build on.

---

## Process notes worth keeping

**Re-derive before deleting.** Two branches were nearly lost to a verification
that was itself buggy: a shell comparison used `set -- $pair` under zsh, which
does not word-split unquoted expansions the way bash does, so `git diff` received
one malformed argument, returned nothing, and empty output was read as "no
difference." Both branches held real unmerged work — the S-4 upload-abuse tests
and the `lectureService` fix for silently-swallowed Supabase mutation errors,
both now on `main` via PR #11.

**A rerun does not re-resolve a PR's base.** `gh run rerun --failed` replays the
same cached merge ref. When a check fails on something the base has since fixed,
the base must be merged into the head; rerunning is a no-op. Verified both ways.

**Concurrent sessions share this working tree.** There is no worktree isolation
by default. During this consolidation a second session was mid-feature in the
same checkout, and a `git reset --hard` — issued after verifying the tree was
clean several minutes earlier — would have destroyed ten of its modified files.
Re-check `git status` immediately before any destructive command, not once at
the start.
