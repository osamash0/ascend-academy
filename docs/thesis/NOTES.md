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

**Tech stack.** Frontend: React 18 + TypeScript + Vite + Tailwind (`src/`). Backend: FastAPI (`backend/main.py`, routes in `backend/api/v1/`). Background jobs: Arq worker on Redis (`backend/workers/arq_worker.py`). PDF parsing: Docling 2.94. LLM access: ~~LiteLLM runs as its own gateway *container* — the backend calls it over HTTP~~ — **see the correction below; this is no longer true.** Data/auth/files: Supabase (Postgres with Row-Level Security, Auth, Storage). Production: ~~6 Docker containers (redis, redis-queue, litellm, api, frontend, worker)~~ **five** on one Hetzner VM via docker-compose.prod.yml.

**Key design decisions noted (why to be deepened in later sessions).**
- Slow work (PDF parsing, LLM calls) runs in a background worker, not the API process → Session 2/3.
- ~~One LiteLLM gateway in front of many LLM providers → provider fallback without code changes~~ → superseded; the fallback is now in-process, see the correction below → Session 3.
- Human review before publishing AI output → quality gate → Session 3.
- Frontend talks BOTH to Supabase directly (auth, RLS-guarded queries) AND to the FastAPI backend — invisible at C4 L1, appears in Session 2's container diagram.

**Diagrams produced.** `Diagrams/01-system-context.html` (C4 L1), `Diagrams/02-feature-map.html` (3-stage core loop: create → learn → engage/insight, with insights feedback). Both pass the diagram-design geometry + self-check scripts.

**Terms to be able to define.** C4 model (L1 context / L2 container), SPA, background worker/job queue, ~~LLM gateway~~ provider chain / failover registry, Row-Level Security, feature flag, spaced repetition (deepened Session 5).

---

### ⚠ Correction, 2026-09-17 — the LLM architecture in this session is out of date

**Do not carry the gateway description into the thesis.** It was accurate when written on 2026-08-25 and stopped being so within days: the LiteLLM container was removed on 2026-08-25, and `litellm/config.yaml` is now dead code.

Verified against the repository on 2026-09-17:

| claimed above | actual |
|---|---|
| LiteLLM runs as its own gateway container | **no gateway.** `backend/services/ai/orchestrator.py` calls providers directly; it contains no gateway reference at all |
| provider fallback is a gateway concern, "without code changes" | fallback is **in-process**: a `PROVIDER_REGISTRY` (`orchestrator.py:150`) with two ordered chains, `BULK_CHAIN` (`:245`) for high-volume slide analysis and `QUALITY_CHAIN` (`:251`) for planning — nine providers each, ordered differently |
| 6 production containers incl. `litellm` | **5**: `redis`, `redis-queue`, `api`, `frontend`, `worker` (`docker-compose.prod.yml`) |

Two things follow for the writing phase:

1. **The design decision to defend has changed shape.** "One gateway in front of many providers" is a different argument from "two ordered chains with different priorities — capacity-first for bulk, quality-first for planning." The second is the one the code supports, and it is the more interesting claim.
2. **Prefer the figures over these notes.** `thesis/figures/` was built later and got this right — F11 (provider failover) cites `orchestrator.py:150-238` directly, and `MANIFEST.md` warns that `README.md` and `docs/` describe a system that partly no longer exists. That warning applies to this file too, which is why the correction is here rather than assumed.

Left struck through rather than deleted: a note that quietly self-updates gives no signal about which *other* claims may have aged, and this file is explicitly raw material for later writing.

### ⚠ Also: the two diagrams recorded above were never committed

"Diagrams produced" names `Diagrams/01-system-context.html` and
`Diagrams/02-feature-map.html`. Neither is in the repository, on any branch:
`Diagrams/` is empty and `git log --all --diff-filter=A -- 'Diagrams/*'`
returns nothing, so they were never added in the first place. Treat them as
lost unless they turn up outside git.

Largely moot in practice — the thesis figures went a different route and
superseded them. `thesis/figures/` holds 19 figures as PDF and SVG, generated
from PlantUML sources with a `MANIFEST.md` recording, per figure, which source
files it was derived from and which claim it supports. That is a stronger
artifact than the 10 teaching diagrams this plan envisaged, and it is what the
LaTeX skeleton wires in.

**Open / unclear items.** Quiz answers pending (asked at end of Session 1). SVG exports of diagrams deferred to the writing phase.
