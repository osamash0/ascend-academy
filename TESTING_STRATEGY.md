# Learnstation Testing Strategy

> **Status**: v1 — initial framework + first batch (≥ 80 cases). Coverage will
> grow incrementally; this document defines the rules of the road.

## 1. Goals

1. Make every change **safe to merge**: a green PR build is strong evidence the
   user-facing behavior still works.
2. Catch regressions **before** they touch Supabase / live LLMs / real users.
3. Document the test pyramid so contributors know **where** a new test belongs.
4. Keep the suite **fast** (< 30s for unit + integration locally) and
   **hermetic** (no network, no real Supabase, no real LLM calls).

## 2. Pyramid

```
                  ┌─────────────┐
                  │     E2E     │  ~3 happy paths, Playwright + mocked
                  │ (PR-label)  │  Supabase route interception. Slow.
                  └─────────────┘
              ┌───────────────────────┐
              │  Integration / API    │  FastAPI TestClient against
              │   (unit boundary)     │  fake_supabase + mock_llm_provider.
              └───────────────────────┘
        ┌─────────────────────────────────────┐
        │   Unit / Pure / Service / Hooks     │  Bulk of suite.
        │   No I/O, deterministic, fast.      │
        └─────────────────────────────────────┘
   ┌────────────────────────────────────────────────┐
   │  Static analysis: TypeScript + ESLint + mypy*  │  Always runs.
   └────────────────────────────────────────────────┘
```
*mypy is not yet wired — a follow-up task.

## 3. Layers

| Layer        | Tooling                       | Owns                                                                                         | Speed |
|--------------|-------------------------------|----------------------------------------------------------------------------------------------|-------|
| Unit         | `pytest`, `vitest`            | Pure functions, single class methods, single hooks                                           | <50ms |
| Integration  | `pytest` + FastAPI TestClient | Router ⇄ service ⇄ fake_supabase ⇄ mocked LLM. Auth via `app.dependency_overrides`.         | <500ms|
| Contract     | `pytest`                      | Frozen snapshots of Pydantic response models → catches breaking API changes for the React FE.| <50ms |
| Hook / page  | `vitest` + RTL + MSW          | React hooks and page-level smoke (mount + loading + empty + first-row-of-data).              | <500ms|
| E2E          | Playwright                    | 3 high-value journeys (student happy path, professor upload, professor analytics).           | seconds|
| DB / RLS     | `pytest -m db` + `testcontainers-postgres` | All migrations apply; RLS denies unauthorized access; cascades fire correctly.    | seconds|
| A11y         | `axe-core` inside Vitest      | Zero serious/critical violations on `Auth`, `StudentDashboard`, `ProfessorAnalytics`.        | <500ms|
| Perf (manual)| `k6`                          | Documented spike + steady-state profiles for upload + analytics. **Not in CI.**              | minutes|

## 4. How we mock the world

### 4.1 Supabase (backend)

`backend/tests/conftest.py::fake_supabase` is an **in-memory PostgREST query
chain mock**. It supports the chain calls our code actually uses:

```
.table(name).select(cols).eq(col, v).contains(col, dict).order(col, desc=False)
       .range(start, end).limit(n).single().maybe_single().execute()
.upsert(payload, on_conflict=...).execute()
.update(patch).eq(col, v).execute()
.delete().eq(col, v).execute()
.insert(payload).execute()
```

It also exposes `client.tables[name]` for assertions and a
`client.seed(table, rows)` helper. Tests **never** touch a real Supabase project.

### 4.2 Supabase (frontend)

`src/test/supabaseMock.ts` exposes the same chain shape and is auto-installed
by `vi.mock('@/integrations/supabase/client', ...)` inside service tests.
For session/auth flow we install MSW handlers that fake the GoTrue REST
endpoints (`/auth/v1/token?grant_type=...`, `/auth/v1/user`).

### 4.3 LLM providers

`backend/tests/conftest.py::mock_llm_provider` patches
`backend.domain.llm.provider_factory.get` to return a deterministic fake
that returns canned text/JSON/vision payloads. Every test that hits an AI
endpoint must use it — there must be **no outbound HTTP** from the suite.

