# Phase 01 — Prototype (2026-01-23 to 2026-03-12)

*Written 2026-11-04 from `git log --all`, `git show` of the main commits, and the documents committed in the range. Nothing in this phase went through a pull request; the first PR is #1 on 2026-04-26.*

## Summary

The phase starts with a generated scaffold. The first commit (2026-01-23) is a Vite + React + TypeScript + shadcn app with a Supabase schema, a small FastAPI backend and a README that begins "Welcome to your Lovable project". It already has student and professor dashboards, a lecture viewer, quiz cards, XP, levels and badges. Over seven active days the project became "Learn Station": professors upload a PDF, the backend extracts text per page and an LLM rewrites each page into Markdown, writes a summary, a title and a quiz question. Students read the slides, answer quizzes, rate their confidence and can ask a slide-aware AI tutor. At the end of the phase the app also had professor analytics with AI insights, German legal pages (Impressum, Datenschutz), account export and delete, and JWT checks on every backend route. All of this work lived on the developer branches `abdullah` and `osama`. `main` held only the first commit until 2026-04-24.

## Where the time went

| Measure | Value |
|---|---|
| Non-merge commits (all refs) | 77 |
| Active days | 7 (01-23, 02-09, 02-11, 02-24, 03-02, 03-11, 03-12) |
| Authors | Abdullah 73, Osama 4 |
| Frontend (classic pages) | 65 commits, about 17,500 lines (81%) |
| Backend, not AI | 15 commits, about 1,400 lines (6%) |
| Backend AI | 10 commits, about 870 lines (4%) |
| Docs | 4 commits, about 860 lines (4%) |
| Database (migrations) | 4 commits, about 400 lines (2%) |
| Parser | 3 commits, about 100 lines (0%) |
| Tests | 1 commit, 7 lines |

Lines are rough. `package-lock.json` changes and committed `__pycache__/*.pyc` files inflate them. The thesis presentation PDF (`f7a0cf7a`, about 19,900 "lines") is not counted in the areas above.

- The work came in bursts, not a steady flow. 03-02 alone has 32 commits and the night of 03-11 to 03-12 has 37. Weeks pass with nothing. [Inferred: commit dates]
- Almost all effort went into the user interface. `src/pages/LectureView.tsx` was touched in 30 of 77 commits and is also the most-fixed file (9 fixes). The lecture viewer was the centre of the product from the start. [Inferred: most-touched files list]
- `src/pages/ProfessorAnalytics.tsx` (12 commits) and `src/pages/StudentDashboard.tsx` (10) come next. Analytics for professors was the second focus. [Inferred: same list]
- The AI part was small in lines but reworked often. `backend/services/ai_service.py` was touched 10 times, 4 of them fixes. Most changes were about prompt output (strip chattiness, titles instead of "Slide N") and about which provider to call. [Inferred: commit messages 2df0bc06, 10296bef, 86379610, b4ed9746]
- Testing was close to zero: one example Vitest file from the scaffold. Quality was checked by hand in the browser. [Inferred: no test files added in range]
- Commit counts measure activity, not hours. Many commits on 03-02 and 03-12 are minutes apart, which suggests small UI steps, possibly with an AI coding assistant; no commit says so. [Inferred: timestamps]

## Entries

