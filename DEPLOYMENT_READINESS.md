# Deployment Readiness Report

> Generated for Task #56 (Deployment readiness check). Run against the dev
> environment only — no production writes, no production deploy.
>
> **Run date:** 2026-05-03
> **Commands executed:** see `## How this was run` at the bottom.

---

## Top-line checklist

| # | Category | Status | Headline |
|---|---|---|---|
| 1 | Frontend build (`vite build`) | ✅ | Builds in ~34s. Chunk-size warnings only. |
| 2 | Backend "build" (FastAPI import / uvicorn boot) | ✅ | App is up; `/health` returns 200. |
| 3 | TypeScript type-check (`tsc --noEmit -p tsconfig.app.json`) | ❌ | ~13 errors across 6 files. Some are real bugs. |
| 4 | ESLint (`npm run lint`, after `--fix`) | ❌ | 61 errors / 42 warnings. None remaining auto-fixable. |
| 5 | Vitest (unit + integration) | ❌ | **111 passed / 19 failed** across 6 files. |
| 6 | Pytest (unit + integration + contract) | ⚠️ | **496 passed / 2 failed.** |
| 7 | Playwright e2e | ⚠️ | Not run as part of this sweep — `playwright.config.ts` marks e2e as label-gated / nightly only (intentional, see `TESTING_STRATEGY.md §10`). Coverage gap for "must run before deploy" gating. |
| 8 | Backend smoke (live workflow, 15 endpoints) | ✅ | All status codes match expectations (200 on public, 401 on auth-gated, 405 on POST-only). Detail table below. |
| 9 | Secret scan | ✅ | No committed secrets, no `.env*` tracked, `.gitignore` covers `.env` + `.env.*`. |
| 10 | npm audit (prod deps) | ✅ | 0 vulnerabilities. |
| 11 | pip-audit (`backend/requirements.txt`) | ✅ | 0 known vulnerabilities. |
| 12 | Database migrations (fresh-DB apply + drift) | ❌ | Fresh-DB apply: **32 / 33 succeed, 1 fails**. Plus duplicate timestamp prefix `20260503000019`. |

---

## ❌ / ⚠️ Detail with file paths, errors, and repro

### 3. TypeScript errors (Critical-mixed)

Repro: `npx tsc --noEmit -p tsconfig.app.json`

| File | Error (abridged) | Likely impact |
|---|---|---|
| `src/pages/ProfessorDashboard.tsx:102,115,119,120` | `column 'course_id' does not exist on 'lectures'` (Supabase select returns `SelectQueryError`); reduce adds `{user_id, quiz_score…}` object to a number | **Real bug**: stat averages are wrong; lecture list query returns an error envelope cast to `Lecture[]`. |
| `src/pages/ProfessorAnalytics.tsx:1092` | `valueFormatter` not on `CustomTooltipProps` | Tooltip prop silently ignored. |
| `src/pages/Settings.tsx:607` | `Property 'display_name' is missing` on profile insert | **Real bug**: profile-update path will throw at runtime. |
| `src/pages/Settings.tsx:640` | Dynamic table name not in schema; "Type instantiation excessively deep" | Untyped query path; possibly broken in prod. |
| `src/services/lectureService.ts:94,103,182` | quiz-question mapper typed against `GenericStringError`; insert payload typed as `Record<string, unknown>` instead of strict row | Mistyped data path; latent bugs likely. |
| `src/test/supabaseMock.ts:206` | `then` signature incompatible with `PromiseLike` | Test infra typing only — not a runtime bug. |

### 4. ESLint (after `--fix`)

Repro: `npm run lint`

`eslint --fix` removed two trivial issues (the diff for this task contains them: `let → const` in `src/pages/LectureView.tsx:170` and a stale `eslint-disable` line in `src/__tests__/pages/LectureView.test.tsx`). Nothing else is auto-fixable.

61 remaining errors, dominated by:

- `@typescript-eslint/no-explicit-any` — 13 occurrences in `src/pages/`, `src/services/`, `src/features/`
- `no-empty` blocks: `src/features/practice_sheets/PracticeSheetEditor.tsx:182`, `src/features/practice_sheets/StudentPracticeSheetsPanel.tsx:26`
- `@typescript-eslint/no-require-imports`: `tailwind.config.ts:185`

Plus 42 warnings — mostly `react-hooks/exhaustive-deps` and `react-refresh/only-export-components`.

### 5. Vitest — 19 failures across 6 files

Repro: `npx vitest run --reporter=basic`

