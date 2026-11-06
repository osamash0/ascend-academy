# Phase 04 — Pipeline unification and the feature audit (2026-06-10 to 2026-06-30)

*Written 2026-11-04 from `git log --all`, selected diffs and the files under `project_docs/feature_audit/`. Read-only; no code was changed.*

## Summary

At the start of the phase, Learnstation had just been released as "v3.0". It had four parser paths side by side (v2 `file_parse_service`, the dormant v3 Arq stages, the v4 orchestrator, external extractors), and the frontend saved parse output to the database itself. Over three weeks the team did three things. They closed a set of security gaps, starting with a dev Redis that was reachable from the internet. They added a server-authoritative gamification engine and an admin role. And they built one "unified" pipeline, `PARSER_VERSION=5`. It reuses the v2 routing engine (layout, OCR, vision), writes lectures, slides and quizzes on the server, tracks runs in the v3 `parse_runs` table, and borrows v4's per-slide prompts. Its LLM can be chosen by configuration, so it can run on OpenAI now and a self-hosted university model later. Osama restructured the API into `/api/v1` with a service layer. The phase ended with a code-derived audit of 258 user stories and a round of fixes, with the config default set to `PARSER_VERSION=5` "to match the live deployment".

## Where the time went

| Measure | Value |
|---|---|
| Non-merge commits (all refs) | 51 |
| Active days | 12 |
| Authors (git names) | Abdullah 33, Osama 18 |
| AI co-authored | 28 commits carry `Co-Authored-By: Claude …` (all by Abdullah) |
| Backend other | 30 commits, ~7.4k lines (31%) |
| Frontend tests / e2e | 4 commits, ~4.5k lines (18%) |
| Frontend (classic rooms) | 15 commits, ~4.2k lines (17%) |
| Backend tests | 15 commits, ~3.3k lines (14%) |
| Backend parser | 17 commits, ~1.9k lines (8%) |
| Other | 10 commits, ~1.0k lines (4%) |
| Database | 5 commits, ~1.0k lines (4%) |
| Backend AI / Luna | 7 commits, ~0.6k lines (2%) |
| Infra / CI / scripts | 9 commits, 86 lines (0%) |
| i18n, docs | 1 commit each |

Lines are rough. `343890c5` also added `Dataset/RWI-UNI-SUBJECTS.csv` (106k lines, a university subject catalogue). The stats file seems to count it outside these areas. The 4.5k e2e lines come mostly from mocks and tests in the same commit.

- **The parser work was short and dense.** 15 pipeline commits fell on 06-15 to 06-17, 11 of them on 06-17 alone. This was a planned "Phase 0 / Phase 1" sequence, each commit with its own tests. [Confirmed: commit titles "Phase 0", "Phase 1a", "Phase 1b", "Phase 1 task 10".]
- **Churn sat in config and wiring, not in one big file.** `backend/main.py`, `docker-compose.yml` (6 each), `.env.example`, `backend/core/config.py`, `backend/api/upload.py` and `unified_orchestrator.py` (5 each). Most-fixed: `v4_orchestrator.py` (3). This fits a phase of switching pipelines by flag. [Inferred from the touch counts.]
- **Security was a steady thread.** 7 commit messages say "security". They cover ports and Redis/LiteLLM auth, path traversal, protected profile columns, professor read scope, rate limits and file validation. [Confirmed: `6a7c8306`, `58126a7b`, `07c8c11c`, `377f7fa1`.]
- **The two developers worked on separate tracks.** Abdullah worked on the pipeline, the gamification engine and the audit. Osama worked on the API structure, chat memory, the tutor and a later SQLModel/Alembic/RBAC branch. Their tracks met in two merges on 06-24, and the audit four days later found breakage from that merge. [Confirmed: `d5e4a96e`, `feb05a8f`.]

## Entries

### 2026-06-10/11 — Academic fingerprint: university email verification and profile editing
- **What happened:** `0c596030` added `profiles.university_email` and an RPC `link_university_email()`. It matches the email domain to a known university and sets `institution_verified`. `5fe0b26d` made real users discoverable in Friends. `40e4007e` lets students edit their academic profile in Settings. This continues the 06-09 catalogue, personalization and recommendations work.
- **Decision:** Use a soft "domain trust" check, with no emailed code.
- **Why:** [Confirmed: `0c596030` "Students usually register with a personal email … Domain-trust is a soft check (no emailed ownership code yet)".]
- **Sources:** `0c596030`, `5fe0b26d`, `40e4007e`, `supabase/migrations/20260615000600_link_university_email.sql`

