# Thesis Session Notes

## Session 1 — Bird's-eye view (2026-08-25)

**What Learnstation is.** An AI-assisted learning platform for university students. Core loop: a professor (or student) uploads lecture PDFs → the backend parses and AI-structures them into interactive content (structured slides + quiz cards) → a human reviews and publishes → students study the content interactively (viewer, quizzes, spaced repetition, mock exams) → every study action emits events that feed gamification (XP/badges) and professor analytics → insights inform future teaching. Public name: Learnstation (repo: ascend-academy), live at learnstation.duckdns.org.

**Roles.** Student (learns, reviews, can upload own materials and create courses) and Professor (creates courses, uploads lectures, reviews AI output, reads analytics). A small admin surface exists (`src/pages/AdminDashboard.tsx`) but is not a primary role.

**Feature inventory (one-liners).**
- AI content pipeline — PDF → Docling parse → LLM structuring → review → publish (`backend/api/v1/upload.py`, `backend/workers/arq_worker.py`) — the thesis core
- Batch review — professor approves/edits AI output before students see it (`src/pages/BatchReviewPage.tsx`)
- Course management — courses/lectures incl. student-created courses (`backend/api/v1/courses.py`)
- Interactive lecture viewer — structured content next to the original PDF (`src/pages/LectureView.tsx`)
- Daily Ascent — spaced-repetition review engine (`src/pages/Ascent.tsx`, `backend/api/v1/review.py`, flag FEATURE_REVIEW_ENGINE)
- Mock exam mode — timed exams from generated questions (`src/pages/MockExam.tsx`, `backend/api/v1/exams.py`, flag FEATURE_EXAM_MODE)
- Gamification — server-authoritative XP/badges/leaderboard (Supabase RPCs `grant_xp`/`award_badge`)
- Professor analytics — engagement dashboards (`backend/api/v1/analytics.py`, `src/pages/ProfessorAnalytics.tsx`)
- Onboarding — cinematic first-run experience (`src/pages/Onboarding.tsx`)

**Tech stack.** Frontend: React 18 + TypeScript + Vite + Tailwind (`src/`). Backend: FastAPI (`backend/main.py`, routes in `backend/api/v1/`). Background jobs: Arq worker on Redis (`backend/workers/arq_worker.py`). PDF parsing: Docling 2.94. LLM access: LiteLLM runs as its own gateway *container* — the backend calls it over HTTP, it does NOT use the litellm Python SDK in the live path. Data/auth/files: Supabase (Postgres with Row-Level Security, Auth, Storage). Production: 6 Docker containers (redis, redis-queue, litellm, api, frontend, worker) on one Hetzner VM via docker-compose.prod.yml.

**Key design decisions noted (why to be deepened in later sessions).**
- Slow work (PDF parsing, LLM calls) runs in a background worker, not the API process → Session 2/3.
- One LiteLLM gateway in front of many LLM providers → provider fallback without code changes → Session 3.
- Human review before publishing AI output → quality gate → Session 3.
- Frontend talks BOTH to Supabase directly (auth, RLS-guarded queries) AND to the FastAPI backend — invisible at C4 L1, appears in Session 2's container diagram.

**Diagrams produced.** `Diagrams/01-system-context.html` (C4 L1), `Diagrams/02-feature-map.html` (3-stage core loop: create → learn → engage/insight, with insights feedback). Both pass the diagram-design geometry + self-check scripts.

**Terms to be able to define.** C4 model (L1 context / L2 container), SPA, background worker/job queue, LLM gateway, Row-Level Security, feature flag, spaced repetition (deepened Session 5).

**Open / unclear items.** Quiz answers pending (asked at end of Session 1). SVG exports of diagrams deferred to the writing phase.

## Session 2 — Architecture & deployment (backfilled from the Notion export; original session date not recorded)

**What's inside the box.** Five processes, one Docker network, shaped like a spine: a request enters at the top, and slow work falls downward through a queue into a separate process. Core structural fact: the API never does slow work itself — it validates, enqueues, and answers immediately; a different container (the worker) picks the job up.