| File | Failures | Root cause |
|---|---:|---|
| `src/__tests__/pages/Landing.test.tsx` | 4 | MSW `onUnhandledRequest: "error"` rejects unmocked GETs the page now makes (e.g. `/api/courses`, related-across-courses panel). |
| `src/__tests__/pages/ProfessorDashboard.test.tsx` | 3 | `Error: No QueryClient set, use QueryClientProvider to set one` — page now uses `useProfessorOverview` (TanStack Query) but the test renders without `QueryClientProvider`. Use `src/test/renderWithProviders.tsx`. |
| `src/__tests__/pages/LectureUpload.test.tsx` | 7 | Duplicate-PDF check + `/api/courses` GET have no MSW handlers; "Cannot read properties of undefined (reading 'ok')". |
| `src/__tests__/pages/LectureView.test.tsx` | 2 | "queues both wrong questions into review stage" / "logs `quiz_retry_attempt` event on the second-pass answer" — likely related to retry-stage event wiring. |
| `src/components/__tests__/LectureChat.test.tsx` | 2 | Citation-chip tests fail (likely missing chat MSW handler). |

Distinct from #22 (mind-map test failures) — different files.

### 6. Pytest — 2 failures

Repro: `python -m pytest backend/tests --timeout=15 -q`

```
backend/tests/integration/test_check_duplicate.py
  ::TestParsePdfStreamForceReparse::test_default_uses_cache
  → TypeError: stub `_get_cached()` got an unexpected keyword argument 'parsing_mode'
  Cause: production code now passes `parsing_mode=` to `get_cached_parse`;
         the test stub in the test file is out of date.

backend/tests/integration/test_nudge_engine_runner.py
  ::test_run_daily_emits_assignment_and_concept
  → AssertionError: report["notifications_emitted"] == 2, got 1
  Cause: either the nudge engine regressed (only emits one of {assignment, concept})
         or fixture stopped seeding the second trigger.
```

### 7. Playwright e2e

⚠️ Not executed in this sweep. `playwright.config.ts` documents e2e as "label-gated on PRs / nightly only" (`TESTING_STRATEGY.md §10`). Flagged as a coverage gap: today nothing in default CI exercises the three high-value journeys (`student-happy-path`, `professor-upload`, `professor-analytics`) before merging.

### 8. Backend smoke (live workflow on :8000)

Repro: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8000<path>`

Categories explicitly required by the task: **health, auth, parse, lectures, analytics, quiz** — plus courses/assignments/feedback/concepts/mind-map.

| Endpoint | Method | Got | Expected | ✅/❌ |
|---|---|---:|---|---|
| `/health` | GET | 200 | 200 | ✅ |
| `/` | GET | 200 | 200 | ✅ |
| `/api/auth/me` | GET | 404 | n/a — route not mounted (auth via Supabase JWT middleware, no `/auth/me`) | ⚠️ informational |
| `/api/upload/parse-pdf-stream` | GET | 405 | 405 (POST-only) | ✅ |
| `/api/lectures` | GET | 404 | 404 — backend has no `/api/lectures` collection route (lectures are read via `/api/analytics/lecture/{id}/…` and Supabase directly from FE) | ✅ matches OpenAPI |
| `/api/lectures/{uuid}` | GET | 404 | 404 — same reason | ✅ |
| `/api/analytics/professor/overview` | GET | 401 | 401 (auth required) | ✅ |
| `/api/analytics/lecture/{uuid}/overview` | GET | 401 | 401 | ✅ |
| `/api/ai/generate-quiz` | GET | 405 | 405 (POST-only) | ✅ |
| `/api/ai/decks/{uuid}/generate-quiz` | GET | 405 | 405 (POST-only) | ✅ |
| `/api/concepts/lecture/{uuid}` | GET | 401 | 401 | ✅ |
| `/api/courses` | GET | 401 | 401 | ✅ |
| `/api/assignments` | GET | 401 | 401 | ✅ |
| `/api/feedback` | GET | 405 | 405 (POST-only) | ✅ |
| `/api/mind-map/{uuid}` | GET | 401 | 401 | ✅ |
| Vite frontend `/` (port 5000) | GET | 200 | 200 | ✅ |

The only "warning" entry is `/api/auth/me`, which simply does not exist — auth is performed by validating Supabase JWTs in `backend/core/auth_middleware.py` on every protected route, and the FE reads its own session from `supabase.auth` directly. Documented as informational, not a regression.

### 9. Secret scan

- `git ls-files | rg "^\.env"` → **no tracked env files**.
- `.gitignore` covers `.env` and `.env.*` (lines 14–15 of `.gitignore`).
- Regex sweep for `BEGIN PRIVATE KEY`, `sk_live_`, `pk_live_`, `AKIA[0-9A-Z]{16}`, `ghp_…` → **no hits**.
- Files referencing secret-shaped tokens are config readers (`backend/core/config.py`, `backend/core/database.py`, `src/integrations/supabase/client.ts`) that read from env — no hardcoded values.

### 10. npm audit

`npm audit --omit=dev` → **0 vulnerabilities**.

### 11. pip-audit

`pip-audit -r backend/requirements.txt` → **No known vulnerabilities found**.

### 12. Database migrations — fresh-DB apply + drift check

Repro:

```bash
psql "$DATABASE_URL" -c "CREATE DATABASE readiness_scratch;"
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -f backend/tests/db/sql/00_bootstrap.sql
for f in $(ls supabase/migrations/ | sort); do
  psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -f "supabase/migrations/$f"