### 2026-06-12 — Incident response: dev services bound to loopback, Redis and LiteLLM authenticated
- **What happened:** `6a7c8306` bound every published dev port to `127.0.0.1`. It made `REDIS_PASSWORD` required (fail-fast) and made the LiteLLM gateway require a master key that the backend presents. Two follow-ups made sure the LiteLLM config file was tracked (`dfab33f2`, `0f3e3fad`).
- **Decision:** The dev compose gets the same exposure rules as prod. Remote access goes only through the university network / VPN.
- **Why:** [Confirmed: commit body "Incident response: an unauthenticated Redis on the dev compose was publicly reachable on the GPU server … anyone who could reach :4000 could drive our LLM provider keys". Fixed in this commit.]
- **Sources:** `6a7c8306`, `dfab33f2`, `0f3e3fad`, `docker-compose.yml`

### 2026-06-15 — Gamification engine, admin role, analytics redesign
- **What happened:** `343890c5` added `20260616000000_gamification_engine.sql` with `badge_definitions`, `grant_xp()`, `award_badge()` and `evaluate_badges()`. It added an admin role, an admin dashboard and API, error logging, the `Ascent` page, a redesigned professor analytics service (following `docs/analytics-redesign/`, 06-05), and several RLS / FK index / ownership migrations.
- **Decision:** Move XP and badges from client code to one idempotent server-side engine.
- **Why:** [Confirmed: migration header "replaces the three out-of-sync lists in gamification.ts / Ascent.tsx / inline LectureView code" and "dedup was enforced only by a client-side SELECT-then-INSERT, which is race-prone".]
- **Sources:** `343890c5`, `supabase/migrations/20260614000000_add_admin_role_and_error_logging.sql`, `20260616000000_gamification_engine.sql`, `docs/analytics-redesign/00-brief.md`

### 2026-06-15 — Security and API hardening from a review
- **What happened:** `58126a7b` sanitized the PDF file name before it is used on disk in `odl_service` (path traversal). It added a trigger that stops users from writing their own XP/level/streak/verified columns, and limited professors' reads of learning events and progress to students in their own courses. `07c8c11c` added 30/min rate limits to six AI endpoints and moved a blocking filter off the event loop ("review findings M2, M3, L4, L6"). `6f3513a7` fixed a quiz query on a column that does not exist.
- **Decision:** Professor data access is scoped by course enrolment. Privileged profile columns are written only by server functions.
- **Why:** [Confirmed: commit bodies; all three issues are described as closed there.]
- **Sources:** `58126a7b`, `07c8c11c`, `6f3513a7`, `supabase/migrations/20260620000000_protect_profile_privileged_columns.sql`, `20260621000000_scope_professor_read_policies.sql`

### 2026-06-15 — v4 hardened; `working-baseline-2026-06-16` tag
- **What happened:** `d15c4ace` ("pre-v4-hardening snapshot") fixed an `ai_model` override, added embeddings and removed a `TEST_SLIDE_LIMIT`. `61dd4e42` reworked `v4_orchestrator.py` (330 lines): caching, parallel batching, a meta event, a quiz index fix. `93bfa0c3` removed hard-coded `PARSER_VERSION=2` from the local compose. The tag `working-baseline-2026-06-16` points at `93bfa0c3`.
- **Decision:** Mark a known-good state before the pipeline rework.
- **Why:** [Inferred: the tag name and its position directly before the "Phase 0" commit. The v4 commit has no body.]
- **Sources:** `d15c4ace`, `61dd4e42`, `93bfa0c3`, tag `working-baseline-2026-06-16`

### 2026-06-16 — Phase 0: stop silent wrong answer keys
- **What happened:** `f25dd41c` fixed two "live correctness bugs on the v4 upload path". First, when the LLM's `correctAnswer` did not exactly match an option, the answer index silently fell back to option A. It is now resolved by `quiz_validator._normalize_answer_index`, and questions that still do not match are dropped and logged. Second, a cache replay lost the deck summary and deck quiz because of a cache shape mismatch.
- **Decision:** Drop, do not default. A quiz question with an unresolvable key is removed.
- **Why:** [Confirmed: commit body "unmatched questions are dropped + logged instead of shipping a wrong key"; pinned by `backend/tests/unit/test_v4_quiz_mapping.py`.]
- **Sources:** `f25dd41c`

