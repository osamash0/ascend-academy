# Threat Model

## Project Overview

Learnstation is a FastAPI backend with a Vite/React/TypeScript frontend and Supabase for Auth, Postgres, Storage, and RLS. Professors upload or author lecture PDFs/slides, use AI services to parse and enhance content, and view learning analytics. Students browse authenticated lecture content, take quizzes, ask AI tutor questions, and accumulate progress/achievement data.

Production scope is the deployed FastAPI API (`backend/main.py` and routers under `backend/api/`), React client (`src/`), Supabase migrations/policies (`supabase/migrations/`), and backend services used by those routes. Tests, scripts, e2e fixtures, local mockups, and ad-hoc seed utilities are dev-only unless reachable from a production route.

## Assets

- **User accounts and sessions** -- Supabase access tokens, role assignments, profile data, and session state. Compromise enables impersonation or access to professor/student-only actions.
- **Role and authorization data** -- `user_roles`, JWT `app_metadata.role`, and RLS policies separating students from professors and professor-owned content from other professors' content.
- **Lecture content** -- uploaded PDFs, parsed slide text/images, quizzes, summaries, mind maps, and cached AI parse results. This may include proprietary course material.
- **Student learning data** -- progress, quiz attempts, confidence ratings, AI tutor queries, achievements, notifications, and analytics. This can reveal personal study behavior and performance.
- **Application secrets and privileged database access** -- Supabase service role key, anon key, database URL, and LLM provider keys. Service-role or direct database access bypasses normal RLS and must remain server-only.
- **LLM and TTS quotas** -- AI generation endpoints consume paid or rate-limited resources and must not be abusable by unauthenticated or unauthorized users.

## Trust Boundaries

- **Browser to FastAPI API** -- clients are untrusted. API routes must verify Supabase bearer tokens, enforce role/ownership server-side, validate inputs, and rate-limit expensive operations.
- **Browser to Supabase** -- the frontend uses the Supabase publishable key directly. RLS policies are the authorization boundary for all direct table/storage access, so policies must not expose or allow mutation of cross-tenant data.
- **FastAPI to Supabase/Postgres** -- backend code uses both RLS-enforcing clients and privileged service-role/direct database access. Privileged access must only be used after server-side authorization or for backend-only cache/background work.
- **FastAPI to external AI/TTS services** -- user-provided lecture text and prompts cross into LLM providers. Inputs must be size-bounded, roles checked, and failures sanitized.
- **FastAPI to remote URLs/storage** -- slide regeneration downloads stored lecture PDFs. URLs must be constrained to trusted Supabase storage objects owned by the requesting professor to avoid SSRF or local file reads.
- **Public/authenticated/professor/student boundaries** -- marketing/legal pages and health/root endpoints are public. Most application data requires Supabase auth. Professor-only actions include upload, lecture editing, analytics, slide regeneration, and mind-map generation for owned lectures. Student-only state changes should affect only the current student.

## Scan Anchors

- Production entry points: `backend/main.py`, `backend/api/upload.py`, `backend/api/ai_content.py`, `backend/api/analytics.py`, `backend/api/mind_map.py`, `src/App.tsx`, `src/lib/auth.tsx`, `src/lib/apiClient.ts`, and `src/integrations/supabase/client.ts`.
- Highest-risk areas: Supabase RLS migrations in `supabase/migrations/`, direct Supabase client usage in `src/services/` and pages, service-role/direct DB usage in `backend/core/database.py`, `backend/core/auth_middleware.py`, `backend/services/cache.py`, and `backend/services/analytics_service.py`.
- Public vs authenticated: `/`, `/health`, `/`, `/auth`, `/impressum`, and `/datenschutz` are public; API routers under `/api/*` should require bearer auth except root/health; frontend protected routes are convenience only and not an authorization boundary.
- Authenticated lecture catalog: current DB tests document that authenticated users can view lecture, slide, and quiz content broadly for browsing/learning. Do not treat broad SELECT on those core content tables as a vulnerability unless requirements change.
- Sensitive analytics: individual student progress/events and professor analytics should be scoped to the acting student or the professor who owns the relevant lecture; direct Supabase RLS must enforce this even if the normal UI calls FastAPI.
- Dev-only areas: `backend/tests/`, `src/__tests__/`, `src/test/`, `e2e/`, `backend/scripts/`, seed utilities, and local workflow/test fixtures.

## Threat Categories

### Spoofing

Supabase access tokens identify users and roles. FastAPI dependencies must validate tokens with Supabase Auth and must not trust client-editable `user_metadata` for authorization. Role checks should rely on service-controlled `app_metadata` or locked-down `user_roles` data.

### Tampering

Clients can call Supabase directly with the publishable key, so RLS must prevent users from changing other users' profiles, progress, lectures, slides, quizzes, caches, and analytics data. Backend cache tables that influence parsed lecture output must not be writable by arbitrary browser clients, or cache poisoning can alter AI-generated course content.

### Repudiation

Learning events, quiz attempts, confidence ratings, lecture edits, and AI regeneration actions are security-relevant audit data. They should record the authenticated actor and not permit users to forge events for other users or mutate another user's progress.

### Information Disclosure

Student progress, AI tutor queries, analytics, uploaded PDFs, parse caches, embeddings, and profiles can contain personal or proprietary data. API responses, RLS policies, logs, and error messages must avoid leaking cross-tenant student data, professor-owned analytics, service tokens, or internal stack traces.

### Denial of Service

PDF parsing, OCR/rendering, LLM vision/text analysis, mind-map generation, chat, and TTS are expensive. File size/page limits, request size validation, concurrency bounds, timeouts, and rate limits must be maintained on all production endpoints that trigger those operations.

### Elevation of Privilege

Professor-only actions must be enforced on the server and in RLS, not only in React routes. Direct database access and service-role Supabase clients bypass RLS and must only operate on resources after ownership checks. User-controlled URLs, file names, PDF content, or LLM inputs must not lead to SSRF, path traversal, code execution, or arbitrary database writes.