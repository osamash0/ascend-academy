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

Status: **DONE** — built and runtime-verified.

- **Backend image: 1.10 GB → 737 MB (−33%, ≈363 MB saved)**, tagged `fable5-optimized`.
- New multi-stage `Dockerfile`: stage 1 installs deps into `/opt/venv`; stage 2 copies
  only that venv onto a clean `python:3.11-slim`. Non-root `appuser` retained; redundant
  `chown -R` layer removed.
- Dropped apt packages `poppler-utils`, `libpoppler-cpp-dev`, `libgl1` — grep-verified
  that no code path in the Docker requirement set uses them (leftovers from the retired
  PaddleOCR/Docling-in-image era). `curl` kept — the prod compose healthcheck needs it.
- **Why not Alpine/distroless** (evaluated per plan): musl breaks/bloats manylinux wheels
  (PyMuPDF, Pillow, asyncpg, tiktoken would build from source); distroless can't ship
  curl for healthchecks. Slim multi-stage is the correct slimming lever for this stack.
- `.dockerignore` bug fixed: patterns like `venv`/`__pycache__` are root-relative in
  Docker, so `backend/venv` and nested caches were being sent in the build context —
  now `**/`-prefixed. Also added `coverage/`, `test-results/`, `e2e/`.
- `Dockerfile.frontend` (86 MB, already multi-stage alpine→nginx) left as-is: near-optimal.
- **Runtime verification**: container boots with a linked Redis; uvicorn workers start,
  "Redis connection established", `GET /docs → 200` via in-container curl (the exact
  prod healthcheck probe). Same default platform as before (prod compose still pins
  `linux/amd64`; local builds native).

## Phase 3 — Documentation Refresh

Status: **DONE**.

- `README.md`: Python requirement corrected 3.13→3.11 (matches pyproject + image);
  parser description fixed (PyMuPDF v5 default, Docling optional and not in Docker);
  "Run with Docker" section expanded (multi-stage notes, REDIS_PASSWORD requirement,
  prod compose usage, localhost-only port binding); env-var table extended with
  `REDIS_PASSWORD`, `DATABASE_URL`, `LITELLM_MASTER_KEY`, `PARSER_VERSION`, CORS vars,
  `NUDGE_RUN_SECRET`, Sentry DSNs + a warning never to put the service-role key on a
  `VITE_` var; phantom `alembic` command replaced with the real Supabase-migrations flow.
- `backend/README.md`: Python 3.13→3.11; requirements-dev/-docker guidance added;
  `PARSER_VERSION` default corrected 3→5 (matches `backend/core/config.py:49`);
  Alembic migration step removed (no Alembic exists); stale endpoint table
  (`/api/upload-pdf`…) replaced with real `/api/v1/...` routes; monitoring SQL against
  the dead `slide_chunks` table removed.
- `SETUP_GUIDE.md`: fully rewritten — was a January snapshot referencing the *old*
  Supabase project, a nonexistent `.venv/`, and "1 migration file" (there are 78).
- `backend/requirements-docker.txt`: stale "PARSER_VERSION=2 (the default)" comment fixed.

## Final numbers

| Metric | Value |
|---|---|
| Dead code removed | ~880 lines (724 in 9 deleted files + ~100 unused imports/vars + ~55 dead constants) |
| Security fixes | 3 applied (prod LiteLLM `--detailed_debug` off; `ws` high-sev DoS + 2 moderate via npm audit fix; coverage artifacts untracked) + 3 flagged (.env key hygiene / `VITE_GROQ_API_KEY` / happy-dom major bump) |
| Docker image | 1.10 GB → **737 MB** (−33%) |
| Backend tests | 586 passed / 0 failed (was 578/8 — 8 stale tests repaired) |
| Frontend tests | 386 passed / 3 failed (3 are pre-existing breakage in WIP-rewritten pages, documented above) |
| Docs updated | README.md, backend/README.md, SETUP_GUIDE.md, requirements-docker.txt, .dockerignore |