### 2026-06-17 — Phase 1a: the unified orchestrator (pipeline version 5)
- **What happened:** `4f19bd1e` added `parser/unified_orchestrator.py` (job `parse_pdf_unified`) and `parser/persist.py`. It composes the tested v2 engine (`parse_pdf_stream`: layout routing, OCR, VLM vision, overlapping-window batching, blueprint, quota guard). It writes lectures, slides and quiz questions on the server, tracks the run in `parse_runs` with `pipeline_version "5"`, and replays a completed run from the database. `3a0e21ac` (self-review) stopped duplicate lectures on re-runs and finalized the slide count when a later step failed.
- **Decision:** The database, written by the server, is the single source of truth for parse output. The pipeline must be vision-capable.
- **Why:** [Confirmed: `4f19bd1e` "fixes the two things v4 could not do": server-authoritative persistence ("the frontend no longer persists parse output") and real-world PDFs. "On the Marburg ML PowerPoint (the file that exposed v4's blindness) — v4/cerebras forced 142/143 slides to TEXT; unified routes 88 to VISION".]
- **Sources:** `4f19bd1e`, `3a0e21ac`, `backend/services/parser/unified_orchestrator.py`, `backend/services/parser/persist.py`

### 2026-06-17 — Phase 1b: routing, frontend cutover, real-Postgres e2e
- **What happened:** `15c39418` registered the job in `arq_worker.py`. It added a unified branch in `upload.py` that is used at `PARSER_VERSION=5` (or `parser=unified`), with SSE over Redis and an inline fallback. `c4849614` made the frontend use the server-created `lecture_id`. The server also uploads the source PDF to storage. `e6f039dc` added `backend/tests/db/test_unified_pipeline_e2e.py` (testcontainers, all migrations). That test found that `repos` held a stale `None` database pool, so every v5 parse "would have failed in prod despite green unit tests".
- **Decision:** Additive rollout behind the flag; v4 stays the current path until switched.
- **Why:** [Confirmed: `15c39418` "Additive: inert at PARSER_VERSION=4 (current)"; `e6f039dc` explains the bug was latent "because the only caller (v3) is dormant".]
- **Sources:** `15c39418`, `c4849614`, `e6f039dc`

### 2026-06-17 — Separate bulk and vision models; configurable LLM for a university model
- **What happened:** `d984f48c` uses a fast bulk model (Cerebras) for text slides and the deck, and a vision model (`VISION_MODEL`, default `gemini-2.0-flash`) only for image and diagram slides. `cd3e39b2` added `PARSER_LLM_MODEL`, `OPENAI_MODEL`/`OPENAI_BASE_URL` (any OpenAI-compatible endpoint, e.g. vLLM) and `LLM_TIMEOUT_SECONDS`. `a12666cd` added OpenAI `gpt-4o-mini` as a vision provider. `6458cad2` documented the new variables.
- **Decision:** The server decides the model, not each upload. One code path serves OpenAI for testing and a self-hosted, OpenAI-compatible university LLM later.
- **Why:** [Confirmed: `cd3e39b2` "one code path serves OpenAI (testing) and a self-hosted OpenAI-compatible university LLM (prod) by env only"; `a12666cd` "the free Gemini vision tier rate-limits almost immediately → vision calls fail → slides fall back to 'Slide N'"; `d984f48c` avoid "paying the vision model's cost/latency on every text slide".]
- **Sources:** `d984f48c`, `cd3e39b2`, `a12666cd`, `6458cad2`, `backend/core/config.py`, `backend/services/llm_client.py`

### 2026-06-17 — Per-slide synthesis replaces batched analysis in v5
- **What happened:** `c3692c6f` derived real titles from the slide's own text, skipping repeated header and footer lines, and surfaced vision content when the summary field was empty. `bd03f1d5` then rewrote `parse_pdf_unified` to make one focused LLM call per slide (text or vision). A narrative carries from slide to slide, plus a lecture meta call and a validated deck quiz. It reuses v4's `analyze_*` prompt functions.
- **Decision:** Choose quality and isolation per slide over fewer batched calls.
- **Why:** [Confirmed: `bd03f1d5` the batched v2 analysis "produced 'Slide N' titles + blank explanations on real decks (a batch timeout/rate-limit blanked 8 slides at once)"; result "0/8 slides blank" on a Marburg DB deck. `c3692c6f` calls this the "v5-vs-v4 regression".]
- **Sources:** `c3692c6f`, `bd03f1d5`, `backend/services/file_parse_service.py`

