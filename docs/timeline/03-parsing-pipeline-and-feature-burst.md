# Phase 03 — Parsing pipeline and the feature burst (2026-04-30 to 2026-06-09)

*Written 2026-11-04 from `git log --all`, selected diffs, PR #7 and #8, `CHANGELOG.md`, `docs/archive/replit.md`, `docs/archive/DEPLOYMENT_READINESS_2026_05.md` and `project_docs/`. Read-only; no code was changed.*

## Summary

At the start of the phase, Learnstation (then still "Ascend Academy" in docs) was a React + FastAPI + Supabase app. A professor uploaded a PDF, and one long service (`backend/services/file_parse_service.py` plus `ai_service.py`) turned each page into a slide with a title, Markdown content and one quiz question, using Groq or Gemini vision on page images rendered with `pdf2image`. In five weeks this grew a lot. A second-generation ("v2") parser came first: layout routing, OCR fallback, a lecture "blueprint", Cerebras as main LLM. Then a test harness and CI, and in about 24 hours on 05-02/03 an AI coding agent added more than 40 features (grounded RAG tutor, EN/DE, Ask Your Data, courses, practice sheets, mind graph). Two more parser designs followed: a staged, resumable "Parser v3" (Docling, Arq, FastEmbed, LiteLLM, Docker Compose) and a simpler "v4" orchestrator. At the end, on 06-09, the team released "v3.0" with Docker production files. But the configured default parser was still v2, so the release notes describe more than what ran by default.

## Where the time went

| Measure | Value |
|---|---|
| Non-merge commits (all refs) | 177 |
| Active days | 18 |
| Authors (git names) | Abdullah's third account 111, Abdullah 52, Osama 14 |
| AI-agent trailers | 24 commits carry `Replit-Commit-Author: Agent`; 18 carry `Co-Authored-By: Claude …` |
| Frontend (classic rooms) | 107 commits, ~49k lines (33%) |
| Docs | 23 commits, ~22.8k lines (15%) |
| Backend other | 76 commits, ~20.8k lines (14%) |
| Other (scratch output, assets, lock files) | 37 commits, ~15.2k lines (10%) |
| Backend tests | 50 commits, ~12.9k lines (9%) |
| Backend parser | 24 commits, ~8.0k lines (5%) |
| Backend AI / Luna | 31 commits, ~6.1k lines (4%) |
| Frontend tests / e2e | 36 commits, ~6.3k lines (4%) |
| Database | 35 commits, ~3.8k lines (3%) |
| i18n | 13 commits, ~2.3k lines (2%) |
| Infra / CI / scripts | 14 commits, ~1.3k lines (1%) |

Lines changed are rough. `b28bf425` alone added 166 files of parser comparison output (text dumps and PNGs under `scratch/`), and `package-lock.json` and generated Supabase types inflate the frontend share.

- **Most of the commits came from an AI agent in one long session.** 111 of 177 commits are by Abdullah's third account, almost all between 05-02 13:00 and 05-03 12:10. That is about 23 hours of "Task #NN" work. [Confirmed for the 24 commits with the `Replit-Commit-Author: Agent` trailer; Inferred for the rest of that account's commits from the identical name, timing and message style.]
- **Churn hotspots were the lecture pages and the upload path.** `src/pages/LectureView.tsx` was touched 33 times (6 fixes), `src/pages/LectureUpload.tsx` 24 times, `backend/api/upload.py` 20 times (5 fixes), `backend/services/ai/orchestrator.py` 19 times (5 fixes), `backend/services/cache.py` 16 and `file_parse_service.py` 15. So the upload → parse → view flow was reworked again and again while the parser design changed underneath it. [Inferred from the touch counts in the stats file.]
- **`upload.py` became the switchboard for competing parsers.** By 05-22 it routed between v2, v3, v4, LlamaParse, MinerU and OpenDataLoader by a `parser` argument and `PARSER_VERSION`. The many edits are the cost of keeping several pipelines alive at once. [Inferred from `6ce7b5f1`, `8aa255e2`.]
- **Testing became a real share of the work for the first time** (50 commits touch backend tests and 36 touch frontend or e2e tests; some overlap). It started with the 169-test batch on 05-02. [Confirmed: `23da3b34`.]
- **Docs are 15% of lines.** Large design documents were written by agents (`project_docs/pdf_parser_upgrade.md` 721 lines, `parser_v3_architecture.md` 673 lines, the deployment readiness report). [Confirmed from the stats of `7ffb0cd2`, `122460ec`, `7d9f4445`.]

