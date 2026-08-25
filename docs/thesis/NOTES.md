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
