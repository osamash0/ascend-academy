# Learnstation

A FastAPI + Vite/React/Supabase platform for AI-assisted lecture authoring,
streaming PDF parsing, and learning analytics.

This file is the durable memory for the project — keep it short, keep it
current. Architectural deep-dives belong in `project_docs/`.

---

## Stack at a glance

- **Frontend**: Vite + React + TypeScript, shadcn/ui, TanStack Query, React
  Router. Entry: `src/App.tsx`. Tests: Vitest + MSW + Testing Library.
- **Backend**: FastAPI (Python 3.11), slowapi rate limiter, pluggable LLM
  providers under `backend/domain/llm.py`. Entry: `backend/main.py`. Tests:
  pytest + httpx `TestClient` + an in-memory fake Supabase.
- **Data**: Supabase (Postgres + Auth + Storage + RLS). Migrations under
  `supabase/migrations/`.
- **Streaming**: PDF upload uses Server-Sent Events (`/api/upload/parse-pdf-stream`).

## Layout

```
backend/
  api/               FastAPI routers (analytics, ai_content, upload, mind_map…)
  core/              auth_middleware, database, rate_limit, config
  domain/            anonymization, authorization, llm
  services/          analytics_service, content_filter, file_parse_service…
  repositories/      lecture_repo, event_repo
  tests/             unit/  integration/  contract/  db/  fixtures/
src/
  components/        UI (shadcn primitives under components/ui/)
  features/          feature-scoped modules
  hooks/             React hooks (usePDFUpload, use-toast, use-ai-model…)
  lib/               apiClient, auth, pseudonymize, utils, constants
  pages/             route-level components
  services/          frontend data services (lecture/student/analytics)
  test/              shared test infra (server, handlers, mocks)
  __tests__/         test files mirroring src/
e2e/                 Playwright skeletons (PR-label `e2e` / nightly only)
supabase/migrations/ ordered SQL migrations
project_docs/        architecture, schema, walkthroughs, testing how-to
```

## Running

```bash
# Backend (FastAPI on :8000) — managed by the "Backend API" workflow
python -m uvicorn backend.main:app --reload --port 8000

# Frontend (Vite on :5000) — managed by the "Start application" workflow
npm run dev

# Backend tests (117 passing, ~14s)
python -m pytest backend/tests --no-header -q

# Frontend tests (52 passing, ~17s)
npx vitest run
```

## Testing

A complete strategy + first batch of ≥ 80 tests ships in this repo:

- **`TESTING_STRATEGY.md`** (repo root) — the "why" and the test-pyramid policy.
- **`project_docs/testing.md`** — the "how": commands, mocks, runbook.
- **`backend/tests/`** — `unit/`, `integration/`, `contract/`, `db/` (nightly).
- **`src/__tests__/` + `src/test/`** — Vitest tree with shared MSW + supabase mocks.
- **`e2e/`** — Playwright skeletons for the three highest-value journeys.
- **`.github/workflows/ci.yml`** — lint + frontend + backend on every PR;
  e2e on label, db on nightly.

Current totals: **117 backend + 52 frontend = 169 tests green, hermetic, no
network, no real Supabase.**

## Conventions

- All Supabase access in the backend goes through
  `backend/core/database.py::get_supabase[_for_token]` so it can be mocked.
- All Supabase access in the frontend goes through `src/services/*Service.ts`
  — pages and components must not import `supabase` directly.
- All HTTP calls from the frontend go through `src/lib/apiClient.ts`, which
  injects the Supabase bearer token and normalizes error envelopes.
- Pseudonymization (`src/lib/pseudonymize.ts` + `backend/domain/anonymization.py`)
  is the only place where raw user IDs become display labels — never log raw
  IDs directly.
- New tests should re-use existing fixtures (`backend/tests/conftest.py`,
  `src/test/sharedSupabaseMock.ts`, `src/test/handlers/`) before inventing new
  ones. See `project_docs/testing.md` for the cookbook.

## Recent changes

- 2026-05-02: Parse-cache opt-in dialog — `POST /api/upload/check-parse-cache`
  surfaces global `pdf_parse_cache` hits to the upload UI. New
  `ParseCacheDialog` lets professors choose "use saved parse" vs.
  "generate fresh" (force_reparse=true) when re-uploading a PDF whose
  parse was cached but never persisted as a lecture row. Lectures-duplicate
  dialog still wins when both apply. Backend (`get_cached_parse_meta`) only
  selects `created_at` so the check is cheap.
- 2026-05-02: Parser v3 schema migration — added `parse_runs`, `parse_pages`,
  `slide_chunks` (pgvector 384-d), and `tutor_messages` tables with backend-only
  RLS plus per-student policies on the tutor log. Nightly db harness switched
  to the `pgvector/pgvector:pg15` container image. v2 pipeline unaffected.
- 2026-05-02: Drafted `project_docs/parser_v3_architecture.md` — clean-slate
  pipeline design (memory-safe extraction, per-slide checkpoint/resume,
  outline pre-pass, grounded RAG tutor, free-tier model routing).
- 2026-05-02: Built the testing harness end-to-end — pytest tree (unit /
  integration / contract / db), Vitest tree with MSW + shared supabase mock,
  Playwright skeleton, GitHub Actions CI, and the `TESTING_STRATEGY.md` +
  `project_docs/testing.md` documents. Removed the legacy ad-hoc
  `backend/test_{analytics,dashboard,endpoints}.py` scripts. First batch:
  169 tests passing across 8 backend test modules and 8 frontend test files.
