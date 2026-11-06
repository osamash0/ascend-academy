# Phase 02 — Two branches become one, first reviews (2026-03-13 to 2026-04-29)

*Written 2026-11-04 from `git log --all`, `git show` of the main commits, PR descriptions #1 to #6 (`gh pr view`; none of them has comments), and `docs/archive/ANALYTICS_IMPROVEMENTS_2026_04.md`.*

## Summary

At the start, the prototype from Phase 01 lived on the `abdullah` branch. `main` still held only the first commit. From 03-19 to 04-24 Osama worked alone on the `osama` branch, which started from Abdullah's 03-12 state. He added a three-layer filter that skips non-teaching slides, Groq as a third LLM provider, batch processing per slide, an auth loading fix, and anonymised professor analytics. On 04-24 Osama merged his branch into `main`, and from 04-26 Abdullah's work reached `main` too. The last four days held six pull requests, all written with Claude Code: a security review, an analytics overhaul, a fix for PDFs over ten slides, a streaming progress overlay with an optional vision path, a 21-issue pre-deployment review, and an architecture refactor that added a service layer and an LLM provider abstraction. At the end of the phase there was one trunk, a reviewed codebase and a first layered architecture. There were still no automated tests and no deployment.

## Where the time went

| Measure | Value |
|---|---|
| Non-merge commits (all refs) | 56 |
| Active days | 12 |
| Authors | Abdullah 46 (40 under his main git name and 6 under his GitHub name, the latter being GitHub squash merges), Osama 10 |
| Frontend (classic pages) | 46 commits, about 33,700 lines (71%) |
| Backend, not AI | 32 commits, about 5,550 lines (12%) |
| Other (scripts, configs, scratch files) | 25 commits, about 2,800 lines (6%) |
| Docs | 10 commits, about 2,550 lines (5%) |
| Backend AI | 19 commits, about 1,860 lines (4%) |
| Parser | 10 commits, about 1,000 lines (2%) |
| Database | 2 commits, 46 lines (0%) |

Lines are rough. The merge and rebase in late April means some changes appear twice (original commit plus a rebased or squashed copy), and `.pyc` files and `package-lock.json` inflate the numbers. Two large design passes (`8026367e`, about 5,600 lines; `680d6a32`, about 1,300 lines) account for much of the frontend share.

- Two very different rhythms. Osama made one commit every few days from 03-19 to 04-17. Abdullah was silent from 03-13 to 04-20, then made about 45 commits in 04-21 to 04-29, most of them on 04-26 and 04-29. [Inferred: commit dates]
- Analytics was the main hotspot. `src/pages/ProfessorAnalytics.tsx` was touched 24 times and fixed 10 times; `backend/services/analytics_service.py` was touched 12 times. Both developers worked on it, and PR #2 then fixed five crash bugs in it. [Inferred: most-touched list; PR #2 table]
- The AI service was the second hotspot: `backend/services/ai_service.py` 19 touches, 9 fixes, including a merge conflict (`2ab02218`). It grew a branch per provider (`if ai_model == "groq" … elif …`) until PR #6 added a provider interface. [Inferred: diffs of `76aa4b42`, PR #6 body]
- `src/pages/LectureUpload.tsx` (17 touches) and `src/components/LectureChat.tsx` (14 touches, 8 fixes) show upload and the tutor were still unstable. [Inferred]
- A lot of effort went into look and feel: an "orbital" design overhaul, light/dark theme, glassmorphism, 3D charts with React Three Fiber, an "Eye-Care Paper" theme. Several of these were later dropped or redone (see later phases). [Inferred: commit messages 8026367e, 3cbac42d, 05066fee, 680d6a32]
- From 04-26 on, much of the code was written by an AI coding agent. PRs #1 to #6 end with "Generated with Claude Code", their branches are `claude/<name>` worktrees, and `227267e7` / `70158d27` carry a "Co-Authored-By: Claude Sonnet 4.6" line. [Confirmed: PR bodies, commit trailers]

## Entries

### 2026-03-19 to 2026-03-27 — Osama's branch: DB config and auth loading loop
- **What happened:** Osama branched from Abdullah's last commit of 03-12 (`558f3f7b`). He changed the backend DB connection setup and fixed an authentication loading loop in `src/lib/auth.tsx` that touched every guarded page.
- **Decision:** none recorded.
- **Why:** [Confirmed: `4aa041e6` "Authentication Loading Loop Fix"]. The exact cause is not described. [Inferred: the diff changes how `AuthProvider` waits for the profile]
- **Sources:** `03fd5c02`, `4aa041e6`, `src/lib/auth.tsx`