done
```

The bootstrap SQL stubs Supabase-only roles (`anon`, `authenticated`,
`service_role`), the `auth` and `storage` schemas, and the JWT-claim
helpers — without it, **every** migration fails on plain Postgres because
they all reference `auth.uid()` / `authenticated` / `storage.buckets`.
That is expected; production runs against Supabase which provides these.

**Result against a freshly-created scratch DB on the live Postgres host:**

- ✅ **32 of 33 migrations apply cleanly** in filename order after the bootstrap.
- ❌ **1 migration fails**:
  ```
  supabase/migrations/20260503000004_fix_profile_rls_and_leaderboard.sql:42
    ERROR: column p.display_name does not exist
  ```
  The migration creates a `public_leaderboard` view that selects `p.display_name`
  from the `profiles` table, but the original `profiles` table created in the
  first migration (`20260122202809_…sql`) has no `display_name` column —
  `display_name` is only added later. This is real schema drift: a fresh
  environment will fail to build the leaderboard view.
  This finding correlates with the `Settings.tsx` TS error #3 above
  (FE inserts `display_name` into a table whose contract still doesn't have it).
- ⚠️ **Duplicate timestamp prefix**:
  ```
  supabase/migrations/20260503000019_practice_sheets.sql
  supabase/migrations/20260503000019_slides_ai_enhanced.sql
  ```
  Filename-sort happens to apply `practice_sheets` first today, but the
  ordering is undefined; `supabase db push` against a brand-new project
  will reject the collision.

The scratch database was dropped after the run.

---

## Auto-fix summary

| Tool | What it did | Diff |
|---|---|---|
| `eslint --fix` | Removed 2 trivial issues out of 105 — net reduction to 103 problems. | `src/pages/LectureView.tsx`: `let currentLectureId` → `const currentLectureId` (`prefer-const`). `src/__tests__/pages/LectureView.test.tsx`: stale `eslint-disable` directive removed. |
| `tsc` | None — no auto-fix mode for type errors. | — |
| `ruff` / Python formatter | Not run — no Python linter is wired in this repo (see `TESTING_STRATEGY.md §3` "mypy is not yet wired"). | — |

The two safe auto-fixes were re-validated: `npm run build` and `npx vitest run` produced the same passing/failing set as before — no regressions from the fix.

Nothing else was changed. All other findings are flagged for follow-up tasks below.

---

## Prioritized remaining issues

### 🔴 Critical (block deploy)

1. **Migration `20260503000004` fails on a fresh DB** — `column p.display_name does not exist` while creating the `public_leaderboard` view. A clean Supabase project will not finish migrating. Either reorder the `display_name` column-add migration (`20260503000018_profiles_language.sql` adds language; the `display_name` add lives further down) before `…_fix_profile_rls_and_leaderboard.sql`, or add `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name text` inside `…_fix_profile_rls_and_leaderboard.sql`.
2. **`ProfessorDashboard.tsx` queries non-existent column** (`lectures.course_id`) → lecture list and average-progress numbers are wrong in production. (TS error #1.)
3. **`Settings.tsx` profile insert is missing required `display_name`** → profile-update path throws at runtime. Same root cause as #1 — schema and FE expectations are drifted. (TS error #3.)
4. **Pytest `test_run_daily_emits_assignment_and_concept` regression** → only 1 of 2 expected nudges is emitted. Verify nudges still fire end-to-end before shipping any nudge feature.
5. **Duplicate migration prefix `20260503000019`** → fresh-environment deploys (`supabase db push` / `db reset`) will fail. Renumber one file (suggest renaming `…_slides_ai_enhanced.sql` → `20260503000020_…`).

### 🟠 High

6. **19 failing frontend tests** — green suite is required before any "tests must pass" CI gate. Two distinct fixes: (a) register MSW handlers for `/api/courses`, duplicate-PDF check, and related-across-courses; (b) wrap `ProfessorDashboard.test.tsx` in `renderWithProviders` so `useProfessorOverview` has a `QueryClient`. Distinct from #22's mind-map failures.
7. **Pytest `test_check_duplicate` stub out of date** — production code passes `parsing_mode=` to `get_cached_parse`; trivial test fix.
8. **Cross-ref Task #29 (Supabase service role key)** — `backend/core/database.py:71-79` warns: "Falling back to anon key" when `SUPABASE_SERVICE_ROLE_KEY` is missing. Confirm the production environment has the service-role key set; otherwise RLS-elevated writes will silently fail.
9. **No e2e in default deploy gate** — Playwright runs nightly only. Either accept that, or move at least the three high-value journeys behind a deploy-blocking PR check.

### 🟡 Medium

8. **ESLint: 61 errors** (mostly `no-explicit-any`, two `no-empty`, one `no-require-imports`). Not blocking but prevents enabling a "lint must be clean" gate.
9. **Other TS errors** in `lectureService.ts`, `ProfessorAnalytics.tsx`, `LectureView.tsx`, `Insights.tsx`, `StudentDashboard.tsx`, `BenchmarksSection.tsx` — typing noise plus 1–2 latent bugs.
10. **Vite chunk-size warnings** — `LectureView` ≈ 1.0 MB, `ThreeCanvas` ≈ 1.07 MB, `index` ≈ 810 KB ungzipped. Split via dynamic imports.

### 🟢 Low

11. **Cross-ref Task #22** (mind-map test failures) — overlaps with item 5 but covers different files; keep separate.
12. **Cross-ref Task #51** (health-check task) — this readiness sweep extends it; no overlap to resolve.
13. **`pyproject.toml` has empty `dependencies = []`** while the real list lives in `backend/requirements.txt` — confusing but harmless.

---

## How this was run

```bash
# 1. Build
npm run build                                       # → ✅
# (Backend has no separate build step; uvicorn already running via workflow)