## Entries

### 2026-05-01 — Parser v2: production-grade pipeline with Cerebras and pedagogical blueprint
- **What happened:** `7ffb0cd2` split the PDF path into new services: `layout_detector`, `slide_classifier`, `ocr_fallback` (Tesseract/PaddleOCR), `planner_service` (a lecture "blueprint"), `summarizer_service`, `llm_client` (Cerebras), and `prompts`. The frontend upload page was split into hooks (`usePDFUpload`, `useSlideManager`, `useAIGeneration`, `useLectureSubmit`). `ai_service.py` (892 lines) was cut into `backend/services/ai/{orchestrator,vision,tutor,embeddings,mind_map,…}.py`. A `Dockerfile` and the migration `20260430_lecture_blueprints.sql` were added. `project_docs/PDF_PARSER_EXPLANATION.md` documents the older design (text track + `pdf2image` vision track, metadata-slide filter, no quiz on metadata slides).
- **Decision:** Move from "one vision call per page" to a routed pipeline. Each page is classified first, then sent to text, OCR or vision processing, with a deck-level plan.
- **Why:** [Inferred: based on the new module names and the 721/872-line upgrade plans `project_docs/pdf_parser_upgrade*.md` in the same commit. The plans aim at better structure and lower cost. No single stated reason in the commit message.]
- **Sources:** `7ffb0cd2`, `project_docs/PDF_PARSER_EXPLANATION.md`, `project_docs/pdf_parser_upgrade.md`, `supabase/migrations/20260430_lecture_blueprints.sql`

### 2026-05-01 — pdf2image removed, async and memory hardening
- **What happened:** `b1c7a428` rewrote `file_parse_service.py` again (773 lines changed). It moved blocking work to `asyncio.to_thread` and split admin and anon database clients. It added windowed batch processing "for large PDF stability", closes `fitz` handles and calls `gc`. It also added `odl_service.py` (OpenDataLoader extraction). Two RLS fix migrations came with it.
- **Decision:** Drop `pdf2image`/Poppler and render pages with PyMuPDF only.
- **Why:** [Confirmed: `CHANGELOG.md` [3.0.0] "Removed — `pdf2image` (memory leak) — replaced by PyMuPDF only".]
- **Sources:** `b1c7a428`, `supabase/migrations/20260501000000_fix_handle_new_user_role.sql`, `20260501000001_fix_cache_rls.sql`

### 2026-05-02 — OpenDataLoader comparison and a higher page limit
- **What happened:** `b28bf425` "finalize ODL integration and page limit increase". It committed `scratch/test_opendataloader_comparison.py` and per-page output from PyMuPDF and OpenDataLoader for one ML lecture deck (30 pages), including about 120 extracted images. The scratch folder was deleted again on 05-19 (`6ce7b5f1`).
- **Decision:** Keep OpenDataLoader as an optional extractor next to PyMuPDF.
- **Why:** [Inferred: the comparison script and side-by-side output suggest a manual quality comparison of extractors. No written result was found.]
- **Sources:** `b28bf425`, `6ce7b5f1`

