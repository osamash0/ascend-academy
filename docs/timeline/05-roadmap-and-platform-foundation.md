# Phase 05 — 10x roadmap and the platform foundation (2026-07-01 to 2026-07-31)

*Written 2026-11-04 from the git history of all refs, PR descriptions and the docs in the repo. Commit hashes are short SHAs. Where a commit says "Co-Authored-By: Claude", an AI coding agent wrote or co-wrote it.*

## Summary

At the start of July, Learnstation (then still "Ascend Academy" in many places) was a professor-centred platform: professors uploaded PDFs, a v5 "unified" parser turned them into slides, quizzes and embeddings, and students read lectures with a grounded AI tutor. Several upload paths and older pipeline versions still existed side by side. During the month Abdullah wrote a product roadmap (`docs/ROADMAP_10X.md`) and then built most of its first slices in a few days: spaced-repetition review, exam mode, batch upload, global search and student self-uploads, all behind feature flags that default to off. In the second half he wrote a second roadmap for the foundation (`docs/ROADMAP_10X_FOUNDATION.md`) and, on 2026-07-21, merged about 30 short-lived `fix/p*` and `fix/s*` branches that added security lockdowns, LLM cost accounting, metrics, an AI evaluation harness, a dead-letter queue, data-platform changes and security CI. Osama worked in parallel on an RBAC/ApiToken refactor (later rejected) and, at the end of the month, on a set of security fixes. At the end of July the codebase had one upload pipeline, many more tests and much more infrastructure, but the work was spread over many branches and the newest fix was not on `main` (see Phase 06).

## Where the time went

| Measure | Value |
|---|---|
| Non-merge commits (all refs) | 164 |
| Active days | 18 |
| Authors | Abdullah 132, Osama 24, "Ascend Bot" 8 |
| Commits with a "Co-Authored-By: Claude" trailer | 93 of 164 |
| Commit types (from messages) | fix 79, feat 46, security 25, test 18, docs 6, refactor 5 |

| Area | Commits touching | Lines changed (share) |
|---|---|---|
| frontend (classic app) | 60 | 24,263 (30%) |
| backend tests | 81 | 19,075 (24%) |
| backend (other) | 70 | 11,230 (14%) |
| docs | 34 | 5,938 (7%) |
| other | 33 | 5,668 (7%) |
| database (migrations) | 34 | 4,268 (5%) |
| backend parser | 27 | 2,649 (3%) |
| backend AI / Luna | 20 | 2,371 (3%) |
| frontend tests / e2e | 25 | 1,899 (2%) |
| i18n | 8 | 1,242 (2%) |
| infra / CI / scripts | 31 | 1,184 (1%) |

Most-touched files: `InlineLecturePlayer.tsx` (16 commits), `backend/api/v1/courses.py` (13), `test_unified_orchestrator.py` (12), `unified_orchestrator.py` (12), `backend/main.py` (12), `LectureUpload.tsx` (12), `Onboarding.tsx` (12), `.github/workflows/ci.yml` (11). Most-fixed: `courses.py` (9 fix commits), `main.py` (6), `InlineLecturePlayer.tsx` (6), `fullJourneyScene.ts` (6), `ci.yml` (5), `requirements.txt` (5).

- Backend tests were the largest single area by commits (81). This is the coverage push of 07-17/18 plus the tests each `fix/p*` and `fix/s*` branch brought with it. [Inferred: from the area table and the commit messages]
- The month splits in two. Up to about 07-16 the work is product features and UI (roadmap slices, onboarding, PixiJS, brand voice). From 07-17 on it is tests, security, observability and data platform. [Inferred: from commit dates and prefixes]
- `courses.py` was the main churn hotspot on the backend: course listing, ownership and visibility were fixed repeatedly (title suggestion, lecture ownership check, RLS as auth boundary, pagination, and the `list_courses` leak). This points to course access rules being the weakest part of the data model at the time. [Inferred: from the most-fixed list and commit messages]
- `fullJourneyScene.ts` had six fix commits on one day (07-13), all about panning and hit areas in the PixiJS scene. A lot of effort went into a visual feature that is not part of the product today. [Inferred: from commit messages; the v4 app replaced the classic dashboard later]
- Much of the work was done by AI coding agents. More than half of the commits carry a Claude co-author trailer, and `aaa336e1` speaks of "the individual agents" that built the foundation branches. [Confirmed: commit trailers; `aaa336e1`]