### 2026-03-20 — Three-layer slide content filter
- **What happened:** Osama added `backend/services/content_filter.py` and three planning documents under `project_docs/`. Every page goes through (1) a fast pattern heuristic (title, contact, date, admin, "thank you", agenda slides), (2) an information-density score built from content words, unique-word ratio and length, and (3) an LLM-as-a-judge for borderline pages. Pages marked as metadata get no AI summary or quiz.
- **Decision:** Not every PDF page is teaching content. Classify first, enrich only teaching pages.
- **Why:** [Confirmed: `project_docs/implementation_plan_slides_filtering_v2` says equal processing "wastes API tokens and produces useless quiz questions" such as a quiz about the lecturer's e-mail address.] The cheap layers run first to save cost. [Confirmed: same document, "zero cost, ~1ms" / "~5ms"]
- **Sources:** `bfbe6c09`, `backend/services/content_filter.py`, `project_docs/implementation_plan_Slides_filtering`, `project_docs/implementation_plan_slides_filtering_v2`

### 2026-03-29 — Groq as third provider, one batch call per slide
- **What happened:** Osama added Groq (`llama-3.3-70b-versatile`) as a third choice next to Ollama and Gemini and made it the default in the model picker. A new `process_slide_batch` asks the model for all of a slide's content (enhanced text, summary, quiz, title) in one structured call, using a Pydantic `SlideBatchResult`.
- **Decision:** Groq as default provider; one LLM call per slide instead of several.
- **Why:** The batch call is [Confirmed: code comment "Batch Processing (Upload optimization)"]. Why Groq was chosen is not written down. [Inferred: hosted Llama 3.3 runs fast and needs no local GPU; a `test_groq.py` probe was committed alongside]
- **Sources:** `76aa4b42`, `backend/services/ai_service.py`, `src/hooks/use-ai-model.ts`, `test_groq.py`

### 2026-04-10 — README stripped; PDF parsing service wired to auth
- **What happened:** On GitHub, Osama removed the Lovable text, project details and deployment instructions from `README.md`. These are the only commits besides the first one that landed directly on `main` before 04-24. On his branch he connected the upload, parse and AI endpoints to the auth provider.
- **Decision:** none recorded.
- **Why:** [Confirmed: `3d3b6efb` "Removed project information and editing instructions from README".] Why the details were removed is not stated. [Inferred: the repository is public]
- **Sources:** `3d3b6efb`, `82747d3b`, `636d8256`

### 2026-04-14 to 2026-04-17 — Analytics rework and anonymised student names
- **What happened:** Osama rewrote large parts of `ProfessorAnalytics.tsx` (about 850 lines changed) and `analytics_service.py`. He removed the browser-side hashing of user ids in `learning_events` (added 03-12) and wrote real ids again. Instead, the analytics service shows each student to the professor under a deterministic anonymous name derived from a hash of the id.
- **Decision:** Pseudonymise at the reporting layer, not at storage.
- **Why:** [Confirmed: `52ead4b5` "users Anonymization in the analytics".] Why storage-side hashing was dropped is not written. [Inferred: hashed ids broke per-user progress, export and delete; see Phase 01 Challenges]
- **Sources:** `3abfaa54`, `52ead4b5`, `backend/services/analytics_service.py`, `src/pages/LectureView.tsx`

### 2026-04-21 to 2026-04-24 — "Unified setup" and the merge into `main`
- **What happened:** On 04-21 Abdullah added a `dev.sh` script and made "Unified setup from abdullah with osama features" (`aeff698b`) on top of Osama's branch. The same evening he committed an "orbital design overhaul" on his own branch (about 35 files). On 04-24 Osama fixed a nested scrollbar loop in the slide viewer and merged `osama` into `main` (`27fec458`, 101 files, including all of Abdullah's Feb/Mar work). Abdullah's branch was then rebased onto `main` (copies such as `629272b2` of `2bde7388`), and from here the `abdullah` line is the first-parent history of `main`.
- **Decision:** One trunk (`main`); the personal branches stop being the source of truth.
- **Why:** [Confirmed: messages of `aeff698b` and `27fec458`.] The timing is not explained. [Inferred: it was needed before PR-based review could start two days later] The orbital overhaul `8026367e` and the unified commit `aeff698b` never reached `main`; they survive only as tags (`archive/unified-merged-branch`, `archive/UI-enhancement`). The design was redone on 04-29 (`680d6a32`).
- **Sources:** `2bde7388`, `aeff698b`, `8026367e`, `fc345c89`, `27fec458`, `629272b2`, tags `archive/unified-merged-branch`, `archive/UI-enhancement`