**The five containers.** `frontend` — nginx, serves the built SPA and reverse-proxies `/api/` → `api:8000` (one origin for the browser, static files stay out of Python). `api` — FastAPI under uvicorn, pinned to 1 worker (fast, short requests only). `worker` — Arq: Docling parsing + LLM calls (slow work, isolated so it can't stall the API). `redis` — app cache, evictable. `redis-queue` — job broker, durable, not evictable.

**Two Redis containers, one correctness rule.** Both `redis:7-alpine`, differing only in policy: `redis` is `256mb allkeys-lru` (safe — every entry is rebuildable if lost); `redis-queue` is `128mb noeviction appendonly yes` (an enqueued parse job must never vanish). The rule: you cannot host a job queue on an LRU-evicting cache — LRU would silently delete a student's queued upload and nobody would find out.

**Two backends, not one.** The browser talks to nginx→FastAPI *and* to Supabase directly via `supabase-js` (62 files in `src/` import `client.ts`). No single backend chokepoint — the publishable key is compiled into the JS and public by design; what actually protects the data is Row-Level Security inside Postgres (deepened in Session 4).

**Two journeys through the system.** A — professor uploads a PDF: browser → nginx `/api/` → FastAPI (`upload.py`) validates/stores/enqueues and returns in milliseconds; `worker` dequeues → Docling parse → LLM calls → writes to Supabase; progress streams back over SSE via the queue Redis's pub/sub. B — student opens a lecture: browser loads the SPA from nginx, then reads lecture/slide/quiz rows straight from Supabase (RLS deciding visibility) — FastAPI may not be involved at all. Put together: the student in B stays fast *because* the professor's work in A was pushed out of the request path — the answer to "why async."

**Diagrams produced.** `Diagrams/03-container-architecture.html` (C4 L2, the five containers), `Diagrams/04-deployment.html`.

**Terms to be able to define.** Reverse proxy, job queue/broker, eviction policy (`allkeys-lru` vs. `noeviction`), AOF (append-only file), readiness vs. liveness probe, OOM kill, SSE (Server-Sent Events).

**Open / unclear items.** None recorded in the source export.

## Session 5 — Consuming the content: interactive learning features (2026-08-31)

Sourced from this session's own code-verified research (`docs/thesis/LEARNING_FEATURES_PRIMER.md` — three independent research passes, then every load-bearing claim personally re-checked at the source), not a single read-through.

**Naming trap, worth getting right before anything else.** `src/pages/Ascent.tsx` is the gamification hub (XP, badges, mind map) — not the spaced-repetition screen. The actual review UI is `src/features/review/ReviewSession.tsx` at `/review`. "Daily Ascent" is the feature's internal codename; "Ascent" the nav item is a different page that happens to share the word.

**Structured content vs. the raw PDF.** The lecture viewer isn't a toggle between "structured" and "raw" — both can render at once, in two columns, but only under specific conditions (wide screen, the "slide" tab active, chat closed). The original PDF stays fully available — a "Source PDF" button opens it in a new tab — so nothing is thrown away after parsing.

**Two quiz surfaces, opposite trust decisions.** In-lecture quizzes send the full answer key to the browser and grade the click locally — instant feedback, no server round trip. Mock exams do the opposite on purpose: the question fetch excludes `correct_answer` entirely, and grading only happens server-side, recomputed against the database. Same underlying data, deliberately different trust boundary depending on the stakes.

**Daily Ascent's card lifecycle.** Cards move new → learning → review, using an SM-2-style ease factor and interval. Failing a card ("again") is asymmetric: a card still in `learning` just stays there and comes back in 10 minutes; only a card that already graduated to `review` gets demoted to `relearning`. One precise gap worth remembering: for a card's *first two* successful reviews, "hard" and "good" produce the exact same interval — they only start to diverge once a card is mature.

**Exam mode overview.** A mock exam is a seeded, weighted sample of the question bank, timed with a 30-second grace window. If a student closes the tab and never comes back, that attempt becomes a permanent, invisible row — there's no cleanup job for it, and the app never actually fetches the exam-history endpoint it defines, so there's no way for a student to rediscover it either.

**Diagrams produced.** `08-student-learning-flow.html`, `09-srs-state-machine.html`.

**Terms to be able to define.** SM-2 / spaced repetition, ease factor, lapse vs. graduation, trust boundary (client-graded vs. server-graded), idempotent submission.

**Open / unclear items.** Both the review engine and exam mode are fully built but unreachable in a default deployment — their feature flags default off, and the frontend one has no path to `true` through this repo's own build files. Worth deciding whether the thesis treats this as a Chapter 6 "built vs. deployed" finding or a gap to close before evaluation.
