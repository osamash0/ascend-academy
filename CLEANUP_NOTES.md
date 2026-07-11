# Cleanup Sprint Notes — 2026-07-11

Three-phase maintenance sprint: audit & cleanup → Docker optimization → docs refresh.

> **Context caution:** the working tree has ~105 uncommitted files of feature-flagged WIP
> (SRS review engine, exam mode, batch upload). Anything behind `FEATURE_*` flags is
> treated as **live**, not dead code.

## Phase 1 — Codebase Audit & Cleanup

Status: **DONE** (applied changes verified by full test suites)

### Test status
- Backend unit suite: **586 passed, 0 failed** (was 578 passed / 8 failed before the sprint — all 8 were pre-existing stale tests, now repaired; see below).
- Frontend vitest: **389 passed, 3 failed** — the 3 remaining failures (Onboarding ×2, Auth a11y ×1) are **pre-existing WIP breakage** in pages actively being rewritten (cinematic onboarding branch); deliberately not touched to avoid colliding with in-flight work.

### Applied changes (all behavior-preserving, verified)
1. **98 unused imports/variables removed** across ~45 backend files (ruff F401/F541/F841 safe fixes). The legacy re-export façade `backend/services/ai_service.py` was deliberately excluded.
2. **Dead files deleted** (grep-verified zero references):
   - `backend/services/prompts.py` (stale whole-file duplicate of `backend/services/ai/prompts.py`)
   - `main.py` (root — "Hello from repl-nix-workspace" stub; app entrypoint is `backend/main.py`)
   - `test_debug.py` (root — targets archived `fast-upload` endpoint that no longer exists)
   - `scratch_check_error.js`, `capture_error.cjs` (one-off debug scripts)
   - `src/components/AppSidebar.tsx`, `src/pages/Achievements.tsx`, `src/domain/gamification.ts`, `src/components/SkillNode.tsx`, `src/components/ui/alert.tsx`, `src/components/ui/toggle.tsx` (orphaned components, zero importers)
3. **Dead constants removed**: `VISION_CHAIN`, `DIAGRAM_VISION_PROMPT`, `TABLE_VISION_PROMPT` (`backend/services/ai/vision.py`); `SINGLE_VISION_SLIDE_PROMPT`, `SUMMARIZER_PROMPT`, `PEDAGOGICAL_SLIDE_PROMPT` (`backend/services/ai/prompts.py`).
4. **Security — `--detailed_debug` removed from `docker-compose.prod.yml`** (LiteLLM was logging full prompt/response bodies in prod). Left enabled in dev compose.
5. **Security — `npm audit fix` applied**: fixes high-severity `ws` memory-exhaustion DoS (GHSA-96hv-2xvq-fx4p) + 2 moderate. Package.json unchanged (lockfile-only, semver-safe).
6. **Repo hygiene**: `.coverage` + `coverage/` untracked from git and added to `.gitignore`.
7. **Stale tests repaired** (test-only changes):
   - `backend/tests/unit/test_ask_professor.py` — 5 tests mocked functions the code no longer calls (refactored to `_bulk_fetch_*` helpers making real Supabase calls); mocks moved to the new seam.
   - `backend/tests/unit/test_llamaparse_service.py` — 3 tests used `monkeypatch.setenv/delenv`, but the service reads a pydantic-settings singleton loaded from `.env` at import; they only ever passed on machines without a `.env`. Now patch `settings` directly.
   - `src/__tests__/hooks/useTTS.test.tsx`, `src/components/__tests__/NudgeBanner.test.tsx` — expected pre-migration `/api/...` URLs; hooks now call `/api/v1/...` via apiClient. Updated.

### Flagged for your decision (NOT applied)
- **`.env` (untracked, local)**: contains live `SUPABASE_SERVICE_ROLE_KEY`, DB password, and 6+ provider API keys in plaintext with `ENVIRONMENT=production`. Never committed (verified against full git history) — but treat as sensitive material; rotate anything ever shared. **`VITE_GROQ_API_KEY` (line 72) is a server key on the client-exposed `VITE_` namespace** — currently unreferenced so not bundled, but one import away from shipping to every browser. Recommend renaming to `GROQ_API_KEY`-style server var.
- **`happy-dom` critical advisory** (dev-only dep, VM-escape class): fix requires a major bump (`npm audit fix --force`); may need vitest config verification. Low real-world risk (test-runner only), but worth scheduling.
- **`backend/core/config.py:63` `fast_upload_model`** — self-documented as unused, but config.py is in active WIP; remove when the branch settles.
- **Frontend unused imports (~80, compiler-verified)** — most live in files being actively rewritten (LectureUpload, Onboarding, ProfessorDashboard…). Enable `noUnusedLocals` or the `unused-imports` ESLint plugin after the WIP lands rather than hand-editing churning files.
- **Unused-but-tested service functions** (e.g. `src/services/analyticsService.ts` `getLectureOverview` family, `studentService` achievement helpers) — no production callers, but deleting removes test-covered API surface; several belong to feature-flagged WIP. Review after launch.

### Structural findings (refactor backlog, no action taken)
- God modules: `backend/services/analytics_service.py` (1803 lines), `backend/services/ai/orchestrator.py` (1409), `backend/services/file_parse_service.py` (1172), `backend/api/v1/analytics.py` (811); frontend: `LectureUpload.tsx` (1899), `AdvancedAnalytics.tsx` (1449), `InlineLecturePlayer.tsx` (1389) + ~9 more pages >600 lines.
- Layering inversions (service → API imports): `search_service.py:20`, `nudge_engine.py:385`; cross-router private-helper reach: `api/v1/search.py:22`, `api/v1/exams.py:31` import `_student_visible_course_ids` from `courses.py`.
- Deep nesting (>4 levels): `orchestrator.py` `parse_json_response` (depth 8), `_repair_linked_slides` / `generate_deck_quiz` (7), `upload_service.py` `extract_raw_pages` (7).
- Duplicate logic to consolidate: RLS client construction (`get_auth_client` reimplemented inline in `tutor_service.py` ×3, `mind_map.py`); frontend `formatDate` ×3, `formatBytes` ×2, apiClient `/api/`→`/api/v1/` rewrite ×3.
- No circular imports found in either codebase (madge + AST verified). ESLint: 140 `no-explicit-any`, 45 `exhaustive-deps` warnings (pre-existing style debt).

## Phase 2 — Docker Optimization

Status: recon done.

Current state:
- `Dockerfile` (backend): single-stage `python:3.11-slim`, non-root user, pip cache mount. Image: **1.10 GB** (`ascend-academy-api`).
- `Dockerfile.frontend`: already multi-stage (`node:20-alpine` → `nginx:1.27-alpine`). Image: **86.3 MB** — already near-optimal.
- `.dockerignore`: present and thorough.
- Prod compose pins `platform: linux/amd64`; healthcheck uses `curl` inside the api container (must keep curl).

Plan: multi-stage backend build (builder venv → slim runtime), drop `libpoppler-cpp-dev`
(-dev header package not needed at runtime), verify with `docker build`.
Note: Alpine is intentionally avoided for the Python image — musl breaks/bloats
manylinux wheels (PyMuPDF, Pillow, asyncpg, tiktoken); distroless can't ship
poppler-utils/curl. Slim multi-stage is the right slimming lever here.

## Phase 3 — Documentation Refresh

Status: not started.