### 2026-04-26 — `load_dotenv(override=True)` enters the AI service
- **What happened:** After the merge, `0561ed27` ("fix: load_dotenv override, vite envDir, and AI model defaults") made `ai_service.py` load the root `.env` with `override=True`, so values in the file win over the process environment.
- **Decision:** The `.env` file overrides environment variables.
- **Why:** [Inferred: after the merge the backend picked up stale or empty variables from the shell, and the quick fix was to let the file win.] This line later moved into `backend/services/ai/orchestrator.py` and became a known trap: importing it could replace a blanked environment with production values. It was fixed on `main` by PR #99 much later. [Confirmed: `CLAUDE.md` "Traps"]
- **Sources:** `0561ed27` (rebased copy of `42d6adc8`), `backend/services/ai_service.py`, `CLAUDE.md`

### 2026-04-26 — Working through Claude Code worktrees
- **What happened:** From this day, features were built in Claude Code worktrees on branches named `claude/<random-name>` and opened as PRs, or merged by hand. Several commits accidentally added `.claude/worktrees/<name>` gitlinks to the repo (`16f8e35b`, `79f0f57e`, `05066fee`, `1e099c83`). Branches that were not merged are kept as `archive/claude/*` tags (for example a high-quality AI narration voice, `e8250f59`).
- **Decision:** Use an AI coding agent for reviews and larger changes, with a PR per change.
- **Why:** [Confirmed: PR bodies end "Generated with Claude Code"; branch names `claude/affectionate-grothendieck-af3ee0`, `claude/epic-carson-650ee7`, `claude/jolly-mendeleev-cc7a1b`.] The reason for adopting it is not written. [Inferred]
- **Sources:** `16f8e35b`, `05066fee`, `e8250f59`, tags `archive/claude/*`, PRs #1, #2, #5