## Entries

### 2026-07-03 to 2026-07-17 — Osama's RBAC, ApiToken and SQLModel refactor
- **What happened:** Osama added RBAC models and migrations (`9a92be7b`), enforced RBAC permissions across endpoints (`34fef6c6`), added ApiToken support with course scoping (`99cc7d5d`), and later TTS/quiz fixes (`bfe809e4`). The work lived on the branch `Refactoring`.
- **Decision:** The branch was never merged. In August it was investigated and rejected.
- **Why:** [Confirmed: `docs/MILESTONE_2026_08.md`, section "origin/Refactoring — rejected"] the permission tables were never seeded, so the policy was narrower than the existing `require_role`; two regressions blocked enrolment and course creation; five new tables had RLS disabled; `verify_token` became coupled to a SQLModel session; ApiToken had no issuance endpoint. `main` already had hybrid search and a stronger Arq worker.
- **Sources:** `9a92be7b`, `34fef6c6`, `99cc7d5d`, `d072edc5`, `bfe809e4`; tag `archive/Refactoring`; `docs/MILESTONE_2026_08.md`

### 2026-07-06/07 — The 10x product roadmap
- **What happened:** Abdullah added `docs/ROADMAP_10X.md`. It describes the product as "a content-delivery and measurement machine" that is "not yet a learning-outcomes machine", and plans three phases: close the learning loop (SRS review, exam mode, PWA), "from library to copilot" (planner, global search, professor action loop), and "open the flywheel" (student uploads, study groups, multi-university catalog).
- **Decision:** Every new feature ships behind its own flag, with en+de i18n, RLS tests, events in `learning_events`, and endpoints under `/api/v1/`. Stabilisation beats new scope in any conflict.
- **Why:** [Confirmed: `docs/ROADMAP_10X.md` §1 and §3] three gaps were named: no retention loop, professor-only supply, and desktop-only. Every feature was meant to reuse existing parts (pgvector retrieval, concept graph, Arq, nudge engine).
- **Sources:** `c454d02e`; `docs/ROADMAP_10X.md` (marked historical on 2026-09-17 by `30168f83`)

### 2026-07-07 — Cinematic onboarding with PixiJS
- **What happened:** A console-style onboarding (cold open, PixiJS journey map, reveal montage, WebAudio sound) and reusable Pixi scenes for the skill tree and a practice match game. `pixi.js` was added as a dependency, plus a dev-only `/pixi-lab`.
- **Decision:** Use PixiJS (a 2D WebGL renderer) for game-like scenes inside the React app.
- **Why:** not stated beyond the feature description. [Inferred: part of the gamified "console" design of that time]
- **Sources:** `76085a14` (Claude co-author), `src/lib/pixi/`, `src/pages/Onboarding.tsx`