# 2-3. Static analysis
npx tsc --noEmit -p tsconfig.app.json               # → ❌ 13 errors
npx eslint . --fix                                  # → fixed 2 trivial
npm run lint                                        # → ❌ 61 errors / 42 warnings

# 4. Tests
npx vitest run --reporter=basic                     # → ❌ 19/130 fail
pip install pytest-timeout                          # required by repo
python -m pytest backend/tests --timeout=15 -q      # → ⚠️ 2/498 fail
# Playwright skipped per playwright.config.ts (label/nightly only)

# 5. Smoke (15 endpoints against running Backend API workflow on :8000)
for url in /health / /api/auth/me /api/upload/parse-pdf-stream \
           /api/lectures /api/lectures/00000000-0000-0000-0000-000000000000 \
           /api/analytics/professor/overview \
           /api/analytics/lecture/00000000-0000-0000-0000-000000000000/overview \
           /api/ai/generate-quiz \
           /api/ai/decks/00000000-0000-0000-0000-000000000000/generate-quiz \
           /api/concepts/lecture/00000000-0000-0000-0000-000000000000 \
           /api/courses /api/assignments /api/feedback \
           /api/mind-map/00000000-0000-0000-0000-000000000000; do
  curl -s -o /dev/null -w "$url -> %{http_code}\n" "http://localhost:8000$url"
done

# 6. Secret scan
git ls-files | rg "^\.env"
rg -i "(BEGIN PRIVATE KEY|sk_live_|pk_live_|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,})" \
   -g '!node_modules' -g '!dist' -g '!*.lockb' -g '!package-lock.json' -g '!.local'

# 7. Vulnerability scan
npm audit --omit=dev
pip install pip-audit && pip-audit -r backend/requirements.txt

# 8. Migrations — fresh-DB apply + duplicate-prefix check
psql "$DATABASE_URL" -c "CREATE DATABASE readiness_scratch;"
SCRATCH_URL="${DATABASE_URL%/*}/readiness_scratch"
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -f backend/tests/db/sql/00_bootstrap.sql
for f in $(ls supabase/migrations/ | sort); do
  psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -f "supabase/migrations/$f"
done
psql "$DATABASE_URL" -c "DROP DATABASE readiness_scratch;"
ls supabase/migrations/ | awk '{print substr($0,1,15)}' | sort | uniq -c | awk '$1>1'
```

---

## Cross-references

- **Task #22** — failing mind-map tests. **No overlap** with the 19 frontend failures above (different files).
- **Task #29** — Supabase service role key. Item 7 above depends on it; not duplicated.
- **Task #51** — diagnose-only health check. This readiness sweep supersedes it by adding scans + migrations + auto-fix.

Follow-up tasks proposed by this run: **#87** (fix failing frontend tests), **#88** (clean up TS/ESLint errors), **#89** (renumber duplicate migration).
