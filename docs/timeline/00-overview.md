# Development timeline: Step 1, overview

*Written 2026-11-04. Source: git history of all refs, `gh pr list`, dependency files and the docs in the repo. No diffs were read for this step. Step 2 checks every claim made here against the commits.*

## 1. Size of the history

| Measure | Value |
|---|---|
| Commits on all refs (local, remote, tags) | 1,850 |
| Commits reachable from `origin/main` | 1,471 |
| First-parent commits on `origin/main` (what landed, in order) | 490 |
| Merge commits (all refs) | 251 |
| Branch refs (local + remote) | 103 |
| Tags | 77 (73 `archive/*`, plus `milestone/2026-08-consolidation`, `milestone/2026-10-release`, `working-baseline-2026-06-16`) |
| Pull requests on GitHub (`osamash0/ascend-academy`) | 171: 163 merged, 7 closed, 1 open (#170) |
| First commit | `184e5742`, 2026-01-23, "first commit" |
| Last commit on `origin/main` | `2b8b1f7b`, 2026-11-02, merge of #171 |
| SQL migration files added on `origin/main` | 139 additions (136 files exist today, so a few were renamed or removed); most were added in May (37), June (27), July (47) and October (20) |

The local `main` is behind `origin/main` (it stops at #167). The timeline uses `origin/main`.

### Commits per month (all refs; `origin/main` in brackets)

| Month | Commits | Note |
|---|---|---|
| 2026-01 | 2 (2) | scaffold |
| 2026-02 | 7 (7) | |
| 2026-03 | 73 (69) | two bursts: 03-02 and 03-11/12 |
| 2026-04 | 58 (40) | branches merged 04-21 to 04-24; PRs start 04-26 |
| 2026-05 | 156 (143) | 05-02/03 alone: about 120 commits |
| 2026-06 | 84 (72) | |
| 2026-07 | 192 (181) | 07-21: about 30 branch merges in one day |
| 2026-08 | 238 (180) | nothing 08-01 to 08-14 (4 commits on 08-15); 08-17/18 consolidation and fix night |
| 2026-09 | 95 (86) | nothing 09-19 to 10-09 |
| 2026-10 | 923 (676) | half of all commits; weeks of 10-05 (331) and 10-26 (416) |
| 2026-11 | 22 | up to 11-02 |

### Authors (as git records them)

| Name in git | Commits | Comment |
|---|---|---|
| Abdullah, main git name | 1,451 | |
| Abdullah, GitHub name | 165 | mostly PR merge commits made on GitHub |
| Abdullah, a third account (`…1`) | 111 | almost all on 2026-05-02/03; messages like "Task #45", "Saved progress at the end of the loop", "Git commit prior to merge" look like an automated coding agent (Replit Agent) **[Inferred]**; the repo has `docs/archive/replit.md` ("Replit-era project memory") |
| Osama, three git names | 101 | second developer; owns the GitHub repo |
| Claude | 14 | AI coding agent commits |
| Ascend Bot | 8 | |

The first `package.json` (2026-01-23) contains `lovable-tagger`, and `13aa25d0` (2026-07-11) is "chore: remove lovable metadata". So the app was most likely scaffolded with the Lovable generator **[Inferred]**.

## 2. Technology changes, read from the dependency files

Frontend (`package.json`):

| Date | Commit | Change |
|---|---|---|
| 2026-01-23 | `184e5742` | Vite, React 18, TypeScript, Tailwind, shadcn/Radix, Supabase JS, TanStack Query, react-router, Recharts, framer-motion, zod, Vitest |
| 2026-02-24 | `be25cc1d`, `4c23d254` | `react-pdf` (PDF viewer); `react-markdown`, `remark-gfm` |
| 2026-03-12 | `20198b60` | KaTeX math rendering |
| 2026-04-26 | `05066fee` | three.js / React Three Fiber (3D analytics experiments) |
| 2026-05-02 | `23da3b34`, `bee91bd2` | MSW, coverage, Testing Library (test strategy) |
| 2026-05-03 | `715e578f` | i18next (English and German) |
| 2026-05-03 | `cf45c5aa` | d3-hierarchy (mind graph) |
| 2026-06-02 | `da77cfd5` | Sentry |
| 2026-06-05 | `d35565d4` | Hono, better-auth, pg, bcrypt, JWT (a Node backend) ... |
| 2026-06-08 | `b9ea605e` | ... removed again three days later as "orphaned dependencies", with many unused Radix packages |
| 2026-06-05 | `226db45f` | Playwright |
| 2026-07-07 | `76085a14` | PixiJS (cinematic onboarding) |
| 2026-08-31 | `0dbc641d` | `motion` ("Motion owns animation, CSS stops"), v4 design |
| 2026-10-10 | `e595b245` | `streamdown` (Markdown renderer for Studio) |

Backend (`backend/requirements.txt`):

| Date | Commit | Change |
|---|---|---|
| 2026-01-23 | `184e5742` | FastAPI, uvicorn, SQLModel, Supabase, asyncpg |
| 2026-02-24 | `be25cc1d` | `pypdf`, `ollama` (local LLM for slide enhancement) |
| 2026-03-12 | `74e57029` | `google-genai` ("migrate from ollama to gemini", `86379610`) |
| 2026-04-26 | `fcf97a16` | `groq`, `edge-tts` |
| 2026-04-28 | `227267e7` | PyMuPDF, pdf2image, Pillow |
| 2026-05-01 | `7ffb0cd2` | "Production-grade PDF parsing pipeline with Cerebras": tenacity, tiktoken, Tesseract, PaddleOCR, pandas |
| 2026-05-01 | `b1c7a428` | pdf2image removed (CHANGELOG: memory leak) |
| 2026-05-02 | `e5aa6119`, `23da3b34`, `458ddab9` | slowapi (rate limits), pytest stack, `openai` client |
| 2026-05-07 | `4b54991e` | `llama-cloud-services` (LlamaParse) |
| 2026-05-19 | `6ce7b5f1` | **Parser v3:** Docling, Arq (Redis job queue), FastEmbed, LiteLLM |
| 2026-06-02 | `da77cfd5` | `sentry-sdk` |
| 2026-06-22 | `8fac2fc3` | `redis` |
| 2026-07-07 | `b35a861a` | MarkItDown (PPTX import) |
| 2026-07-15 | `3fd4b146` | Resend (e-mail) |
| 2026-07-19 | `df62cd3c` | Prometheus metrics |
| 2026-08-25 | `68a091e0` | LiteLLM gateway container removed ("remove the dead LiteLLM gateway") |
| 2026-10-10 | `58114939` | Docling and LiteLLM removed from requirements |
| 2026-10-13 | `5d8c0225` | `pillow-heif` (photos of notes become PDFs) |
| 2026-10-24 | `70dafabb` | FastEmbed removed |
| 2026-10-26 | `bf837f44` | `pikepdf` (packed reader copy of the PDF) |

Infrastructure files: `Dockerfile` 2026-05-01; `.github/workflows/ci.yml` 2026-05-02; `docker-compose.yml`, `Dockerfile.frontend` and the Arq worker 2026-05-19; `docker-compose.prod.yml` 2026-06-08; `docker-compose.oracle.yml` 2026-07-12; `docker-compose.staging.yml` 2026-07-22.

LLM providers in order of appearance: Ollama (02-24), Gemini (03-12), Groq (03-29 / 04-26), Cerebras (05-01/02), LiteLLM gateway (05-19 to 08-25), OpenAI-compatible provider (06-17, "OpenAI now, self-hosted university LLM later", `cd3e39b2`), in-process failover chains (09-18), "OpenAI-only AI" for launch (#92, 10-16).

## 3. Documents read

- `README.md`, `CHANGELOG.md` (release notes until 2026-06-09 "Parser v3.0", then one line per PR), `CLAUDE.md`, `docs/START_HERE.md`, `docs/INVENTORY.md` (which doc is current or historical).
- `docs/thesis/THESIS_PLAN.md` (2026-08-28: thesis title, proposed RQ1 to RQ3) and `docs/thesis/NOTES.md` (Session 1, with a dated correction about the LiteLLM gateway).
- Listed, to be read per phase in Step 2: `docs/ROADMAP_10X.md`, `docs/ROADMAP_10X_FOUNDATION.md`, `docs/MILESTONE_2026_08.md`, `docs/MILESTONE_4_FIX_PLAN.md`, `docs/ROADMAP_PHASE2_RECONCILIATION.md`, `docs/design-v4/`, `docs/READER_TWO_FACES_*.md`, `docs/superpowers/specs/` and `plans/`, `docs/archive/`, `thesis/README-thesis.md`, `thesis/figures/MANIFEST.md`.
- There are no ADR files. The closest things to decision records are the specs in `docs/superpowers/specs/`, the roadmap documents and the PR descriptions.

## 4. Proposed phases

| # | Phase | Dates | One line |
|---|---|---|---|
| 1 | Prototype | 2026-01-23 to 2026-03-12 | A scaffolded React + Supabase app becomes "Learn Station": lecture viewer, AI slide enhancement (Ollama, then Gemini), first RAG tutor, quizzes, badges, GDPR pages. |
| 2 | Two branches become one, first reviews | 2026-03-13 to 2026-04-29 | The two developers' branches (backend parsing and analytics, Groq) are merged; PRs #1 to #6 bring a security review, an analytics overhaul, a parser fix and a service-layer refactor. |
| 3 | Parsing pipeline and the feature burst | 2026-05-01 to 2026-06-09 | Production PDF pipeline (Cerebras), test strategy and CI, an agent-driven burst of features (RAG tutor with citations, EN/DE, "Ask Your Data"), then Parser v3 (Docling, Arq, LiteLLM, Docker), released as v3.0. |
| 4 | Pipeline unification and the feature audit | 2026-06-09 to 2026-06-30 | Academic profile, social, gamification engine, a single server-side "unified orchestrator" (PARSER_VERSION=5, vision-capable), and a 258-user-story feature audit. |
| 5 | 10x roadmap and the platform foundation | 2026-07-01 to 2026-07-30 | Roadmap-driven features (review engine, exam mode, batch upload, PPTX import, trust signals, brand voice), then the "Foundation" audit carried out as about 30 fix branches merged on 07-21 (security, GDPR, worker reliability, cost accounting, eval harness). |
| 6 | Consolidation and the whole-app audit | 2026-08-17 to 2026-08-28 | 83 branches folded into one trunk, egress overage fixed, a five-part app audit and an overnight fix run (#9 to #50), the LiteLLM gateway removed, the first thesis figures. |
| 7 | The v4 redesign and the thesis apparatus | 2026-08-29 to 2026-09-18 | A full design rebuild (v4: Spaces, Library, Lesson reader), the evaluation harness and LaTeX skeleton, CI made honest, provider chains revived in-process. |
| 8 | Reader intelligence, Luna, launch prep | 2026-10-05 to 2026-10-19 | The intelligent reader (Explain, checkpoints, rehearsal), the Luna avatar and tutor, a monochrome brand, a deck-plan-first parser, OpenAI-only AI, v4 in German, GDPR export and erasure. |
| 9 | v4 live for real people | 2026-10-20 to 2026-10-30 | Two audit weeks, sign-up on the v4 stage, classic rooms retired for students, Luna study sessions, instant reader, real legal pages, domain move to learnstation.app, monitoring and backups, documentation reset. |
| 10 | Evaluation and polish | 2026-10-31 to 2026-11-02 | Quiz answer check, the thesis parser benchmark (blind duels between extractors), XP integrity, a calmer Spaces hub. |

Why these boundaries: each one sits at a visible break in the history, either a quiet gap (03-13 to 04-20, 08-01 to 08-14, 09-19 to 10-09), a release or merge event (v3.0 on 06-09, the 07-21 merge fleet, the 08-17 consolidation, the v4 merge on 08-31), or the point where v4 went live for students (10-24 onward).

## 5. Things to settle before Step 2

1. **Phase list.** Do the 10 phases work for you, or would you rather merge some (for example 4 with 5, or 9 with 10)?
2. **Scope of branches.** Step 2 would use `origin/main` and its PRs as the main record and look at side branches only where they explain a decision (for example the archived parser branches). Unmerged local-only branches (`archive/thesis/finishing-pass`, `local-only/*`) would be mentioned by name only.
3. **People and tools.** The timeline would name the two developers by role ("developer A", "developer B") or by name, as you prefer, and would say plainly where an AI coding agent wrote commits (Replit Agent in May, Claude and Codex later). That matters for a methods section, but it is your call how to present it.