### 2026-07-07 — Upload pipeline: PPTX, Office conversion, LlamaParse settings
- **What happened:** Native PPTX to per-slide Markdown via MarkItDown (`markitdown_service.py`), Office to PDF conversion (`office_convert.py`, LibreOffice), LlamaParse settings moved into config, and a plan file `project_docs/upload_10x_roadmap.md`.
- **Decision:** Accept more file types than PDF in the upload path.
- **Why:** [Confirmed: commit message and `project_docs/upload_10x_roadmap.md` title] part of the "10x upload pipeline". The deeper reason for PPTX support is not stated. Note that in August PPTX was declared unsupported in containers (Phase 06, PR #51).
- **Sources:** `b35a861a`

### 2026-07-07 — All frontend HTTP through `apiClient`
- **What happened:** Scattered raw `fetch` calls with manual auth headers in services, hooks and pages were replaced by one `apiClient` (get/post/stream/upload). An "auto" (server default) model option and OpenAI were added to the model picker, and "auto" became the default.
- **Decision:** One HTTP client for the frontend.
- **Why:** [Confirmed: commit message, "removing scattered raw fetch + manual auth headers"]. Later notes show a leftover: `/api/` to `/api/v1/` rewrites were still duplicated three times (`docs/archive/CLEANUP_NOTES_2026_07.md`), and in August 44 legacy un-versioned call sites remained (finding M54 in `docs/MILESTONE_4_FIX_PLAN.md`).
- **Sources:** `502e74cf`

### 2026-07-10 — Phase-0 debt burn-down: one upload path, legacy code archived
- **What happened:** The separate "fast upload" path was removed and redirected; only the unified v5 pipeline stays reachable. One upload size limit is served from config to both frontend and backend. `force_reparse` was fixed. `parsing_mode=on_demand` now makes zero LLM calls. The v3 five-stage orchestrator, the v4 orchestrator, classifier and summariser were moved with `git mv` into `backend/_legacy/`; four synthesis functions were copied into a new `backend/services/parser/synthesis.py`.
- **Decision:** "flag-not-delete": retire old pipelines by archiving them where nothing can import them, not by deleting them.
- **Why:** [Confirmed: commit message, "so exactly ONE pipeline (unified/v5) is reachable, per upload_10x_roadmap.md §0.1"]. Verified with an import check, a grep gate, 755 passing backend tests and two real-LLM runs.
- **Sources:** `a65b0f9d` (Claude co-author), `backend/_legacy/`, `backend/services/parser/synthesis.py`

### 2026-07-11 — Roadmap slices shipped in one commit (review engine, exam mode, batch upload, search, student uploads)
- **What happened:** One large commit landed work that had piled up as uncommitted WIP: the SRS review engine "Daily Ascent" (SM-2 scheduler, `review_cards`), Exam Mode (course-calibrated mock exams), batch upload through Arq, global semantic search, and "My Materials" student uploads with a monthly quota. Each sits behind its own flag (`FEATURE_REVIEW_ENGINE`, `FEATURE_EXAM_MODE`, `FEATURE_GLOBAL_SEARCH`, `FEATURE_STUDENT_UPLOADS`), all off by default.
- **Decision:** SM-2 instead of FSRS; quiz-question cards only, concept cards deferred.
- **Why:** [Confirmed: `docs/ROADMAP_10X.md` §1.1 execution status] SM-2 was "behind the stable interface as planned"; concept cards were cut because `slide_chunks` had no writers and `concept_lectures` was never filled by the pipeline. The cleanup notes of the same day warn that the working tree held "~105 uncommitted files of feature-flagged WIP" [Confirmed: `docs/archive/CLEANUP_NOTES_2026_07.md`].
- **Sources:** `4cd58a66` (Claude co-author); migrations `20260710010000`, `20260710020000`, `20260710040000`; `backend/api/v1/review.py`, `exams.py`, `search.py`, `materials.py`

### 2026-07-11 — "Course brain" behind `FEATURE_COURSE_BRAIN`
- **What happened:** A `course_context` table (instructor, exam dates, grading scheme) is filled from administrative slides at parse time; a per-course concept map endpoint; prior lectures' titles and concepts are threaded into synthesis prompts. A real bug was fixed on the way: concept-graph ingestion ran only client-side, so batch-uploaded lectures were never ingested.
- **Decision:** Ship behind a new flag, default off, so parsing stays "byte-for-byte as before" when off.
- **Why:** [Confirmed: commit message and `backend/core/config.py` comment]. Later the flag was deliberately kept off. The thesis primer (Phase 06) shows the consequence: with the flag off, concept ingestion never runs, so `concepts`, `concept_lectures` and `concept_mastery` stay empty [Confirmed: `docs/thesis/ARCHITECTURE_PRIMER.md`, diagram D14]. Why the flag must stay off is not written in the repo (see Open questions).
- **Sources:** `ef1a9dbf` (Claude co-author), `supabase/migrations/20260711000000_course_context.sql`, `backend/services/course_context_service.py`

### 2026-07-11 — Cleanup sprint and production-readiness hardening
- **What happened:** A three-part sprint: 98 unused imports removed, dead files deleted, a debug flag that logged full prompts in prod removed, stale tests repaired; backend Docker image cut from 1.10 GB to 737 MB with a multi-stage build. Separately, `5fe0fedb` fixed a prod healthcheck that probed the disabled `/docs` page (so the frontend would never start), removed debug logs that leaked user IDs, capped memory on the 4 GB server and added indexes on `learning_events`. API docs were disabled in prod and nginx security headers added (`d0179aff`). Lovable metadata was removed (`13aa25d0`).
- **Decision:** Treat anything behind a `FEATURE_*` flag as live, not dead code.
- **Why:** [Confirmed: `docs/archive/CLEANUP_NOTES_2026_07.md`; `5fe0fedb` message, "production-readiness hardening from multi-dimensional audit"]
- **Sources:** `5fe0fedb`, `d0179aff`, `3cf21570`, `13aa25d0`, `b25cc675`; `docs/archive/CLEANUP_NOTES_2026_07.md`

### 2026-07-12 — Trust signals: "needs review" and regenerate with feedback
- **What happened:** Each slide now stores a cheap, deterministic "needs review" signal (synthesis failed, vision rescue, empty content), shown as a filter and badge in the editor. Regenerate accepts a professor instruction that persists across re-parses, with one level of undo. Two shipped bugs were found: regenerate imported a deleted function (every call failed with 502), and the frontend expected a different response shape, so the feature had been dead end to end.
- **Decision:** Defer lecture versioning (Phase 5.3).
- **Why:** [Confirmed: commit message] the goal was "zero silent failures"; versioning was deferred because the re-upload path deletes the rows a versioning feature would need.
- **Sources:** `d2c33c53`, `4377fb6a`, `c33d5ab8`, `ef8a1762`

### 2026-07-12 — "Calm Competence" brand voice
- **What happened:** The sci-fi voice ("six different AI personas", "Orbital protocol") was replaced by one voice, documented in `docs/BRAND_VOICE.md`. A shared fragment `backend/services/ai/voice.py` is composed into every prompt that produces user-visible text. New `gamification` and `onboarding` i18n namespaces; German set to "du"; the name "Learnstation" standardised.
- **Decision:** One documented voice for AI output and UI copy.
- **Why:** [Confirmed: commit message, "no shared tone"]. Tutor grounding tests now assert the tutor's hard rules stay byte-identical.
- **Sources:** `6033f75d` (Claude co-author), `docs/BRAND_VOICE.md`, `backend/services/ai/voice.py`

### 2026-07-12 — Oracle Cloud compose file
- **What happened:** A `docker-compose.oracle.yml` for an Oracle Cloud deployment was added, together with exam API and migration tweaks.
- **Decision:** none recorded. The file still exists, but prod runs on a Hetzner server (CLAUDE.md).
- **Why:** not stated. [Inferred: a hosting option that was explored and not adopted]
- **Sources:** `c664235e`

### 2026-07-13 — PixiJS "full journey" path on the student dashboard
- **What happened:** A baseline PixiJS scene, then six fix commits for panning math, hit areas, mobile taps, multi-touch and pointer cancel, then a React wrapper with theming and accessibility, integrated into `StudentDashboard`.
- **Decision:** none recorded.
- **Why:** not stated. [Inferred: continuation of the gamified dashboard]. Commits "address reviewer feedback" suggest an agent-review loop.
- **Sources:** `4c8f583f`, `75389c36`, `19a40390`, `b6fec8ce`, `56f23070`, `7ee3d388`, `3e114865`, `fc57caa6`, `06e29ff6`

### 2026-07-16 — Async pipeline and load hardening for a single node
- **What happened:** The Arq job queue moved to its own Redis with `noeviction` and AOF, so queued parse jobs can no longer be dropped by the cache Redis's LRU policy. A real `/health/ready` probe, upload backpressure (HTTP 429 past a queue depth), synchronous Supabase calls moved off the event loop, an SSE heartbeat for long parses, bounded HTTP clients, and the in-process parse fallback limited to dev.
- **Decision:** Fail loudly in prod when the queue is down, instead of running heavy work on the API loop.
- **Why:** [Confirmed: commit message]
- **Sources:** `43a86927` (Claude co-author)

### 2026-07-17/18 — Backend coverage push and two bugs it found
- **What happened:** Tests for the upload service (42% to 94%), parser layers, course CRUD, quiz validator and file-parse helpers; `api/v1/courses.py` reached 100%. The full non-db suite went green. Two bugs were found and fixed: B1, the JSON truncation-recovery never worked for real token-limit truncation (`e13d0d65`); B2, the title-suggestion endpoint always returned 422 (`f1486652`). PR #8 (Abdullah's long-running `abdullah` branch with course library, onboarding and load-test tooling, opened 2026-06-05) was merged on 07-18.
- **Decision:** Log bugs found by tests and fix them in separate branches, not inside the test commits.
- **Why:** [Confirmed: `docs/archive/WORKLOG_backend_coverage_2026_07.md`, "Bugs found (logged above, NOT fixed per guardrails)"]
- **Sources:** `bfc1e86d`, `636e3925`, `73e8bfb4`, `0203f844`, `11dd90a6`, `eb798b4f`, `e13d0d65`, `f1486652`; PR #8; worklog file above

### 2026-07-18 — Feature audit stamped against the code
- **What happened:** All 224 untested user stories in `FEATURE_AUDIT.xlsx` got a test result from a scripted pass (key-file existence check plus green suites). The pass found 12 cases where the audit no longer matched the code (for example Fast Upload retired, LectureEdit merged into LectureUpload).
- **Decision:** Label these results as "static+suite verification", not browser QA.
- **Why:** [Confirmed: `2e857685` message]
- **Sources:** `2e857685`, `83153dec`

### 2026-07-19 — Foundation roadmap and the P0 security lockdown
- **What happened:** `docs/ROADMAP_10X_FOUNDATION.md` audited the schema (83 migrations), backend and AI pipeline and listed P0–P4 initiatives, a data-platform phase P5 and a security track S-1 to S-6. P0-1 was fixed the same day: some admin and quota database functions could be called with the public anon key; the fix revokes those grants and caps `grant_xp`. The idempotency middleware's cross-user key collision was also fixed, and script-only DDL was promoted into a migration.
- **Decision:** "risk-reduction and instrumentation come before optimization."
- **Why:** [Confirmed: `docs/ROADMAP_10X_FOUNDATION.md` §1] "You cannot optimize a cost you cannot measure, scale a system you cannot observe, or trust a pipeline you cannot evaluate." The three named cracks were security/reproducibility, no cost or quality instrumentation, and a single-worker ceiling.
- **Sources:** `0bcecae1`, `164576fa`, `7b178a31`, `a7b929b9`

### 2026-07-19 to 2026-07-21 — The foundation fleet: about 30 `fix/p*` and `fix/s*` branches merged in one day
- **What happened:** Each initiative was built on its own branch and all were merged into `main` on 07-21. Highlights: LLM cost and token accounting with a fleet-wide budget and a per-user monthly cap (P1-1, `llm_calls` table); Prometheus metrics and a correlation-ID fix (P1-2); an AI evaluation harness with human-verified golden sets for quiz keys, tutor faithfulness and retrieval precision@k, plus an LLM judge and a nightly CI job (P1-3); tutor retrieval scoped in SQL (P1-4); RLS as the auth boundary for course lists (P2-1); dead-letter queue and per-job locks (P2-3); HNSW index and real upsert for `slide_embeddings` (P3-3); embedding dedupe by content hash (P3-2); a versioned prompt registry (P4-3); migration timestamp lint and pinned requirements (P4-4); event schema governance, a materialized-view rollup for professor analytics, analytics moved off the write path, and monthly partitioning of `learning_events` (P5-1 to P5-4); a systematic RPC exposure audit (S-1, `docs/RPC_EXPOSURE_AUDIT.md`), a GDPR export endpoint (S-2), rate-limit proxy trust (S-3), SCA and secret-scan CI (S-5, `docs/SECURITY_CI.md`), and a path-scoped RLS gate with a leak canary (S-6).
- **Decision:** Build the fleet in parallel branches, then verify the merged migration chain against a scratch Postgres.
- **Why:** [Confirmed: `aaa336e1`] verifying the full merged chain "caught a real cross-branch integration bug the individual agents could not have seen": the partitioning migration (P5-4) dropped the `event_type` CHECK constraint added by P5-1.
- **Sources:** merges `94c776d1` to `ce5d2b65` on `origin/main`; `b8d8a100`, `df62cd3c`, `e2297461`, `dbf8929c`, `934aca2a`, `89fc8769`, `eb4159a4`, `e1af6fea`, `80049fbe`, `b24112d2`, `beaee1a3`, `ad82356e`, `20356354`, `692cbc30`, `0c2a14a5`, `6009fb57`, `cc392dde`, `aaa336e1`

### 2026-07-20 — "Ascend Bot" commits
- **What happened:** Eight commits by an author named "Ascend Bot": analytics index, `main.py` lifespan, LLM factory, deprecated datetime/asyncio calls, a `slide_embeddings` unique constraint, and Docker binding changes "to support cloud ide webviews".
- **Decision:** none recorded.
- **Why:** not stated. [Inferred: an automated coding agent running in a cloud IDE, based on the author name and the "cloud ide webviews" message]
- **Sources:** `b37f9e79`, `4608bad5`, `b0d52fcd`, `e6a30ad5`, `b10a5fd3`, `23d52719`, `3bb6f1b6`, `d1afd8ad`

### 2026-07-22 to 2026-07-30 — Osama: admin dashboard, RLS/nginx, and a security batch on `terminal`
- **What happened:** Osama built an admin dashboard v1 API with pagination (`0ef792dc`), fixed RLS policies and added an nginx resolver (`e0ad357e`), and on 07-29/30 committed a security batch on branch `terminal`: prompt-injection hardening (slide and OCR text labelled as data, not instructions, in tutor, quiz, vision and classifier prompts), forced attachment downloads, MIME checks on uploads, a shared secret on the MinerU parse server, no raw exception text in 5xx replies, and `docs/STORAGE_UPLOAD_SECURITY_AUDIT.md`. `terminal` was merged into `main` on 07-30.
- **Decision:** Treat extracted document text as untrusted data in every prompt.
- **Why:** [Confirmed: commit messages, e.g. `bf012166` "close prompt-injection trust-boundary gap in AI tutor"]
- **Sources:** `0ef792dc`, `93b88e28`, `e0ad357e`, `bf012166`, `558e9878`, `d75218c4`, `7573a2c1`, `fbeae611`, `572035cc`, `e488a7c9`, `2282cefb`, `54af4ccc`; merge `f4922490`

### 2026-07-30 — The `list_courses` fix that missed `main`
- **What happened:** Osama committed `7c3af431`, "stop list_courses leaking every professor's courses". It was the next commit on `terminal` after the merged tip, so it did not reach `main` until PR #9 on 2026-08-17.
- **Decision:** none at the time; found during the August consolidation.
- **Why:** [Confirmed: PR #9 body and `docs/MILESTONE_2026_08.md`] a permissive "browse published courses" policy from migration `20260719020000` was OR-ed with the scoped ones, so one account could see every professor's courses. The fix was "absent from `main` for roughly two weeks."
- **Sources:** `7c3af431`, PR #9, `docs/MILESTONE_2026_08.md`

### 2026-07-30/31 — Real-Postgres suite and partitioning repairs
- **What happened:** Unit tests were blocked from real DB and network access (`87e9992f`, a `network_guard`); after a WIP snapshot and a merge of `main`, the real-Postgres db suite found post-merge breakage, and the `learning_events` partitioning migration was audited against the live database before applying it. Two gaps were found: three of six RLS policies were not recreated (one needed by GDPR erasure), and a materialized view would silently stay bound to the renamed backup table.
- **Decision:** Audit a destructive migration against the live catalog before applying it.
- **Why:** [Confirmed: `b3e1b98c` message]
- **Sources:** `87e9992f`, `d6c6c0b1`, `de826f4d`, `b54c0301`, `b3e1b98c`

## Challenges

- **Uncommitted WIP piling up.** [Confirmed] On 07-11 the tree held "~105 uncommitted files of feature-flagged WIP" (`docs/archive/CLEANUP_NOTES_2026_07.md`), and `4cd58a66` landed five roadmap features in one commit. The roadmap itself said the review engine was "NOT committed yet — WIP on `feature/building-scene`" (`docs/ROADMAP_10X.md` §1.1).
- **Branch sprawl and a stranded security fix.** [Confirmed] About 30 fleet branches merged in one day; the `list_courses` leak fix stayed off `main` for about two weeks (`docs/MILESTONE_2026_08.md`). `87e9992f` and `8eef7b63` (test hardening and CI fixes) were stranded on worktree branches and recovered in PR #10.
- **Features that were silently dead.** [Confirmed] Regenerate had failed on every call and was not wired to any button (`d2c33c53`); batch-uploaded lectures were never concept-ingested (`ef1a9dbf`); the title-suggestion endpoint always returned 422 (worklog B2); JSON truncation recovery never ran on real truncation (B1); the live activity feed needed a "make it actually work" fix (`044ec7c2`); Supabase mutation errors were swallowed in `lectureService` (`e9bc493b`).
- **Cross-branch migration conflicts.** [Confirmed] The partitioning migration dropped another branch's CHECK constraint (`aaa336e1`) and lost RLS policies (`b3e1b98c`). Migration timestamps also collided: `main` had two files at `20260503000020_*` (PR #9).
- **Repeated fixes on the same file.** [Confirmed: stats] Six fixes on `fullJourneyScene.ts` in one day and nine fix commits on `courses.py` in the month.
- **An abandoned approach.** [Confirmed] Osama's RBAC/ApiToken/SQLModel branch was rejected (`docs/MILESTONE_2026_08.md`). [Inferred] The two developers worked on overlapping auth problems without a shared plan, based on the parallel RBAC work and the foundation roadmap's P2-1 on the same topic.
- **Flags that hid finished work.** [Confirmed: `docs/MILESTONE_4_FIX_PLAN.md`, finding R40] Global search was fully built but its flag was defined nowhere, so it was permanently off. [Inferred] Default-off flags made it easy to ship code that no user could reach.

## Open questions

- Why was PPTX/Office support added on 07-07, given that the container image never shipped LibreOffice (PR #51 later made PPTX "explicitly unsupported in containers")?
- Why must `FEATURE_COURSE_BRAIN` stay off? The repo shows the effect (D14 in the primer) but no written decision. Was it the silent write to `course_context` without professor review?
- Who or what is "Ascend Bot"? Which tool produced these commits?
- What was the plan for the Oracle Cloud compose file, and why was Hetzner chosen instead?
- Why was the PixiJS journey path built, and when was it dropped?
- Were the fleet branches built by parallel agent sessions on purpose (one agent per initiative)? `aaa336e1` suggests so, but the setup is not documented.
- How was the RBAC work by Osama coordinated with Abdullah's P2-1 ("RLS as the auth boundary")?
- Which of the July migrations (for example `eval_runs`, partitioning) were applied to production, and when? Phase 06 shows several were still unapplied in August.

## Thesis hints

- **Requirements:** the roadmap's three gaps (open learning loop, professor-only supply, desktop-only) and its user stories for SRS and exam mode are a ready source for functional requirements. The cross-cutting standards in `docs/ROADMAP_10X.md` §3 (i18n, RLS test per table, typed events, flags) are non-functional requirements.
- **Design:** single upload pipeline and "flag-not-delete" archival (`a65b0f9d`); dedicated `noeviction` Redis for the job queue and backpressure (`43a86927`); RLS as authorisation boundary; `learning_events` as the data spine with partitioning and a materialized-view OLAP split; extracted text treated as untrusted data in prompts.
- **Implementation:** SM-2 scheduler and card factory; course-calibrated mock exams; content-hash embedding dedupe and HNSW index; LLM cost accounting per call; prompt registry with versioning; Arq DLQ and per-job locks.
- **Evaluation:** the AI eval harness with human-verified golden sets (quiz key accuracy, tutor faithfulness, retrieval precision@k) and a nightly CI band (`e2297461`); coverage figures from the worklog; the scripted feature-audit pass over 224 user stories.
- **Methodology / process:** roadmap-driven development; heavy use of AI coding agents (93 of 164 commits co-authored by Claude); the risk of parallel agent branches (the CHECK constraint lost across branches) and why the merged result must be verified end to end.