### 2026-06-22/23 — API versioning, service layer, chat memory (Osama)
- **What happened:** `7f0f2066` moved all routers to `backend/api/v1/`. It added global domain exceptions, error response schemas and 307 redirects from old paths. `21b4d8a2` extracted a service layer and standardized pagination. `3ae22281`, `615340fd` and `377f7fa1` sanitized exceptions and added rate limits, file validation, a proxy middleware and admin audits. `c96a4d32` and `a04b6499` added Redis-backed chat session memory. `8fac2fc3` added Redis and database-transaction infrastructure. `e62286b4` added startup scripts and a lecture editor UI.
- **Decision:** Version the API under `/api/v1` and keep old paths working with redirects.
- **Why:** [Inferred from the diffs; the commits have no body. The `/api/v1` layout is still the structure today (CLAUDE.md "routes under `backend/api/v1/`").]
- **Sources:** `7f0f2066`, `21b4d8a2`, `377f7fa1`, `c96a4d32`, `a04b6499`, `8fac2fc3`, `e62286b4`

### 2026-06-24 — Tutor may add outside knowledge, flagged in blockquotes
- **What happened:** `f39e93dc` (Osama) removed the tutor's hard refusal path (`_REFUSAL_REPLY`, `_is_out_of_scope`). The prompt changed from "Answer STRICTLY from the RETRIEVED CONTEXT" to "Base your answers primarily on" it. Any extra knowledge must be wrapped in a Markdown blockquote and labelled as going beyond the slides. `LectureChat.tsx` styles those blockquotes.
- **Decision:** Move from deck-only grounding to grounded-first with labelled supplements.
- **Why:** [Inferred: the code comment "Ensure we don't hard-refuse if the question is conceptual". It suggests the strict refusals blocked useful conceptual answers. No written reason. `8f986043` later updated the tests to "assert the tutor now answers grounded".]
- **Sources:** `f39e93dc`, `f802fc00`, `backend/services/ai/tutor.py`, `src/components/LectureChat.tsx`

### 2026-06-24 — HTTP/2 disabled in Supabase clients; branches merged
- **What happened:** `19cb884f` switched token checks from the SDK's `get_user` to a direct httpx call, and created every Supabase client with HTTP/2 off. It also stabilized `StudentDashboard` effects. `64b7a439` and `d5e4a96e` merged the shared `abdullah` branch and Osama's `refactoring` branch.
- **Decision:** HTTP/1.1 for Supabase calls.
- **Why:** [Confirmed: commit title "to prevent ConnectionTerminated errors". The root cause is not described.]
- **Sources:** `19cb884f`, `64b7a439`, `d5e4a96e`

### 2026-06-25 — Hybrid search, Arq offloading, SQLModel/Alembic: built but not merged
- **What happened:** Osama committed hybrid search for tutor retrieval (`a7ca20b9`, migration `20260624200000_hybrid_search.sql`), an Arq worker for heavy AI operations (`840314c4`, `0cfa70a5`), and SQLModel schemas with Alembic and an async engine (`1c2348b4`, `e2fae499`, `cb32f925`). RBAC and API tokens followed in July. None of these 11 commits are on `origin/main`. They survive only in the tag `archive/Refactoring`.
- **Decision:** none recorded. The changes were not merged.
- **Why:** [Unclear. Inferred: Supabase SQL migrations stayed the only schema source (CLAUDE.md), so an Alembic schema would have been a second, competing one.]
- **Sources:** `a7ca20b9`, `0cfa70a5`, `1c2348b4`, `cb32f925`, tag `archive/Refactoring`

### 2026-06-28/29 — Feature audit: 258 user stories, then fixes
- **What happened:** `8470f9d8` added `project_docs/feature_audit/FEATURE_AUDIT.xlsx`. It is built by `build_workbook.py` from `audit_data.py`/`audit_data2.py`, with one row per user story across 15 feature areas. Each row has role, expected behaviour taken from the code, key files, and columns for code status (P1), test result (P2), fix (P3) and retest (P4). The P1 status from reading the code: 214 Functioning, 35 Partial, 3 Broken, 6 Unclear. Fixes followed. `feb05a8f`: the backend could not be imported at all because of an `IndentationError` left in `tutor.py` when the refusal helper was removed. A logging handler crashed on a reserved key. A dependency was missing. `parser_version` default 2 → 5 "to match the live deployment". `c1ff2eef` fixed frontend UX issues. `8f986043` reconciled the tests with the v1 restructure (backend 638, frontend 209 passing). `b91dd731` fixed PDF-10 (a v4 cache could be replayed at v5) and AUTH-29: account deletion left the auth user behind ("a GDPR erasure gap"), so a new server-side delete endpoint was added. `29440f95` added practice-sheet RLS DB tests.
- **Decision:** Audit every feature from the code, as user stories, before more building. Track fixes per story ID (e.g. PDF-10, AUTH-29).
- **Why:** [Confirmed for the method: `8470f9d8` and the `audit_data.py` header ("derived from the CURRENT code (post v1-restructure merge on branch `abdullah`)"). Inferred for the timing: it came right after two large merges.]
- **Sources:** `8470f9d8`, `feb05a8f`, `c1ff2eef`, `8f986043`, `ab233101`, `b91dd731`, `29440f95`, `project_docs/feature_audit/`