### 4.4 Backend HTTP from frontend tests

`src/test/server.ts` boots an MSW server with handlers in `src/test/handlers/`
that return canonical fixtures for `/api/analytics/*`, `/api/ai/*`,
`/api/upload/parse-pdf-stream`, and `/api/mind-map/*`. The streaming endpoint
returns a proper `text/event-stream` body with multiple `data: ...` frames.

## 5. Environments

| Env       | Used for                  | Supabase                       | LLM                         |
|-----------|---------------------------|--------------------------------|-----------------------------|
| `local`   | `vitest` / `pytest`       | `fake_supabase`/MSW            | `mock_llm_provider`         |
| `ci`      | every PR                  | `fake_supabase`/MSW            | `mock_llm_provider`         |
| `nightly` | `-m db`, `-m e2e`         | `testcontainers-postgres` w/ migrations applied; mocked at the network boundary for E2E | mocked |
| `staging` | (future) contract sweep   | a Supabase **branch**          | real, low-rate              |

`staging` runs are out of scope for this task and require a Supabase branch
plus rotating service-role keys.

## 6. Test data conventions

- **Synthetic only.** Use `faker` (Python) and inline literals (TS) — never copy
  rows out of the production DB.
- **No real UUIDs.** Each test mints its own via `uuid.uuid4()` / `crypto.randomUUID()`.
- **No PII.** Email addresses use the `@example.test` TLD.
- **Time** is frozen with `freezegun.freeze_time` / `vi.setSystemTime` whenever
  the test asserts against `created_at` / streak / "last 7 days" logic.

## 7. Coverage targets

| Area                                | Statements | Branches |
|-------------------------------------|-----------:|---------:|
| `backend/services/*`                |        70% |      60% |
| `backend/api/*`                     |        70% |      60% |
| `backend/domain/*`                  |        85% |      75% |
| `src/services/*`                    |        65% |      55% |
| `src/hooks/*`                       |        60% |      50% |
| `src/lib/*` (excl. UI primitives)   |        70% |      60% |
| `src/pages/*`                       | smoke only |  smoke   |
| `src/components/ui/**` (shadcn)     |  excluded  | excluded |

Thresholds are enforced in `vitest.config.ts` (frontend) and `pytest --cov-fail-under` (backend) **once we reach them** — initially they are warning-only so the first batch can land. The follow-up task tightens the screws.

## 8. Flake policy

- A test that fails twice in CI in 24h is **quarantined** with `pytest.mark.flaky`
  / `it.skip("[FLAKY] …")` and an issue is opened. It must be fixed within 7
  days or removed.
- Tests **never** sleep on wall-clock time. Use `freezegun` / `vi.useFakeTimers`.
- Tests **never** depend on test-execution order. Each fixture resets the
  rate-limiter, the in-memory Supabase tables, and MSW handlers.

## 9. Ownership & runbook

| Failure pattern                   | First place to look                                          |
|-----------------------------------|--------------------------------------------------------------|
| Auth tests fail after auth change | `src/lib/auth.tsx`, `backend/core/auth_middleware.py`        |
| RLS test fails                    | `supabase/migrations/*` — most recent migration first        |
| LLM router 502/504 unexpectedly   | `backend/domain/llm.py::_with_retry` and `mock_llm_provider` |
| Rate-limit test flake             | `backend/core/rate_limit.py` — autouse `reset_rate_limit`    |
| Streaming test hangs              | `usePDFUpload` SSE consumer or `parse_pdf_stream_endpoint`   |

## 10. CI matrix

`.github/workflows/ci.yml` runs three jobs on every PR:

1. `lint` — `npm run lint`
2. `frontend-tests` — `npm test -- --coverage`, uploads HTML coverage
3. `backend-tests` — `pytest --cov`, uploads HTML coverage

A nightly cron additionally runs:

- `pytest -m db` against `testcontainers-postgres`
- `pytest -m e2e` (Playwright)
- `npx playwright test e2e/`

Nothing in `default` CI hits the network.

## 11. How to run

See [`project_docs/testing.md`](project_docs/testing.md) for the runbook.
