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

## AI providers

The orchestrator (`backend/services/ai/orchestrator.py`) auto-fails-over
across providers; missing API keys disable a provider gracefully.

- **Cerebras** (PRIMARY) — `qwen-3-235b-a22b-instruct-2507` on Cerebras
  inference. Highest free quota (14.4K req/day) + lowest latency. Requires
  `CEREBRAS_API_KEY`.
- **Groq** — Llama 3.3 70B (quality) and 3.1 8B (fast). `GROQ_API_KEY`.
- **OpenRouter** — Llama 3.3 70B free tier (50/day). `OPENROUTER_API_KEY`.
- **Cloudflare Workers AI** — Llama 3.3 70B fp8-fast on Cloudflare's edge.
  Needs both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- **Gemini / Gemma** — Google AI Studio. `GEMINI_API_KEY`.
- **Mistral, Llama 3 (local Ollama)** — optional fallbacks.

Users can pin a preferred provider in **Settings → AI Preferences**; the
selected id is moved to the head of the failover chain by `_resolve_preferred`
+ `_chain_with_preferred` while keeping the resilience tail intact.

## Recent changes

- 2026-05-02: End-of-lecture recap. After the (optional) replay stage,
  learners now see a `LectureRecap` card listing every question they
  missed on the first try, with their first answer, retry answer,
  correct answer, and a "Got it on retry" / "Still missed" status.
  Perfect runs get a celebratory empty state. The recap owns the
  "Back to dashboard" CTA — the old auto-`setTimeout(navigate, 2000)`
  was removed. `missedQueueRef` items now carry `secondSelectedIndex`,
  populated in place by `handleReviewAnswer`.
- 2026-05-02: PDF parser now uses the new provider chain. Defaults flipped
  from `groq` to `cerebras` in `backend/api/upload.py` and
  `backend/services/file_parse_service.py`. Removed the hard-coded
  `cerebras_client else groq` gates inside `_stage_planning`,
  `_stage_finalize_deck`, `summarizer_service`, and `planner_service` —
  they now pass the caller's `ai_model` straight through and let the
  orchestrator handle cerebras → openrouter → cloudflare → groq → … failover.
- 2026-05-02: AI provider promotion. Cerebras is now the primary provider
  (head of `QUALITY_CHAIN` and `BULK_CHAIN`); OpenRouter and Cloudflare
  Workers AI added as deep-resilience fallbacks. The selected ai_model
  from the frontend is now actually honored — `_generate_with_rotation`
  takes a `preferred` arg and the chain is reordered per call. Settings UI
  exposes Cerebras (recommended), Groq, OpenRouter, Cloudflare, Gemini,
  and local Llama 3. Added `openai>=1.50.0` to `backend/requirements.txt`.
- 2026-05-02: UX + feedback batch. Quiz no longer auto-advances after 1.5s —
  students click an explicit Continue button (`Finish lecture` on last slide)
  rendered by `QuizCard` and wired through `LectureView.handleQuizContinue`.
  Progression uses committed refs (`committedXp/CorrectRef`) + one-shot locks
  (`continueLockRef`, `lectureCompleteLockRef`) to avoid stale-state races and
  double-fires. `LectureEdit` got a sticky save bar at the top of the form.
  New cross-app feedback widget: `src/components/FeedbackWidget.tsx` mounted
  in `DashboardLayout`, posting to `POST /api/feedback`
  (`backend/api/feedback.py`, slowapi-rate-limited, server-derived `user_id`,
  service-role insert). Schema: `supabase/migrations/20260503000008_user_feedback.sql`
  (table + RLS for authenticated select/insert).
- 2026-05-02: Built the testing harness end-to-end — pytest tree (unit /
  integration / contract / db), Vitest tree with MSW + shared supabase mock,
  Playwright skeleton, GitHub Actions CI, and the `TESTING_STRATEGY.md` +
  `project_docs/testing.md` documents. Removed the legacy ad-hoc
  `backend/test_{analytics,dashboard,endpoints}.py` scripts. First batch:
  169 tests passing across 8 backend test modules and 8 frontend test files.