### 2026-04-26 — PR #1: full-stack security and performance review
- **What happened:** Removed an unauthenticated DB test endpoint, added an owner check on analytics routes (non-owners get 403), a 50 MB cap and MIME check on PDF upload, removed auth debug prints, deleted a duplicate Supabase client (`backend/db.py`), removed `as any` casts, added `.limit()` and explicit column lists to unbounded queries, added Pydantic response models and field bounds, moved blocking Supabase calls to a thread pool, and fixed quiz XP being earned twice after a reload. It also noted that `src/integrations/supabase/types.ts` was corrupted (it held server log output).
- **Decision:** Every route checks resource ownership, not just login. Requests and responses are typed and bounded.
- **Why:** [Confirmed: PR #1 body, ordered by severity "Critical / High Impact / Nice to Have".] All issues named there were fixed in the PR.
- **Sources:** PR #1 (`fcf97a16`, branch `claude/affectionate-grothendieck-af3ee0`), `backend/core/auth_middleware.py`, `backend/api/analytics.py`, `backend/api/upload.py`

### 2026-04-26 — PR #2: professor analytics overhaul
- **What happened:** Fixed five backend bugs that made two analytics endpoints return 500 on every request (an undefined variable, a wrong event name `slide_viewed` vs `slide_view`, a camelCase key mismatch, a variable used before assignment, a missing function). Added four endpoints: distractor analysis, drop-off slide, confidence by slide, and the (anonymised) questions students asked the tutor. Added nine dashboard sections and replaced a hard-coded `localhost` API URL with `VITE_API_URL`.
- **Decision:** Show professors data that was already collected but never displayed.
- **Why:** [Confirmed: PR #2 body "surfacing data that was collected but never exposed"; `docs/archive/ANALYTICS_IMPROVEMENTS_2026_04.md`.]
- **Sources:** PR #2 (`a4473169`, branch `claude/epic-carson-650ee7`), `backend/services/analytics_service.py`, `src/pages/ProfessorAnalytics.tsx`, `docs/archive/ANALYTICS_IMPROVEMENTS_2026_04.md`

### 2026-04-26 — 3D analytics and an AI mind map
- **What happened:** React Three Fiber was added with a "neural background", a 3D scatter plot and volumetric 3D bars in professor analytics. A `3d-web-experience/SKILL.md` (an agent skill file) came with it. The same evening an AI-generated mind map per lecture was added, with its own endpoint, component and table (`lecture_mind_maps`).
- **Decision:** Try 3D visualisation for analytics; store a generated mind map per lecture.
- **Why:** none recorded. [Inferred: design exploration; later the project adopted "figures not gauges" and calm, flat visuals, per `CLAUDE.md`]
- **Sources:** `05066fee`, `5ae0af49`, `3cb29fa3`, `172bed4b`, `4b94f0dd`, `supabase/migrations/20260426_lecture_mind_maps.sql`, `3d-web-experience/SKILL.md`

### 2026-04-28 — PR #3: PDFs with more than ten slides failed
- **What happened:** Large uploads timed out. Root causes: `time.sleep()` inside a sync generator blocked FastAPI's event loop, the Groq call blocked too, all slides were held back until one final event (a dropped connection lost everything), dense slides hit token limits silently, and there was no retry on HTTP 429. The fix made the parser an `async` generator with blocking work in an executor, sent each slide as its own SSE event, capped slide text at 4,000 characters, retried Groq with backoff, and added no-buffering headers for proxies.
- **Decision:** Stream results per slide over SSE; never block the event loop; retry on rate limits.
- **Why:** [Confirmed: PR #3 body "Root Causes" table and the commit body of `2187c094`.]
- **Sources:** PR #3 (`8eb214cf`, `2187c094`), `backend/services/file_parse_service.py`, `backend/services/ai_service.py`, `backend/api/upload.py`, `src/pages/LectureUpload.tsx`

### 2026-04-28 — PR #4: progress overlay, PyMuPDF and an optional vision path
- **What happened:** The upload spinner became an overlay with three steps (Upload → Extract → AI Enhance), a bar that fills per slide, and a live list of slide titles. The parser was rewritten on PyMuPDF. An optional vision path renders image-heavy pages (pdf2image + Pillow) and sends them to Groq or Gemini vision models, falling back to text when poppler is missing. Merging needed a conflict resolution because the PR #3 squash and the branch touched the same files.
- **Decision:** Use page images and vision models for pages where text extraction is not enough; keep text as the fallback.
- **Why:** [Confirmed: PR #4 body; `227267e7` "PyMuPDF for better text extraction … vision pipeline … for image-heavy slides".] This is the first appearance of the vision approach that much later won the thesis parser benchmark (PR #168, 2026-11-01). [Inferred: same idea, not the same code]
- **Sources:** PR #4 (`ac71c1a4`, `227267e7`), `70158d27`, `backend/services/file_parse_service.py`, `backend/requirements.txt`

### 2026-04-28 — Presentation folder for the supervisor
- **What happened:** A `presentation/` folder with a project overview, technical report, slide outline, Mermaid diagrams and a database tuning SQL file. Its README says it contains materials "for your project presentation to your professor".
- **Decision:** none recorded.
- **Why:** [Confirmed: `presentation/README.md`.] The texts read like generated drafts. [Inferred: style and second-person wording]
- **Sources:** `dcf1d336`, `presentation/`

### 2026-04-29 — PR #5: pre-deployment review, 21 issues
- **What happened:** Four critical fixes (a toast listener leak, a stale closure that reported near-zero slide durations, an unhandled promise in the tutor chat, an O(n²) analytics loop), ten major ones (hard-coded API URLs, two env names for one service, a shared `useAiModel` hook, bare `except` replaced by logged errors, `print` debug replaced by `logging`, an app-wide error boundary, `.claude/settings.local.json` ignored) and seven minor ones (pseudonymisation salt moved to `VITE_ANON_SALT`, timeouts named in `src/lib/constants.ts`, logins excluded from study-time scoring).
- **Decision:** Fix correctness and logging before any deployment.
- **Why:** [Confirmed: PR #5 body "No new features — pure correctness, reliability, and maintainability fixes".] The stale closure meant slide-time analytics collected before this date were wrong. [Inferred: PR #5 description of the bug]
- **Sources:** PR #5 (`a334ec35`, branch `claude/jolly-mendeleev-cc7a1b`)

### 2026-04-29 — PR #6: service layer, domain types, LLM provider abstraction
- **What happened:** Frontend: one `apiClient` that adds the bearer token, `src/types/domain.ts` as the single type source, services for student, lecture and analytics data, and pure gamification functions in `src/domain/gamification.ts`. Direct `supabase.from()` calls outside services went from 36+ to zero. Backend: Pydantic `BaseSettings` config that fails fast without Supabase settings, domain models, authorisation helpers, an anonymisation module, an `LLMProvider` protocol with Groq, Gemini and Ollama implementations plus a factory, and repository modules.
- **Decision:** Layered architecture: UI → service → data; business rules out of React components; providers behind one interface.
- **Why:** [Confirmed: PR #6 body, "This PR implements the system design review findings from the principal engineering audit"; the problem stated is scattered DB calls and business logic in components.] The PR says itself that RPC calls, storage and auth were not yet moved, the backend services still used the raw client, and the provider factory was "ready to replace" the `if/elif` chains but did not yet do so.
- **Sources:** PR #6 (`261ee952`, `1903409e`), `src/lib/apiClient.ts`, `src/services/`, `src/domain/gamification.ts`, `backend/core/config.py`, `backend/domain/llm.py`, `backend/repositories/`

### 2026-04-29 — AI slide generation, study-time insights, dictionary
- **What happened:** Professors can generate a slide with AI in the editor. Students got an "Insights" page and an optimal-schedule card based on when they study (circadian analysis). A `DICTIONARY.md` glossary was added.
- **Decision:** none recorded.
- **Why:** none recorded. [Inferred: features for the analytics story of the thesis]
- **Sources:** `d13cb3d5`, `1e099c83`, `1fe8d9fe`, `src/pages/Insights.tsx`, `src/components/OptimalScheduleCard.tsx`, `DICTIONARY.md`

## Challenges

- **[Confirmed] Merge conflicts after the branches met.** `2ab02218` "resolve ai_service.py merge conflicts"; `70158d27` resolved conflicts between the PR #3 squash and the branch and states that the branch version is "a strict superset".
- **[Confirmed] Analytics was broken without anyone noticing.** PR #2 found two endpoints that returned 500 on every request, and PR #5 found slide durations recorded as near zero. Both point to no tests and little real use.
- **[Confirmed] Large PDFs failed.** PR #3 lists five root causes, all about blocking calls and all-or-nothing delivery.
- **[Confirmed] A corrupted generated file.** PR #1 notes that `src/integrations/supabase/types.ts` contained server log output instead of types.
- **[Inferred] Duplicate and abandoned history.** Rebasing the `abdullah` branch onto `main` produced copies of commits (`2bde7388` / `629272b2`, `42d6adc8` / `0561ed27`), and work such as the orbital overhaul (`8026367e`), the light/dark toggle (`3cbac42d`) and the AI narration voice (`e8250f59`) only survives in `archive/*` tags. Basis: `git merge-base --is-ancestor` checks.
- **[Inferred] Repo hygiene.** Scratch and test scripts (`scratch/`, `fix_analytics.py`, `patch.py`, `test_groq.py`), `.pyc` files and `.claude/worktrees/*` gitlinks were committed.
- **[Inferred] A four-week gap on one side.** Abdullah made no commits from 03-13 to 04-20; the second half of the phase was compressed into nine days.
- **[Inferred] Design churn.** Orbital overhaul (04-21), glassmorphism and theme toggle (04-26), 3D charts (04-26), "Orbital Campus" and "Eye-Care Paper" (04-29), all within nine days.

## Open questions

- Why was Groq made the default provider on 03-29, and was the quality of Groq, Gemini and Ollama ever compared?
- What was the "principal engineering audit" that PR #6 implements? Was it a document, an agent prompt, or a supervisor review?
- Why did Abdullah's work pause from 03-13 to 04-20 (exams, thesis writing, other work)?
- Why was `override=True` added to `load_dotenv` on 04-26? What problem did it fix?
- Was the content filter (03-20) measured on real lecture decks, and how many pages did it skip?
- Was the 3D analytics experiment shown to anyone, and why was it later dropped?
- What is `uiux-designer/` and when did it come in? It appears around 04-26 together with the agent work; its purpose is not written.

## Thesis hints

- **Requirements:** "not every page is teaching content" (content filter plan); professor needs from PR #2 (drop-off, distractors, confusion per slide); privacy by pseudonymised reporting.
- **Design:** three-layer filter (heuristic → density score → LLM judge) as a cost-aware design; per-slide SSE streaming; vision with text fallback; layered architecture and `LLMProvider` protocol (PR #6).
- **Implementation:** `backend/services/content_filter.py`, `backend/services/file_parse_service.py` (async generator, PyMuPDF), `backend/domain/llm.py`, `src/lib/apiClient.ts`, `src/services/`.
- **Evaluation:** the PR #3 root-cause table and the PR #2 / PR #5 bug lists work as evidence of the quality problems before reviews and tests; no measured evaluation yet.
- **Methodology/process:** move from personal branches to one trunk and PR review; start of AI-agent-assisted development (Claude Code worktrees, PR #1 to #6); review-driven hardening before deployment.