### 2026-01-23 — Scaffold from Lovable, Supabase schema, analytics backend
- **What happened:** Osama made the first commit: a full Vite/React/TypeScript/shadcn front end with pages for landing, auth, student dashboard, lecture view, achievements, professor dashboard, professor analytics and lecture upload. A Supabase migration creates `user_roles` (enum `student`/`professor`), `profiles`, `lectures`, `slides`, `quiz_questions`, `learning_events`, `student_progress`, `achievements`, with row level security on each table and SQL functions for XP and streaks. The same evening a second commit added a FastAPI backend with an analytics service, a seed service with fake data, and a `useAnalytics` hook.
- **Decision:** Build on a generated React + Supabase scaffold. Use Supabase for auth, database and RLS, and a separate Python service for analytics.
- **Why:** The scaffold origin is [Confirmed: first-commit `README.md` starts "Welcome to your Lovable project"; `package.json` lists `lovable-tagger`; removed 2026-07-11 in `13aa25d0`]. Why a separate Python backend was chosen is not written down. [Inferred: the backend's first job was analytics with Python-side aggregation, per `backend/services/analytics_service.py`]
- **Sources:** `184e5742`, `8a34f6a0`, `supabase/migrations/20260122202809_…sql`, `backend/services/analytics_service.py`, `backend/services/seed_service.py`

### 2026-02-09 to 2026-02-13 — Project docs and first branch merge
- **What happened:** Abdullah renamed the site and icon. Osama added `project_docs/` (architecture overview, walkthrough, development guidelines, database schema, and a "reconstructed history" that explains the first commit step by step), plus scripts to check the environment and the DB connection. Abdullah merged `origin/osama` into `abdullah` on 02-13.
- **Decision:** Two personal branches (`abdullah`, `osama`) as the working model, merged by hand.
- **Why:** [Confirmed: `project_docs/reconstructed_history.md` calls itself "the missing commit history"; it was written because the first commit came in one piece.] The branch model itself has no written reason. [Inferred]
- **Sources:** `a01f20c5`, `d79e8933`, `1ace4da8`, `66616d0f`

### 2026-02-24 — PDF upload, lecture editor, AI slide enhancement with Ollama
- **What happened:** The upload flow got a backend parse endpoint (`backend/api/upload.py`, `backend/services/file_parse_service.py` with `pypdf`), a lecture editor page, storage policies for PDFs, and `react-pdf` for viewing. In `4c23d254` each slide's raw text is sent to a local Ollama model (`llama3`) that turns it into Markdown with headings and bullet points. Summary and quiz generation got try/except fallbacks. The slide viewer got a dual view (original PDF next to the AI version).
- **Decision:** Generate study content per slide with an LLM at upload time, run locally through Ollama. Keep the original page visible beside the AI text.
- **Why:** [Inferred: `OLLAMA_MODEL = "llama3"  # Change to whichever model you have pulled` suggests a free local setup for development; no reason is written down.] The dual view is an early form of the "show the original" idea that returns later. [Inferred]
- **Sources:** `be25cc1d`, `22dfd5ab`, `4c23d254`, `backend/services/ai_service.py`, `src/components/SlideViewer.tsx`, `supabase/migrations/20260224211000_storage_policies.sql`

### 2026-03-02 — Live slide sync removed, granular analytics added
- **What happened:** The "real-time lecture sync" added on 02-24 was removed again in the same commit that added granular analytics (per-slide events, confidence ratings, AI insights for professors, a lecture picker and slug URLs).
- **Decision:** Drop the live sync feature (the professor drives the slide, students follow) in favour of self-paced reading plus tracked events.
- **Why:** No reason given. [Inferred: commit message "remove live slide sync feature" only; later product direction is self-paced reading]
- **Sources:** `97e71e69`, `be25cc1d`, `src/pages/ProfessorAnalytics.tsx`, `src/pages/LectureView.tsx`

### 2026-03-02 — Thesis presentation added, product renamed "Learn Station"
- **What happened:** A PDF "Thesis Presentation" went into `vision/`. Ten minutes later the web title became "Learn Station". The rest of the day was about 30 UI commits: AI slide titles, stripping LLM preamble ("Sure! Here's…"), hero banners, streaks, lecture cards, text-to-speech, a slide confidence rating, mock analytics data, and the "Real-World Relevance" AI impact cards.
- **Decision:** Product name "Learn Station". Ask the model for real slide titles and strip conversational filler from its output.
- **Why:** The presentation suggests a thesis checkpoint on that day. [Inferred: same-day timing of `f7a0cf7a` and the burst] The filler stripping is [Confirmed: `2df0bc06` "Fix AI chattiness: strip preamble/postamble from slide content"].
- **Sources:** `f7a0cf7a`, `4d334aad`, `10296bef`, `2df0bc06`, `d9dbc440`, `2171394c`, `80579237`, `a1987a20`, `vision/Thesis Presentation.pdf`

### 2026-03-02 — Progress saving and "continue learning"
- **What happened:** Progress is saved after each slide, and the dashboard shows a "continue learning" section; unvisited lectures say "Start Learning".
- **Decision:** Persist reading position incrementally.
- **Why:** [Inferred: `5b90db53` message "incremental progress saving"; before this, progress was only stored at the end of a lecture, per the diff of `LectureView.tsx`.]
- **Sources:** `5b90db53`, `785311c6`

### 2026-03-11 — Security pass: secrets untracked, JWT on every route, RPC user id removed
- **What happened:** In about 25 minutes, five `security:` commits. The committed `.env` files were removed from tracking and added to `.gitignore`. A `verify_token` dependency (`backend/core/auth_middleware.py`) now checks the Supabase JWT on all analytics, AI and upload endpoints. Role assignment at sign-up moved into `user_metadata` with an upsert. The client no longer sends a user id to the XP and streak RPCs. API errors no longer return raw exception text.
- **Decision:** The backend trusts only a verified Supabase token. The database, not the client, decides whose XP changes.
- **Why:** [Confirmed: commit messages; `5acdb9d7` says the SQL functions "need to be updated to use auth.uid() instead of accepting p_user_id"]. No migration that makes this change on the database side appears in this phase, so the client and the SQL functions were out of step for a while. [Inferred: no matching file under `supabase/migrations/` before 2026-04-30] The env files stayed in git history; the history clean-up was closed much later (see later phases).
- **Sources:** `1fcc2bd4`, `c2b21e56`, `61d807b6`, `5acdb9d7`, `3d414cfb`

### 2026-03-11/12 — GDPR features: Impressum, privacy policy, consent, export, delete, pseudonymised events
- **What happened:** `compliance:` commits added an Impressum page (§5 TMG), a Datenschutzerklärung (Art. 13 DSGVO), a privacy consent checkbox at sign-up, "Export Data" (Art. 20) and "Delete Account" (Art. 17) in Settings, and replaced the sidebar cookie with `localStorage`. `learning_events` rows were written with a SHA-256 hash of the user id instead of the id.
- **Decision:** Treat German and EU law as a requirement of the prototype, not a later add-on.
- **Why:** [Confirmed: the commit messages name the legal articles.] The implementation was simple: export and delete run from the browser against the user's own rows, and the hash salt was a constant in the source (moved to an env var in PR #5). The pseudonymised events and the delete-by-user-id did not fit together, because deletion looked for the real id. [Inferred: `78a68c19` deletes `learning_events` by `user.id`, while `442d398b` writes a hash]. Osama removed the client-side hashing on 04-14 and moved anonymisation into the analytics service (Phase 02).
- **Sources:** `4d3f572b`, `08450538`, `2730dc98`, `78a68c19`, `442d398b`, `e613163a`, `src/lib/pseudonymize.ts`, `src/pages/Settings.tsx`

### 2026-03-12 — Notifications, leaderboard, password change, slide reordering
- **What happened:** A notification bell with triggers, a student leaderboard with optional display names, password change, and move-up/move-down for slides in the editor.
- **Decision:** Leaderboard names are optional.
- **Why:** [Inferred: `5516a81d` "with optional display names", in the same night as the privacy work]
- **Sources:** `6e79e343`, `5516a81d`, `17d7ad22`, `e2303348`

### 2026-03-12 — Ollama replaced by Gemini, then both made selectable
- **What happened:** `86379610` replaced Ollama with Google Gemini (`gemini-2.5-flash` through `google-genai`) for enhancement, summary, quiz, titles and insights, and fixed missing auth headers on PDF upload. About 20 hours later the merge `74e57029` ("Merge AI Tutor feature into abdullah") brought back Ollama next to Gemini. Each AI function takes an `ai_model` argument, and a Settings switch (`src/hooks/use-ai-model.ts`, stored in `localStorage`) lets the user pick `llama3` (default) or Gemini. `b4ed9746` added fallbacks when an AI SDK is not installed.
- **Decision:** No single provider. The provider is a runtime choice made by the user.
- **Why:** Gemini as the new path is [Confirmed: `86379610` message], but the reason (quality, speed, no local GPU) is not written down. Bringing Ollama back as the default is not explained. [Inferred: it kept the app usable without a cloud key]. This is the first sign of the "which provider" question that runs through the whole project.
- **Sources:** `86379610`, `74e57029`, `b4ed9746`, `backend/services/ai_service.py`, `src/hooks/use-ai-model.ts`, `src/pages/Settings.tsx`

### 2026-03-12 — "RAG AI Tutor" in the lecture chat
- **What happened:** A `LectureChat` component and a `POST /api/ai/chat` endpoint. The prompt contains the current slide's text, the previous chat turns and the student's question. The model is told to answer "using PRIMARILY the provided Slide Context" and may use general knowledge when the slide lacks the answer.
- **Decision:** Ground tutor answers in the slide the student is reading.
- **Why:** [Confirmed: `f7cf1b92` message and endpoint docstring "Acts as a RAG AI tutor".] It is called RAG, but nothing is retrieved: the current slide is put straight into the prompt, and there is no index, embedding or search. [Inferred: diff of `chat_with_lecture`] Real retrieval with citations came later (Phase 03).
- **Sources:** `f7cf1b92`, `70b6ae4c`, `src/components/LectureChat.tsx`, `backend/api/ai_content.py`

### 2026-03-12 — Quiz integrity fixes, KaTeX, badges, deleted-account guard
- **What happened:** Ten quiz commits in one hour: answers are locked once given, answered quizzes show again on revisit, session stats reset on load, accuracy is based on the number of questions and capped. KaTeX renders math in chat and slides. Badges for level 5/10, perfect score and completion got triggers. Users whose profile is missing are signed out. Avatar upload got its own storage bucket migration. A "Show Original Source" button opens the lecture PDF.
- **Decision:** Quiz answers count once.
- **Why:** [Confirmed: `0a26b061` "prevent users from answering quizzes multiple times", `99c9d8c5` "prevent over-counting accuracy"]. XP integrity comes back as an issue in PR #1 (04-26) and much later (PR #169, 11-01). [Inferred: same theme in those PRs]
- **Sources:** `0a26b061`, `70ef8ef3`, `d1e5e0af`, `99c9d8c5`, `19f4fc22`, `e56faf9d`, `20198b60`, `bac09006`, `bbe4fce7`, `558f3f7b`, `34352fc1`, `supabase/migrations/20260312000000_avatars_bucket.sql`

## Challenges

- **[Confirmed] Secrets in git.** `.env` and `backend/.env` were committed in the first two commits and only untracked on 03-11 (`1fcc2bd4`). Untracking does not remove them from history.
- **[Confirmed] LLM output needed cleaning.** The model added filler around slide content and produced "Slide N" titles; both needed fixes (`2df0bc06`, `10296bef`). The filler regexes were deleted again in the Gemini switch (`86379610`), and the prompt was asked to behave instead.
- **[Confirmed] Quiz state bugs.** Ten fix and feature commits on the quiz in one hour (03-12, `0a26b061` to `19f4fc22`): double answers, zero-opacity options after Framer Motion mount, score accumulation, over-counted accuracy.
- **[Confirmed] Provider back-and-forth.** Ollama → Gemini → both, within one day (`86379610`, `74e57029`).
- **[Inferred] A feature built and removed within a week.** Live slide sync arrived 02-24 (`be25cc1d`) and was removed 03-02 (`97e71e69`).
- **[Inferred] Security steps that were half done.** The RPC change needed a database migration that is not in the phase; pseudonymised event ids clashed with delete and export by user id. Basis: diffs of `5acdb9d7`, `442d398b`, `78a68c19`.
- **[Inferred] Build artefacts in git.** Python `__pycache__/*.pyc` files were committed (8 commits touched `ai_content.cpython-313.pyc`) until `aa069b92` ignored them.
- **[Inferred] Long gaps.** Nothing between 01-23 and 02-09, and between 03-02 and 03-11.

## Open questions

- Why was Lovable used for the start, and how much of the first commit was generated versus written by hand?
- Why was live slide sync removed after a week? Was it tried with real users?
- Why Gemini on 03-12, and why was Ollama (`llama3`) made the default again the next evening?
- Was `vision/Thesis Presentation.pdf` a proposal or checkpoint presentation, and to whom? What did the feedback change?
- Were the SQL functions `add_xp_to_user` / `update_user_streak` changed in the database by hand after `5acdb9d7`, outside the migration folder?
- Did the 03-11/12 GDPR pass come from a specific requirement (university, supervisor, data protection officer)?

## Thesis hints

- **Requirements:** first role model (student/professor) and the starting feature set from the scaffold; GDPR articles named in commits (Art. 13, 17, 20; §5 TMG) as early non-functional requirements; "quiz answers count once" as an integrity requirement.
- **Design:** per-slide LLM enhancement at upload time; dual view (original page next to AI text); Supabase RLS plus a FastAPI service with JWT check; provider as a user setting.
- **Implementation:** `backend/services/ai_service.py` (prompting, JSON quiz parsing, filler stripping), `backend/core/auth_middleware.py`, `src/components/LectureChat.tsx`, the first migration's schema.
- **Evaluation:** none in this phase; worth stating honestly that quality was checked by hand and that the "RAG" tutor was context stuffing, as a baseline for later retrieval work.
- **Methodology/process:** generated scaffold + two personal branches; burst-driven work; possible use of AI assistants (not confirmed in this phase).