## Challenges

**[Confirmed]**
- **v4 could not see images.** On a real PowerPoint deck v4 routed 142 of 143 slides to text (`4f19bd1e`). The first v5, which wrapped v2's batching, then produced "Slide N" titles and blank explanations: one rate-limited batch blanked 8 slides (`a12666cd`, `c3692c6f`, `bd03f1d5`). It took three commits on one day to reach parity with v4.
- **Free vision tiers were unreliable.** Gemini's free vision tier "rate-limits almost immediately" (`a12666cd`), which pushed the team to a paid OpenAI vision provider.
- **Bugs hidden by mocks.** The stale database pool in `repos` passed all unit tests and was found only by the real-Postgres e2e test (`e6f039dc`). The dormant v3 path had carried it unnoticed.
- **A merge broke the whole backend.** The tutor change left orphaned `return` lines, so the backend would not import. Only the audit found it (`feb05a8f`).
- **Config drift.** The `PARSER_VERSION` default was `2` in config and `.env.example` while the live server ran 4 and then 5 (`15c39418` "PARSER_VERSION=4 (current)", `feb05a8f` "2→5 to match the live deployment"). `.env.example` was aligned only on 06-28 (`8470f9d8`, PDF-02). The cache-invalidation guard missed v5 (`b91dd731`, PDF-10).
- **A security incident on the GPU server** (open Redis, unauthenticated LiteLLM), fixed on 06-12 (`6a7c8306`).
- **Competing schema tooling.** SQLModel and Alembic work stayed on a side branch (`archive/Refactoring`).

**[Inferred]**
- **Three parser generations stayed in the tree.** v5 reuses v2's engine and v4's prompt functions ("they relocate to a shared module when v4 is archived (Phase 2)", `bd03f1d5`). So the old pipelines could not simply be deleted yet. That cleanup was left for later.
- **Little visible coordination.** Two developers on two tracks, with the merges on 06-24 and the audit following, suggest that integration problems showed up late.

## Open questions
- Which `PARSER_VERSION` ran on the GPU server on each date (2, 4, 5), and when exactly was it switched to 5? Only the code comments give hints.
- Why did the tutor move from strict deck-only grounding to "grounded first, labelled supplements" (`f39e93dc`)? Was this based on student feedback or tests?
- Why were hybrid search, the Arq offloading of AI work, SQLModel/Alembic and RBAC (`archive/Refactoring`) never merged?
- What caused the `ConnectionTerminated` errors that led to disabling HTTP/2 (`19cb884f`)?
- Was a self-hosted university LLM ever set up after `cd3e39b2`, and which model was planned?
- Who wrote the audit rows (258 stories): an AI agent, a person, or both? How were the P2 test results collected?

## Thesis hints
- **Requirements:** the feature audit is a ready-made, dated requirements catalogue (258 user stories, 15 areas, roles, expected behaviour). Story IDs like AUTH-29 (GDPR erasure) link requirements to fixes.
- **Design:** the server-authoritative persistence decision; the split into a bulk model and a vision model; the "OpenAI now, university LLM later" provider abstraction; the drop-not-default rule for quiz keys; the server-side gamification engine as one source of truth.
- **Implementation:** pipeline version 5 as a composition of earlier versions (v2 routing + v3 run tracking + v4 per-slide prompts); flag-gated rollout via `PARSER_VERSION`; `/api/v1` versioning with redirects.
- **Evaluation:** measured routing (142/143 text in v4 vs 88 vision in v5 on one deck); blank-slide counts (8 blank → 0/8); audit status counts (214/35/3/6); test totals (449–450 unit, 638 backend / 209 frontend after reconciliation). Each comes from a commit message and should be re-run before it is cited as a result.
- **Methodology / process:** a planned Phase 0 / Phase 1 sequence with tests per step; self-review commits; real-database e2e tests catching what mocks missed; the audit as a quality gate after the merges; AI co-authoring on 28 of 51 commits.