### 2026-05-02 — Testing strategy and the first CI workflow
- **What happened:** `23da3b34` (agent) added `TESTING_STRATEGY.md` (now `docs/TESTING_STRATEGY.md`), `project_docs/testing.md`, a pytest tree (unit / integration / contract / db), an in-memory fake Supabase, MSW-based Vitest setup, Playwright skeletons and `.github/workflows/ci.yml`. The suite had 169 tests: 117 backend, 52 frontend. In the next hours: a nightly real-Postgres RLS suite with testcontainers (`e6503fb9`, Task #4), real Playwright journeys (Task #3), page smoke tests, and a PDF parser test suite (Task #9).
- **Decision:** A test pyramid with hermetic tests on every PR, e2e only on label, DB/RLS tests nightly.
- **Why:** [Confirmed: commit body "wire a complete testing harness … ship the first ≥80 hermetic test cases"; e2e and DB tests are gated to keep PR runs fast and free of network, per the strategy doc.]
- **Sources:** `23da3b34`, `e6503fb9`, `4a5a6edf`, `bee91bd2`, `932c40a2`, `docs/archive/replit.md`

### 2026-05-02 — Security sweep by the agent
- **What happened:** The agent ran a security scan (`79444c11`) and fixed the findings in a row. Rate limiting (slowapi) was added and user roles became server-controlled (`e5aa6119`). Three API-abuse issues were fixed: mind-map generation by non-owners, the upload size checked only after reading the whole file, and one more (`f54a151b`). Five Supabase authorization and storage issues followed: backend cache tables were writable with the anon key, and the PDF bucket was public (`0746c657`, five migrations). Three vulnerable npm dependencies were updated (`5a875ec5`).
- **Decision:** Backend-only cache tables get service-role-only RLS. The PDF bucket becomes private and uses signed URLs. Expensive AI endpoints check ownership before spending tokens.
- **Why:** [Confirmed: commit bodies of `f54a151b` and `0746c657` name each issue and its severity.]
- **Sources:** `e5aa6119`, `79444c11`, `f54a151b`, `0746c657`, `5a875ec5`, `supabase/migrations/20260503000001…05`

### 2026-05-02 — Grounded RAG tutor with slide citations
- **What happened:** `8d2eb095` (Task #12) rebuilt `chat_with_lecture`. A new `services/ai/retrieval.py` retrieves from per-lecture slide embeddings, anchored on the current slide. The tutor answers only from that context with `[Slide N]` citations. It refuses out-of-scope questions without calling the LLM, and filters citations to slides that exist. The chat endpoint checks that the caller may read the lecture. Follow-ups: citation chips in the UI (Task #17), a backfill of embeddings for old lectures (Task #16, 4 commits).
- **Decision:** The tutor is grounded only in the lecture's own slides, with citations and a hard refusal path.
- **Why:** [Confirmed: commit body "answer strictly from that context … refusing out-of-scope questions Socratically"; `project_docs/parser_v3_architecture.md` goal 5 "Socratic tutor grounded only in the deck (zero hallucination)".] Note: this rule was loosened in Phase 04 (`f39e93dc`).
- **Sources:** `8d2eb095`, `09903680`, `b0bc35f1`, `backend/services/ai/retrieval.py`, `backend/services/ai/tutor.py`

### 2026-05-02 — Parser v3 designed, schema and typed models added
- **What happened:** `122460ec` added `project_docs/parser_v3_architecture.md`, a "clean-slate" design. It has seven goals: memory-safe 100–200 slide decks, per-slide checkpoint/resume, a deck narrative pre-pass, rich titles and quizzes, a deck-only tutor, visuals as first-class content, and free-tier AI only. It also sets seven principles: stateless workers, one slide = one transaction, a flat ~150 MB memory budget, stored routing, `slide_chunks` as ground truth, batching, versioned artefacts. `2085da2c` (Task #25) added the migration `20260503000008_parser_v3_schema.sql` (`parse_runs`, `parse_pages`, `slide_chunks` with pgvector 384-d, `tutor_messages`). It was additive, so v2 kept running. `aaf6eb4b` (Task #26) added Pydantic models in `backend/domain/parse_models.py` with `PIPELINE_VERSION = "3"`.
- **Decision:** Build the new pipeline next to v2, step by step (schema first, models second), behind a version switch.
- **Why:** [Confirmed: the design doc says it replaces `file_parse_service.py`, `ai_service.py` and the "ad-hoc orchestration in `upload.py`"; `2085da2c` "Additive only — the v2 pipeline … keeps running unchanged until the rest of the v3 rollout lands".]
- **Sources:** `122460ec`, `2085da2c`, `aaf6eb4b`, `project_docs/parser_v3_architecture.md`

### 2026-05-02 — Cerebras becomes the primary LLM, failover chain widened
- **What happened:** `9adf93c8`, `458ddab9` and `23532f36` made Cerebras (a Qwen 3 235B model) the head of the quality and bulk chains. They added OpenRouter and Cloudflare Workers AI as fallbacks and installed the `openai` client. The frontend model choice is now honoured by moving it to the front of the chain. `35fc8b50`/`99760504` (Task #49) replaced the fixed 12-slide batches with overlapping windows (5 slides, 1 slide of context overlap).
- **Decision:** Use free-tier providers with automatic failover, and let the user pin a preferred provider.
- **Why:** [Confirmed: `docs/archive/replit.md` "Highest free quota (14.4K req/day) + lowest latency"; overlap so the model "can resolve back-references like 'this method'".]
- **Sources:** `458ddab9`, `9adf93c8`, `23532f36`, `35fc8b50`, `docs/archive/replit.md` ("AI providers", "Quiz batch tuning")

### 2026-05-02/03 — Agent feature burst: courses, assignments, nudges, i18n, Ask Your Data, mind graph
- **What happened:** Between 22:30 and 12:10 the agent added, among others: quiz replay and recap (Tasks #31, #39, #40), weekly assignments (#32), a cross-course knowledge graph (#33), a top-level Course entity with worksheets (#46), a daily nudge engine (#34), a weekly study plan (#35), analytics caching (#36), a professor course overview (#37), concept overlap (#41, #42), full EN/DE i18n (#48, 11 commits), slide-level recommendations (#44), practice sheets (#55) and a mind graph overhaul (#57, d3-hierarchy). "Ask Your Data" (#45, 17 commits in 30 minutes) lets a professor ask a question in natural language. The LLM only classifies it into one of 6 fixed intents, and each intent runs an existing analytics function with clamped parameters. About 20 new migrations were added that night.
- **Decision:** For Ask Your Data: no LLM-generated SQL, only a fixed intent catalogue.
- **Why:** [Confirmed for Ask Your Data: `9c6f733f` "fixed catalog of 6 intents … Params are clamped to safe bounds. Unknown / unsafe / unparseable → safe fallback". For the burst as a whole, no reason is recorded. Inferred: the agent worked through a task list (task numbers go up to #84).]
- **Sources:** `9aea8b9d`, `47b51854`, `59bcc27b`, `a50dd631`, `cb341ee6`, `715e578f`, `9c6f733f`…`6d2e2858`, `b73b6bfc`, `cf45c5aa`

### 2026-05-03 — Deployment readiness sweep
- **What happened:** `7d9f4445` (Task #56) produced `DEPLOYMENT_READINESS_2026_05.md` (now in `docs/archive/`). The build and the backend smoke tests passed. But `tsc` had about 13 errors (some real bugs), ESLint had 61 errors, Vitest had 19 of 130 failing, and pytest 2 of 498. One of 33 migrations failed on a fresh database, and the timestamp prefix `20260503000019` was used twice. Task #75 then fixed the ESLint errors that blocked CI.
- **Decision:** none recorded. The report was run "against the dev environment only — no production writes".
- **Why:** [Confirmed: the report's header.]
- **Sources:** `7d9f4445`, `51f510f3`, `docs/archive/DEPLOYMENT_READINESS_2026_05.md`

### 2026-05-02 to 05-05 — Parallel branches and merge repair
- **What happened:** Work ran on several branches at once: `abdullah`, `new_parsing`, `Milestone-2`, `Parser_v9`, `feature/parser-v3`, `feature/pdf-parser-new-implementation` (all now kept as `archive/*` tags). Osama fixed "corrupted supabase types.ts file from bad merge" (`5ea7d492`), restored the dev port and dark theme on a Replit setup (`a78af001`, `75cd33cd`), and fixed 403 errors in the auth middleware (`0612b49e`). Abdullah merged `origin/abdullah` into `new_parsing` four times on 05-03, resolving conflicts in the orchestrator and `replit.md` (`bd347964`, `04dfa431`, `1f3a7550`, `f6ee4ba1`).
- **Decision:** none recorded.
- **Why:** [Inferred: two people plus an agent wrote to the same files (`orchestrator.py`, `types.ts`) at the same time.]
- **Sources:** `5ea7d492`, `a78af001`, `75cd33cd`, `0612b49e`, `bd347964`, `409b1b6d`; tags `archive/Milestone-2`, `archive/Parser_v9`, `archive/feature/parser-v3`

### 2026-05-06 — Fixes from a live pipeline demo; cache keys and TTL
- **What happened:** `704c9a09` fixed three bugs found "during live pipeline demo". Truncated LLM JSON arrays are now salvaged object by object instead of throwing the whole batch away. Embeddings no longer silently return all-zero vectors. Further commits: a 7-day TTL on `slide_parse_cache` (`dd65a830`), a composite `(pdf_hash, version)` key for `lecture_blueprints` (`7c906e9e`), a database-backed token cache (`17dde63c`), and a provider model ID change (`bd9b2f24`).
- **Decision:** Fail loudly on empty embeddings; recover partial LLM output.
- **Why:** [Confirmed: `704c9a09` body. All-zero vectors "poisoned" retrieval, and a truncated array made every slide fall back to per-slide retry.]
- **Sources:** `704c9a09`, `dd65a830`, `7c906e9e`, `17dde63c`

### 2026-05-07 — Lazy import mode and the Pipeline Test Lab (LlamaParse, MinerU)
- **What happened:** `6bfb51e6` added a "lazy" pipeline. An import makes about 2 LLM calls instead of about 140, and each slide is synthesized when it is first viewed. It also added exponential back-off on repeated 429 errors. `4b54991e` added `/professor/pipeline-test` (`PipelineTestPage.tsx`, 1,122 lines). It shows a live SSE log, per-slide inspection, good/bad/review marks with notes, JSON export, and a "Parser Output" sheet that runs only the extractor (`/api/upload/parse-raw`) for auto / PyMuPDF / OpenDataLoader / LlamaParse / MinerU. `llama-cloud-services` was added. Osama fixed the LlamaParse service and added integration tests on 05-11 (`b5550211`).
- **Decision:** Build an in-app tool to compare extractors and judge slide output by hand.
- **Why:** [Confirmed for lazy mode: the commit cites the ~140 → ~2 calls and free-quota exhaustion. For the Test Lab: Inferred from its features (manual evaluation marks and export), meant for comparing parsers.]
- **Sources:** `6bfb51e6`, `4b54991e`, `b5550211`, `backend/services/llamaparse_service.py`, `backend/services/mineru_service.py`

### 2026-05-19 — New pipeline integration: v3 (Docling, Arq, FastEmbed, LiteLLM) and a first v4
- **What happened:** `6ce7b5f1` added `backend/services/parser/`. The v3 orchestrator is an Arq job with five resumable stages: `stage1_ingest` (Docling text in reading order, PyMuPDF rendering), `stage2_synthesize` (deck outline), `stage3_generate` (per-slide AI through an OpenAI-compatible client against LiteLLM), `stage4_embed` (FastEmbed) and `stage5_finalize`. It also added `backend/workers/arq_worker.py`, `docker-compose.yml` (redis, litellm, api, frontend, worker), `nginx.conf`, a `FastUpload` page and `requirements-docker.txt`. In the same commit, `v4_orchestrator.py` appeared, described as "Ported from Replit Node.js implementation": a simple extract → meta → analyze → quiz pipeline using the "Replit prompts". `upload.py` now chose v4 at `PARSER_VERSION=4`, v3 at `3`, and v2 otherwise. The config default was `"2"`.
- **Decision:** Move parsing to a background job queue with Redis pub/sub for SSE, and put LLM calls behind a LiteLLM gateway. Keep v2 as the default.
- **Why:** [Confirmed for the goals: the v3 design doc and `CHANGELOG.md` [3.0.0] ("Lost workers don't lose work", "constant ~150 MB memory"). Inferred for keeping v2 as the default: the CHANGELOG migration guide says "old v2 pipeline continues to work"; no stated reason for not switching.]
- **Sources:** `6ce7b5f1`, `backend/services/parser/*`, `backend/workers/arq_worker.py`, `docker-compose.yml`, `backend/core/config.py`

### 2026-05-22 / 05-28 — Osama's orchestrator changes: external extractors feed v4
- **What happened:** `8aa255e2` changed `upload.py` so that an explicit LlamaParse, MinerU or OpenDataLoader choice extracts pages first and then runs the v4 pipeline. A cached parse is ignored when it came from a different parser family. v4 can run inline when Arq is not available. It also added small changes to `orchestrator.py` and `v4_orchestrator.py`. `86270c2c` ("implement v4 PDF parser orchestrator") is a one-line change. Both landed on `main` through the 05-30 merge of `new_parsing_3` (`baf3fdd3`, 572 files).
- **Decision:** v4 becomes the AI stage for every external extractor.
- **Why:** [Inferred from the diff; the commits have no body.]
- **Sources:** `8aa255e2`, `86270c2c`, `baf3fdd3`, `da1e39f7`

### 2026-06-02 — Docker stack, Sentry, archiving
- **What happened:** `da77cfd5` configured the Docker stack, added Sentry (`sentry-sdk`, frontend init in `src/main.tsx`), a professor archive page with a migration, and a secure role trigger. It renamed one duplicate migration (`…000019_slides_ai_enhanced` → `…000020`). The same commit also committed a server documentation PDF (`GPU-Server/`), a third-party writing skill (`stop-slop-main/`) and Playwright failure artefacts (`test-results/`).
- **Decision:** Error tracking with Sentry. Docker is the deployment unit.
- **Why:** [Inferred: preparation for running on the university GPU server named in `GPU-Server/` and later in `6a7c8306`.]
- **Sources:** `da77cfd5`, `supabase/migrations/20260526000000_archiving.sql`, `20260601000000_secure_role_trigger.sql`

### 2026-06-05 — Student course library, onboarding, load tests; Hono/better-auth dependencies added
- **What happened:** `d35565d4` (PR #8 branch `abdullah`) added `StudentCourseLibrary`, `StudentCourseView`, `Onboarding`, course enrolment migrations, FK index migrations, new prompt templates, `backend/loadtest/` and about 20 root-level `test-*.ts` debugging scripts. `package.json` gained `hono`, `@hono/node-server`, `better-auth`, `pg`, `bcryptjs`, `jsonwebtoken` and `tsx`. No source file in that commit imports Hono or better-auth. The only related file is an agent skill `.agents/skills/better-auth-best-practices/SKILL.md`, added on 05-02 in a Replit Agent commit (`be516fd7`). On the same day CI was fixed several times (`2e46f0fd`, `226db45f`, `67c367e5`, `fbd2704b`). PR #7 (load-test tooling alone, Locust, about 150 simulated students) was opened but never merged and was closed on 08-17. PR #8 (92 commits) was merged on 07-18.
- **Decision:** none recorded for the Node packages.
- **Why:** [Inferred: the packages look like the start of a Node/Hono auth server that was never written, possibly prompted by the agent skill or the "Replit Node.js implementation" mentioned in `v4_orchestrator.py`. Unclear; see Open questions.]
- **Sources:** `d35565d4`, `be516fd7`, PR #7, PR #8, `backend/loadtest/`

### 2026-06-08 — Dead-code removal and pre-deploy hardening
- **What happened:** `b9ea605e` removed the Node packages again as "orphaned dependencies (zero imports in src/)", with 13 unused Radix packages, 22 unused shadcn components, 36 scratch scripts and a 1.4 GB local MinerU venv (not tracked). `56e0c461` handled "HIGH-priority audit items": a guarded UUID parse, a strong reference to background tasks, a typed and size-capped chat history, upper bounds on Docker requirements, and a documented `.env.example`. Its note says a secret rotation was still open as the "real deploy gate". `c3c478c1` added `docker-compose.prod.yml`, which set `PARSER_VERSION=2`. `f91705b0` removed that line from prod compose the same day.
- **Decision:** Ship production Docker files. Prune unused code before the deploy.
- **Why:** [Confirmed: commit bodies of `b9ea605e` and `56e0c461`.]
- **Sources:** `b9ea605e`, `56e0c461`, `c3c478c1`, `f91705b0`, `docs/dead-code-audit.md`

### 2026-06-09 — "v3.0" release, social friends, academic fingerprint
- **What happened:** `a4fc5abc` bumped `package.json` to 3.0.0 and added `CHANGELOG.md` ("[3.0.0] - 2026-06-09 … Parser v3.0 Now Orbiting") and `project_docs/v3.0_release_notes.md`. It also added the social friends feature (564-line migration). The same day: an academic catalogue with a Marburg seed, personalization and course recommendations from an "academic fingerprint", and a verified badge (`c1ad03bc`, `21ae7e46`, `ae4f5e7c`, `8c589615`). At this commit `backend/core/config.py` still defaulted to `PARSER_VERSION="2"` and `.env.example` said `PARSER_VERSION=2`. The CHANGELOG says "PARSER_VERSION=3 # default".
- **Decision:** Call the release v3.0 after the parser.
- **Why:** [Confirmed: CHANGELOG headline. The gap between the notes and the config default is a fact from the files; the reason for it is not recorded.]
- **Sources:** `a4fc5abc`, `CHANGELOG.md`, `project_docs/v3.0_release_notes.md`, `supabase/migrations/20260613000000_social_friends.sql`, `20260615000000_academic_catalog.sql`

## Challenges

**[Confirmed]**
- **Four parser paths at once.** By 05-22 `upload.py` routed between v2 (`file_parse_service`), v3 (Arq stages), v4 (`v4_orchestrator`) and the external extractors. In Phase 04, `e6f039dc` calls v3 "dormant": its `repos` module had a pool bug that never showed because nothing called it. (`6ce7b5f1`, `8aa255e2`, `e6f039dc`.)
- **Release notes ahead of the code.** `CHANGELOG.md` [3.0.0] lists default `PARSER_VERSION=3`, test files such as `backend/tests/unit/parse_classifier.py`, and removal of the 884-line v2 service. At `a4fc5abc` the default was still `2`, and `file_parse_service.py` still existed and was reused by the v5 pipeline on 06-17 (`4f19bd1e`). Not every claim was checked file by file.
- **Duplicate migration timestamps.** `20260503000008` was used twice and `20260503000019` three times (one renamed on 06-02). One of 33 migrations failed on a fresh database (readiness report). Migration file names also run ahead of commit dates (for example `20260613000000…` committed 06-09, `20260621000000…` committed 06-15).
- **Bad merges.** "Fix corrupted supabase types.ts file from bad merge" (`5ea7d492`); four conflict merges into `new_parsing` on 05-03; a "wip: saving changes before switching to main" pattern (`0b2aa58e`, `1e8877c5`, `7efec4b0`).
- **Agent output with red quality gates.** The agent's own readiness report shows failing `tsc`, ESLint and Vitest right after the burst (`7d9f4445`). CI had to be repaired again on 06-05 (four commits).
- **Free-tier limits.** Quota exhaustion and 429 storms drove the lazy mode and back-off (`6bfb51e6`). Truncated JSON and zero vectors were found in a live demo (`704c9a09`).
- **Junk in the repo.** Comparison output and PNGs (`b28bf425`), `__pycache__/*.pyc` (`7ffb0cd2`), Playwright videos and a third-party skill folder (`da77cfd5`). They were cleaned up later (`6ce7b5f1`, `b9ea605e`, `343890c5`).

**[Inferred]**
- **Abandoned Node backend.** The Hono/better-auth/pg packages were added on 06-05 and removed on 06-08 with no code using them. This looks like a started-and-dropped idea, not a real second backend.
- **The parser design moved faster than the UI could follow.** That explains the high churn on `LectureUpload.tsx`, `LectureView.tsx` and `upload.py`.

## Open questions
- Who or what wrote the "Replit Node.js implementation" that `v4_orchestrator.py` says it was ported from, and where did it live? No Node server code is in any ref.
- Why were Hono, better-auth, pg, bcryptjs and jsonwebtoken added on 06-05? Was a Node auth server planned?
- Why was the release called "Parser v3.0" while the default stayed `PARSER_VERSION=2`? Which version ran on the GPU server on 06-09?
- What did the OpenDataLoader vs PyMuPDF comparison (05-02) and the Pipeline Test Lab evaluations conclude? Were any evaluation exports kept?
- Was the agent burst on 05-02/03 driven by a written task list, and who reviewed the ~110 commits? The messages mention "architect comments" and "address code review".
- Why were PR #7 (load tests) closed without merge, and PR #8 left open from 06-05 until 07-18?

## Thesis hints
- **Requirements:** the seven goals in `project_docs/parser_v3_architecture.md` (memory-safe large decks, resume, narrative context, quiz quality, grounded tutor, visuals, free-tier only) are a clear, dated requirements list. The analytics redesign brief (`docs/analytics-redesign/00-brief.md`, 06-05) states professor needs: at-risk students, weak slides, a health snapshot.
- **Design:** the v3 principles (P1–P7: durable state in Postgres, one slide = one transaction, stored routing, versioned artefacts) and the stage diagram; the Ask Your Data "fixed intent catalogue" as a safe alternative to text-to-SQL; the overlapping-window batching with `<context_only>` markers.
- **Implementation:** the v2 → v3 → v4 sequence and the `upload.py` switchboard; Arq + Redis pub/sub for SSE; LiteLLM gateway; FastEmbed 384-d embeddings in pgvector; the RAG tutor with citation filtering.
- **Evaluation:** the Pipeline Test Lab (manual good/bad/review marks), the extractor comparison output, the readiness report (quality gates as numbers), CHANGELOG claims such as "99/143 PowerPoint pages misclassified as decorative by v2" (to be re-checked before citing).
- **Methodology / process:** the use of AI coding agents (Replit Agent burst, then Claude co-authored commits) and its trade-off, with speed on one side and red gates, duplicate migrations and bad merges on the other. Also the test pyramid and CI introduction.
