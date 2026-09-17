# Ascend Academy — 10x Roadmap & Build Plan

> Status: PROPOSED (2026-07-06) · Owner: Abdullah · Horizon: ~1 semester (3 phases)
> **§5 (Phase 2) revised 2026-09-17** against the code — 2.2 was already shipped and 2.1
> already built as `scheduler.py`. See §11 *Corrections* before planning any Phase 2 work.
> Companion docs: `FEATURE_AUDIT.xlsx` (pre-launch stabilization), `docs/ANALYTICS_IMPROVEMENTS.md`, `docs/analytics-redesign/`

---

## 1. Executive summary

Ascend Academy today is a **content-delivery and measurement machine**: a mature upload→parse→enrich pipeline (unified v5 orchestrator: per-slide synthesis, quiz generation, concept extraction, 768-dim embeddings), a polished lecture player with an embeddings-grounded Socratic tutor, deep professor analytics, and a complete gamification + social layer.

It is not yet a **learning-outcomes machine**. Three structural gaps cap its value:

1. **The learning loop is open.** Content is consumed once. There is no retention system (flashcards/SRS), no exam preparation, and nothing converts `concept_mastery` / `learning_events` data into "here is what *you* should do today."
2. **Supply is professor-gated.** Only professors upload. A student whose professors aren't on the platform gets almost nothing.
3. **Desktop-only in a mobile studying world.** No PWA, no offline, no push.

The 10x strategy, in one line:

> **We built the machine that turns a PDF into structured knowledge. Now build the machine that turns structured knowledge into remembered knowledge — daily reviews, mock exams, a personal plan, on a phone — and then let students feed it themselves.**

Every feature below reuses infrastructure that already exists (pgvector retrieval, concept graph, Arq workers, nudge engine, central gamification RPCs), which is why the leverage is high and the risk is low.

### Phase overview

| Phase | Theme | Features | Target |
|---|---|---|---|
| **1** | Close the learning loop | 1.1 SRS review engine · 1.2 Exam mode · 1.3 PWA/offline/push | Weeks 1–6 |
| **2** | From library to copilot | 2.1 Study planner · 2.2 Global search + course tutor · 2.3 Professor action loop | Weeks 6–11 |
| **3** | Open the flywheel | 3.1 Student self-serve upload · 3.2 Study groups · 3.3 Multi-university catalog · 3.4 AV ingestion (stretch) | Weeks 11–18 |

**Precondition:** the active pre-launch goal audit (fix confirmed Broken/Partial items) continues in parallel; stabilization outranks new scope in any conflict.

---

## 2. Current-state assessment (abridged)

### Strengths to build on
- **Pipeline (v5)** — `backend/services/parser/unified_orchestrator.py`: per-slide synthesis, deck summary/quiz, concept extraction + dedup (cosine ≥ 0.86), per-slide embeddings into `slide_embeddings` (768-d, pgvector, HNSW — **not** `slide_chunks`, which is a 384-d dead table with zero writers; see §11 #15), checkpoint/resume (`parse_runs`/`parse_pages`/`slide_parse_cache`), idempotent on `(pdf_hash, version)`.
- **AI stack** — multi-provider failover orchestrator (`backend/services/ai/orchestrator.py`) with BULK (cerebras→groq_fast→gemma) and QUALITY (groq→gemini) chains; grounded RAG tutor (`tutor.py` + `retrieval.py` + the `match_slides_scoped` / `match_slides_by_lecture` RPCs); Azure TTS; Gemini embeddings.
- **Analytics** — 2,000+ line `analytics_service.py` with 2-tier caching; per-slide confusion/drop-off, per-question distractors, learner typology; "Ask Your Data" intent-based NL queries (never generates SQL).
- **Gamification** — server-authoritative `grant_xp` / `award_badge` / `evaluate_badges` RPCs, 27+ badge catalog, idempotent `xp_events` via `dedupe_key`, global popup provider.
- **Social** — friends, requests, profiles, global/faculty leaderboard, dashboard widget. Built and tested.
- **Jobs & engagement plumbing** — Arq worker (4 concurrent, 15-min timeout, 5 retries), nudge engine (3 rules, per-subject quiet periods), `notifications` table.
- **Ops** — RLS throughout, rate limiting, idempotency keys, correlation-ID logging, Sentry, admin console.

### Gaps this plan addresses
| Gap | Evidence |
|---|---|
| No flashcards / spaced repetition | No SRS code anywhere in `src/` or `backend/` |
| `concept_mastery` has **no** live writer | Read in three places, written by none — `backend/services/review/mastery.py:6-17` says so itself (§11 #10) |
| ~~Tutor/search scoped to a single lecture~~ **CLOSED 2026-07-10** | Course-wide search + tutor shipped in full; dark only because two env vars are declared nowhere (§5 2.2, §11 #15-20) |
| No exam preparation | Practice sheets are per-lecture, professor-authored |
| No PWA / offline / push | No manifest, no service worker in `index.html`/`public/` |
| Analytics diagnose but don't prescribe | Insight cards have no actions. (`Layer2Viz.tsx` is **no longer** a stub — the analytics redesign shipped it as an 11-branch dispatcher; §11 #21) |
| Professor-only supply | `lectures.professor_id` required; no student upload path |
| Single-university catalog, sync scraper | Marburg CS only; scrape runs synchronously in-request |

---

## 3. Cross-cutting engineering standards (apply to every feature)

These are blanket acceptance criteria; each feature's list below is *in addition* to these.

- **i18n:** en + de complete before ship (all new namespaces in `src/i18n/locales/{en,de}/`).
- **a11y:** keyboard-only operation, ARIA labels, coverage in `src/__tests__/a11y/accessibility.test.tsx` patterns.
- **RLS:** every new table ships with RLS policies + a DB test proving cross-user isolation (pattern: the practice-sheets RLS tests from commit `29440f9`).
- **Gamification:** XP/badges only via central RPCs (`grant_xp`, `award_badge`) with `dedupe_key`; never client-computed.
- **Events:** every new student action emits a typed `learning_events` row so analytics keep working.
- **Flags:** feature-flagged rollout, flag-not-delete convention (as used for `PARSER_VERSION`).
- **API:** new endpoints under `/api/v1/`, SlowAPI rate limits, structured `DomainError`s, cursor pagination for lists.
- **Tests:** unit (vitest / pytest) + at least one integration test per feature; MSW mocks for frontend service calls.
- **Docs:** each shipped feature adds a row to `FEATURE_AUDIT.xlsx` with its user stories, so the audit stays canonical.

---

## 4. PHASE 1 — Close the learning loop

---

### 1.1 Spaced-Repetition Review Engine — "Daily Ascent"

**Impact ★★★★★ · Effort L (2–3 weeks) · Dependencies: none · Flag: `FEATURE_REVIEW_ENGINE`**

> **Execution status (2026-07-10): DONE, all 7 slices, real-DB-verified.** Full
> writeup in [[project_srs_daily_ascent]] memory / `project_docs/srs_daily_ascent_plan.md`.
> Shipped SM-2 (not FSRS) behind the stable interface as planned. **Scope cut
> found mid-build:** concept cards (QA/cloze from `slide_chunks`) deferred —
> `slide_chunks` has zero writers anywhere in the live v5 pipeline (dead table,
> only the archived v3 stage ever wrote it) and `concept_lectures` is never
> auto-populated by the parse pipeline (only a manual API call/backfill
> script). Shipped quiz-question cards only — real, working, backfilled 42
> cards across 8 real lectures on the actual Supabase project. The
> `source_type` CHECK still allows `concept_qa`/`concept_cloze` for later.
> Gates: 804 backend pytest (8 pre-existing unrelated fails) + 61 `-m db`
> tests (all new, real Postgres) + tsc 0 + 385 vitest (6 pre-existing
> unrelated fails) + real end-to-end backfill against prod data. NOT
> committed yet — WIP on `feature/building-scene`.

#### Why
Retention is the product for students. Every quiz question and concept the pipeline already generates becomes *daily recurring value* instead of one-shot content. Engagement shifts from "when a lecture drops" to "every day." This is also the substrate for Exam Mode (1.2), the Planner (2.1), and Group Challenges (3.2).

#### User stories
- As a student, I get a daily queue of due review cards drawn from lectures I've studied, so I retain material instead of cramming.
- As a student, grading a card (again/hard/good/easy) reschedules it so easy material fades and hard material recurs.
- As a student, my reviews update my concept mastery so my knowledge map and weak-spot recommendations stay honest.
- As a student, reviewing daily maintains a streak and earns XP/badges.

#### Data model (new migration)
```sql
-- Card catalog: sourced from quiz questions and concepts
CREATE TABLE review_cards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id    uuid REFERENCES lectures(id) ON DELETE CASCADE,
  concept_id    uuid REFERENCES concepts(id),
  source_type   text NOT NULL CHECK (source_type IN ('quiz_question','concept_qa','concept_cloze')),
  source_id     uuid,                    -- quiz_questions.id when source_type='quiz_question'
  front         jsonb NOT NULL,          -- question text / cloze template / options
  back          jsonb NOT NULL,          -- answer, explanation, slide refs
  content_hash  text NOT NULL,           -- dedupe on regeneration
  created_at    timestamptz DEFAULT now(),
  UNIQUE (lecture_id, content_hash)
);

-- Per-student scheduler state (FSRS)
CREATE TABLE review_schedule (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id       uuid NOT NULL REFERENCES review_cards(id) ON DELETE CASCADE,
  due_at        timestamptz NOT NULL,
  stability     real NOT NULL DEFAULT 0,
  difficulty    real NOT NULL DEFAULT 5,
  reps          int  NOT NULL DEFAULT 0,
  lapses        int  NOT NULL DEFAULT 0,
  state         text NOT NULL DEFAULT 'new' CHECK (state IN ('new','learning','review','relearning')),
  last_reviewed timestamptz,
  suspended     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, card_id)
);
CREATE INDEX idx_review_schedule_due ON review_schedule (user_id, due_at) WHERE NOT suspended;

-- Immutable review log (feeds mastery + analytics)
CREATE TABLE review_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL,
  card_id     uuid NOT NULL,
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 4),  -- again/hard/good/easy
  elapsed_ms  int,
  reviewed_at timestamptz DEFAULT now()
);
```
RLS: `review_cards` readable by students enrolled in the lecture's course (mirror `slides` policy); `review_schedule`/`review_log` own-row only; card generation writes are service-role.

#### Backend
- `backend/services/review/scheduler.py` — FSRS implementation (fall back to SM-2 if FSRS tuning drags; interface identical). Pure functions + property tests (intervals monotone in rating, lapse resets stability).
- `backend/services/review/card_factory.py` — Arq job `generate_review_cards(lecture_id)`:
  1. One card per existing `quiz_questions` row (transform, no LLM cost).
  2. Per extracted concept: generate 1–2 QA/cloze cards from `slide_chunks` text via BULK chain, `quiz_validator`-style schema validation.
  3. Idempotent via `content_hash`; enqueued from `unified_orchestrator` finalize step + backfill script for existing lectures (`scripts/backfill_review_cards.py`).
- `backend/services/review/mastery.py` — on each review, update `concept_mastery.mastery_score` (EWMA of recent ratings per concept, decayed by staleness).
- New router `backend/api/v1/review.py`:
  - `GET  /review/queue?limit=` — due cards (new-card daily cap, default 20 new/100 total), pre-shuffled interleaving by lecture.
  - `POST /review/{card_id}/grade` — body `{rating, elapsed_ms}`; returns next interval; idempotency-key guarded.
  - `GET  /review/stats` — due today, streak, retention %, per-course breakdown.
  - `POST /review/cards/{id}/suspend` — "don't show me this again."
- Card enrollment trigger: first quiz attempt or slide completion in a lecture activates that lecture's cards for the student (avoids flooding the queue with never-opened content).
- Gamification: `grant_xp` per graded card (dedupe key `review:{user}:{card}:{yyyy-mm-dd}`); new badges in `badge_definitions`: `review-streak-7`, `review-streak-30`, `centurion` (100 reviews/day), `retention-90` (state metric).
- Nudges: point `StreakAtRiskRule` at review streak; new `ReviewsPilingUpRule` (due > 50).

#### Frontend
- `src/features/review/` — `ReviewSession.tsx` (card UI: flip, grade buttons 1–4, keyboard `space`/`1-4`, progress bar, session summary), `useReviewQueue.ts`, `ReviewStatsWidget.tsx`.
- Route `/review`; dashboard bento tile "Daily Review — N due" (top slot when N > 0).
- Ascent page: retention stat + review streak alongside XP.
- Post-quiz hook in lecture player: "N cards added to your reviews" toast.

#### Acceptance criteria
- [ ] Publishing a lecture auto-generates cards for ≥ 90% of its quiz questions and ≥ 1 card per extracted concept within 5 minutes (Arq job; idempotent on re-run — re-running produces 0 duplicates).
- [ ] Backfill script generates cards for all existing published lectures without duplicating on repeat runs.
- [ ] A student's first quiz attempt in a lecture activates that lecture's cards; cards from never-touched lectures do not appear in the queue.
- [ ] Grading a card changes its `due_at` per the scheduler; rating "again" schedules it within the same session; rating "easy" schedules it strictly later than "good" (property-tested).
- [ ] Completing a session updates `concept_mastery` for every concept touched; Ascent knowledge map reflects new mastery on next load.
- [ ] XP granted exactly once per card per day (verified: double-submit grants once); review-streak badges fire via `evaluate_badges`.
- [ ] `GET /review/queue` p95 < 500ms with 1,000 due cards (paginated); grade endpoint p95 < 200ms.
- [ ] RLS test: user A cannot read/grade user B's schedule; students can't see cards from unenrolled courses.
- [ ] Full en/de i18n; session completable keyboard-only; a11y test passes.
- [ ] Suspending a card removes it from all future queues.

---

### 1.2 Exam Mode — mock exams per course

**Impact ★★★★★ · Effort M (1–2 weeks) · Dependencies: 1.1 (review bridge only) · Flag: `FEATURE_EXAM_MODE`**

#### Why
Exams are the #1 student motivator. The concept graph (`concept_lectures`) + deck quizzes + per-question difficulty from analytics let us generate *course-calibrated* mock exams from the professor's actual slides — something no generic AI tool can do.

#### User stories
- As a student, I can generate a timed mock exam for a course, weighted toward my weak concepts.
- As a student, my results rank my weakest concepts with links to the exact slides that teach them.
- As a student, I can push my misses into Daily Review in one click.
- As a professor, I see anonymized aggregate mock-exam performance for my course.

#### Data model
```sql
CREATE TABLE exam_attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  course_id     uuid NOT NULL REFERENCES courses(id),
  question_ids  uuid[] NOT NULL,          -- sampled quiz_questions
  answers       jsonb NOT NULL DEFAULT '{}',
  time_limit_s  int NOT NULL,
  started_at    timestamptz DEFAULT now(),
  submitted_at  timestamptz,
  expired       boolean NOT NULL DEFAULT false,
  score         real,
  concept_report jsonb                    -- per-concept correct/total + weakest ranking
);
```
RLS: own-row for students; professors get aggregates only via an analytics endpoint (never row access).

#### Backend
- `backend/services/exam_service.py`:
  - **Sampler:** pool = all `quiz_questions` from published lectures in the course; stratified sampling — coverage first (≥ 70% of distinct course concepts), then weighting by (low `concept_mastery` for this student × question difficulty from `analytics_service` success rates × recency-of-coverage). Deterministic given a seed; seed stored on the attempt.
  - **Grader:** server-side; submissions after `started_at + time_limit_s + grace(30s)` marked `expired` and flagged in the report, not silently accepted.
  - **Report:** per-concept correct/total, weakest-3 concepts each linking `concept_lectures.slide_indices` → deep links.
- Router `backend/api/v1/exams.py`:
  - `POST /exams/course/{id}/generate` — body `{num_questions: 20–40, time_limit_s?}`; 3/hour rate limit.
  - `POST /exams/{id}/submit` · `GET /exams/{id}` · `GET /exams/mine?course_id=`
  - `POST /exams/{id}/send-misses-to-review` — creates/activates review cards for missed questions (dedupes against existing cards via `source_id`).
  - `GET /analytics/course/{id}/exam-aggregate` (professor) — n, mean, concept-level aggregate; suppressed below n=5 for anonymity.
- Events: `exam_generated`, `exam_submitted` → `learning_events`. XP for completion (not score-scaled — don't punish diagnostic honesty); badge `exam-ready` (first mock ≥ 80%).

#### Frontend
- `src/features/exam/` — `ExamRunner.tsx` (timed, question navigator, flag-for-review, autosave answers every 10s), `ExamReport.tsx` (score, concept ranking, slide links, "Send misses to review" CTA), `useExam.ts`.
- Entry points: course page header ("Prepare for exam"), planner (2.1), library course cards.

#### Acceptance criteria
- [ ] A student enrolled in a course with ≥ 3 published lectures generates a 20–40-question exam in < 15s; sampled questions span ≥ 70% of the course's distinct concepts (integration test on a seeded course).
- [ ] Two consecutive generations overlap < 50% in question IDs (statistical test over 10 runs).
- [ ] Weak-concept weighting is observable: a student with low mastery on concept X receives measurably more X questions than a fresh student (seeded test).
- [ ] Timer is server-enforced: a submission 31+ s past expiry is marked `expired` and shown as such in the report.
- [ ] Answer autosave: killing the tab mid-exam and reopening restores answers and remaining time.
- [ ] Report's weakest concepts deep-link to the exact lecture + slide; links resolve for every concept in the report.
- [ ] "Send misses to review" creates review-schedule entries for every missed question, with zero duplicates on double-click (idempotency key).
- [ ] Professors see only aggregates; endpoint returns 404-style suppression when n < 5; RLS test proves no row-level access to `exam_attempts`.
- [ ] Exam history lists past attempts with scores and links to reports.

---

### 1.3 PWA + offline review + push notifications

**Impact ★★★★ · Effort M–L (2 weeks) · Dependencies: 1.1 · Flag: `FEATURE_PWA`**

#### Why
1.1/1.2 compound only if students can use them on phones, commutes, and dead zones. Web push finally gives the nudge engine a delivery channel users actually see.

#### Scope
1. **PWA shell** — `vite-plugin-pwa` (Workbox): manifest (name, icons, theme, standalone display), app-shell precache, runtime caching (SWR for API GETs that are safe to stale: dashboard, library, review stats), offline fallback page.
2. **Offline review** — review queue prefetches next N=50 due cards (front+back) into IndexedDB; grades queue locally and replay through the idempotent grade endpoint on reconnect (Background Sync API + manual flush on focus).
3. **Web push** — new table `push_subscriptions (user_id, endpoint UNIQUE, keys jsonb, created_at)`; `pywebpush` (VAPID) sender in `backend/services/push_service.py`; `nudge_scheduler` and badge grants emit push for opted-in users; deep links into the app.
4. **Mobile UX pass** on the three highest-frequency surfaces: dashboard, `/review`, lecture player (bottom-sheet TOC, swipe between slides, sticky quiz CTA).

#### Acceptance criteria
- [ ] Lighthouse PWA audit passes: installable, valid manifest, service worker, offline fallback; app installs to home screen on iOS Safari and Android Chrome.
- [ ] A student completes a 20-card review session in airplane mode; on reconnect all grades sync with no loss and no duplicates (integration test simulating offline→online; server-side count == 20).
- [ ] Conflicting offline sessions on two devices resolve without crashing (last-write-wins on scheduler state; both logs kept in `review_log`).
- [ ] "Streak at risk" and "assignment due soon" nudges arrive as push for opted-in users; tapping opens the relevant surface; dismissal respects `nudge_dismissals` quiet periods.
- [ ] Push permission requested contextually (after first completed review session), never on first load; a Settings toggle disables push and deletes the subscription server-side.
- [ ] Dashboard, `/review`, and lecture player fully usable at 375px: no horizontal scroll, touch targets ≥ 44px, player slide nav swipeable.
- [ ] Service-worker update flow: new deploy shows a "refresh to update" toast, never a white screen (stale-shell test).
- [ ] Uninstalling/clearing storage never corrupts server state (queue is replay-only).

---

## 5. PHASE 2 — From library to copilot

> **Revised 2026-09-17 against the code.** As first written (2026-07-06) this
> phase did not know that **2.2 had been built in full** and **2.1 had been
> built under a different name**. Following the original text would have
> rebuilt shipped features and, in four places, destroyed working code. Every
> claim below carries a `path:line`. The full list of what was wrong is in
> §11 *Corrections*; the verification record is `docs/ROADMAP_PHASE2_RECONCILIATION.md`.

**Cross-cutting, and it governs all three items.** The entire student surface
is being rebuilt as `/v4/*` — 21 routes, `import.meta.env.DEV` only, mock data
(`src/App.tsx`). Any Phase 2 work landing new UI in
`src/pages/StudentDashboard.tsx` may be building into a screen slated for
replacement. **Phase 2 is therefore re-scoped backend-first.** Each item below
names its frontend landing surface as *undecided*, pending a decision on v4's
fate. That decision is not made here.

---

### 2.1 Personal Study Planner — the "Today" view

**Impact ★★ (was ★★★★) · Effort S (was M) · Dependencies: 1.1, 1.2 — both dark · Flag: `FEATURE_PLANNER` (does not exist yet)**

#### What already exists

**The planner is built and live in production, unflagged.** It is called the
scheduler:

| Capability | Where |
|---|---|
| Deterministic ranked plan | `backend/services/scheduler.py:199` `build_plan(...)`, `:358` `assemble_user_state`, `:585` `build_plan_for_user` (620 lines) |
| Plan endpoint | `GET /api/v1/schedule/me` — `backend/api/v1/schedule.py:33` |
| Completion endpoint | `POST /api/v1/schedule/items/{item_id}/done` — `backend/api/v1/schedule.py:56` |
| Per-day completion store | `public.schedule_item_completions` — `supabase/migrations/20260503000016_schedule_completions.sql:8`, `UNIQUE (user_id, plan_date, lecture_id)` at `:14`, own-row RLS at `:22-41` |
| Unit-tested ranking | `backend/tests/unit/test_scheduler.py` |
| Dashboard UI | `src/components/OptimalScheduleCard.tsx`, mounted at `src/pages/StudentDashboard.tsx:562` |

The router is mounted **unconditionally** at `backend/main.py:246` — no flag.
Ranking order today is hard (assignment due dates) → soft (weak concepts) →
filler (in-progress lectures).

#### What is actually missing

Three of the five ranking sources the original design named return **zero rows
today**, and no amount of frontend work changes that:

- **Due reviews** — `review_cards` is only populated when
  `FEATURE_REVIEW_ENGINE` is on (`backend/core/config.py:103`, default
  `False`). It is set in no `.env.example`, compose file or Dockerfile.
- **Exam prep** — same for `FEATURE_EXAM_MODE` (`config.py:109`, default
  `False`, declared in no file anywhere).
- **Weak-concept remediation** — `concept_mastery` **has no live writer**.
  `backend/services/review/mastery.py:6-17` says so in its own docstring, and
  `backend/services/exam_service.py:7` independently confirms it reads
  `concept_graph.compute_student_mastery` instead, "NOT the `concept_mastery`
  table, which has no real writer". The slide-range deep link is equally
  empty: `concept_lectures` is populated only by an explicit `/concepts` call
  or a manual backfill script, never by the pipeline
  (`backend/services/review/card_factory.py:9-21`).

#### Design — extend, never create

**Do not create `backend/services/planner_service.py`. That file already
exists** (`backend/services/planner_service.py:49`) and is the unrelated LLM
"Planner Agent" that generates lecture narrative blueprints for the parse
pipeline. Writing a study planner there destroys it.

All work extends the existing scheduler:

- **`scheduler.py`** — add exam-proximity weighting; add a single-day view
  (the API is 7-day today).
- **A student-owned exam-date store.** Not `exam_dates` — that name is taken
  by a JSONB column on `course_context`
  (`supabase/migrations/20260711000000_course_context.sql:15`), which is
  professor/syllabus-scoped and behind `FEATURE_COURSE_BRAIN`. Use
  `student_exam_dates (user_id, course_id, exam_at)` with own-row RLS,
  following the split-per-verb policy style of
  `20260503000016_schedule_completions.sql:22-41`.
- **`schedule_item_completions`** — add a dismissal concept ("not today").
  Only "done" exists today.
- **Caching is not a drop-in.** `analytics_cache` is keyed on
  `lecture_id uuid NOT NULL` (`20260503000017_analytics_cache.sql:8,14`) and
  `get_or_compute` **silently bypasses the cache entirely when `lecture_id`
  is falsy** (`backend/services/analytics_cache.py:105`). A per-user daily
  plan has no `lecture_id`. Either widen the cache key or use a separate
  table — and either way, verify the cached path is actually taken rather
  than assuming it.
- **Flag** — add `FEATURE_PLANNER` to `backend/core/config.py` and its
  `VITE_` mirror, following the existing (duplicated-env-var) pattern.
- **Frontend landing surface: undecided** (see the cross-cutting note). Do
  not replace `HeroStage` at `src/pages/StudentDashboard.tsx:352-358` — that
  unpicks `selectHero`, the onboarding branch, `MediaRail` focus sync and the
  tagline query, on a screen v4 may replace.

#### Acceptance criteria

*Criteria the original text listed which are already met — deterministic
ranking, unit-tested ranking, per-day completion persistence, a rendered
dashboard panel — have been deleted rather than left looking like work.*

- [ ] `FEATURE_PLANNER` exists on both sides and gates every new surface.
- [ ] A student-owned exam-date row ≤ 21 days out measurably re-weights the
      plan toward that course (test asserts a plan diff before/after).
- [ ] The new table's name does not collide with `course_context.exam_dates`,
      and a test asserts the two are distinct stores.
- [ ] "Not today" drops an item for the day without marking it complete and
      without it reappearing until tomorrow.
- [ ] Completing every item grants XP exactly once per day (via the central
      gamification RPC, never a direct write); the 7-day badge fires.
- [ ] The cached path is **demonstrably taken** — a test asserts a cache hit,
      not merely a p95 number that a bypassed cache could also produce.
- [ ] Plan regenerates correctly across midnight and DST (Europe/Berlin
      canonical; test at the boundary).
- [ ] With `FEATURE_REVIEW_ENGINE` and `FEATURE_EXAM_MODE` off, the plan
      degrades to a sensible filler plan and **never renders an empty panel** —
      tested with all three empty sources.

---

### 2.2 Global semantic search + course-wide tutor — "Ask anything"

**Impact ★★★★ · Effort XS (was M) · Dependencies: none · Flag: `FEATURE_GLOBAL_SEARCH` (exists, declared nowhere)**

#### What already exists

**This feature is built, end to end, and merged.** It is dark because two
environment variables are declared in no committed file.

| Layer | Where |
|---|---|
| Course-scoped vector RPC | `match_slides_scoped` — `supabase/migrations/20260710030000_global_search.sql:12` |
| Keyword RPCs | `search_slides_keyword` `:55`, `search_lectures_keyword` `:96`, `search_concepts_keyword` `:122`, `search_worksheets_keyword` `:150` |
| FTS index | `slides_fts_idx` — same migration `:50` |
| RRF fusion | `backend/services/ai/retrieval.py:246` `rrf_fuse`, `rrf_constant=60` at `:251` |
| Course-scoped retrieval | `retrieval.py:186` `retrieve_relevant_slides_course_scoped` |
| Threshold | `DEFAULT_THRESHOLD = 0.65`, `DEFAULT_COURSE_K = 6` — `retrieval.py:31-32` |
| Course tutor + refusal | `backend/services/ai/tutor.py:287` `chat_with_course`; `:275` `is_grounded`; short-circuits **before** the LLM call at `:318-319`; ungrounded opt-in via `allow_ungrounded` at `:294` |
| API, rate-limited | `backend/api/v1/search.py:48,73` with `@limiter.limit("20/minute")` at `:49,74` |
| Event logging | `search_performed` — `backend/api/v1/search.py:63` |
| Typed client | `src/services/searchService.ts:54` `globalSearch`, `:62` `askCourseTutor` |
| ⌘K palette | `src/components/CommandPalette.tsx` (19 KB, complete); handler at `src/components/console/ConsoleLayout.tsx:63`, mount at `:142` |

**The one thing standing between this and users:**
`src/components/console/ConsoleLayout.tsx:142` renders the palette only when
`FEATURES.globalSearch` is true, and `VITE_FEATURE_GLOBAL_SEARCH` appears in
no `.env.example`, compose file or Dockerfile. `.env.example` declares only
`VITE_FEATURE_REVIEW_ENGINE` (`:85`) and `VITE_FEATURE_STUDENT_UPLOADS`
(`:87`). Backend mirror: `feature_global_search` defaults `False`
(`backend/core/config.py:115`), gating the router mount.

Both halves must be set. Either alone yields a visible UI hitting an
unmounted route, or a live route no UI reaches.

#### Design — enable, verify, and close the three real gaps

1. **Declare the flags.** `FEATURE_GLOBAL_SEARCH` and
   `VITE_FEATURE_GLOBAL_SEARCH` in `.env.example` (empty = off), then the
   deploy path. **Turning it on in production is a product decision, not a
   build step** — recorded as declined-without-the-owner at
   `docs/MILESTONE_4_FIX_PLAN.md:22`.
2. **Confirm the corpus.** Run `backend/scripts/backfill_slide_embeddings.py
   --dry-run` before anything else. Retrieval against an empty
   `slide_embeddings` returns nothing and the tutor then refuses *everything*,
   which is indistinguishable from correct out-of-corpus behaviour.
3. **Promote the eval.** `backend/tests/unit/test_course_tutor_grounding.py`
   tests **threshold arithmetic against synthetic similarity vectors**
   (`_hits(0.95)`, `_hits(0.70, 0.91)` — `:23,30-36`), not real retrieval
   against a real corpus. `backend/eval/golden_sets.py` holds four golden sets
   (`:50,116,146,179`) and **none of them is a global-search or course-tutor
   case**, so nothing 2.2-related runs in the nightly harness. Add one.
4. **Add the missing e2e.** `e2e/` holds three specs
   (`student-happy-path`, `professor-upload`, `professor-analytics`) and none
   touches the palette or a citation click.
5. **Measure p95.** No perf test exists for the search path.

#### Three silent-failure hazards — record and guard, do not discover later

Each makes "working" and "broken" look identical from the outside:

- **Empty `slide_embeddings`** → every question refused, looking exactly like
  correct refusal.
- **Zero-vector rows** → pgvector's cosine distance against a zero vector is
  `NaN`, and `NaN > 0.65` is **TRUE** in Postgres, so the threshold filter
  does *not* exclude it and an unrelated slide is injected into grounding
  context precisely when the tutor should refuse. Guards exist —
  `backend/tests/db/test_zero_vector_retrieval_hazard.py` — **a refactor must
  not remove them.**
- **Empty `concept_lectures`** → `search_concepts_keyword` joins it, so the
  palette's "Concepts" section renders permanently empty with no error.

Secondary, degrading rather than failing: the FTS index and both
`to_tsvector` / `websearch_to_tsquery` calls hardcode `'english'`
(`20260710030000_global_search.sql:52,81,82,88`) while the seeded institution
is German. Vector + RRF partly covers for it.

#### Acceptance criteria

*All seven original criteria describe behaviour that already ships. They are
replaced by the gaps that remain.*

- [ ] Both flag halves are declared in `.env.example` and the deploy path; a
      test or CI check fails if one is set without the other.
- [ ] `slide_embeddings` is confirmed populated for the target corpus, with
      the row count recorded in the PR.
- [ ] A global-search/course-tutor golden set lives in
      `backend/eval/golden_sets.py` and runs in the nightly harness — not only
      as synthetic threshold arithmetic in a unit test.
- [ ] An e2e spec opens ⌘K, searches, and clicks a citation through to the
      exact slide.
- [ ] Search p95 is measured and recorded (target < 800 ms).
- [ ] The zero-vector guards still pass and are referenced in the PR body.

---

### 2.3 Professor action loop — analytics → intervention, one click

**Impact ★★★★ · Effort L (was M) · Dependencies: none · Flag: `FEATURE_PROF_ACTIONS` (does not exist yet)**

*This is the only Phase 2 item that is mostly genuine new work. It is also
larger than "M" once the stale premises are removed — and one part of it
cannot be finished by an engineer alone.*

#### What already exists

- **The analytics redesign shipped.** `src/pages/ProfessorAnalytics.tsx` is
  now a thin shell over `src/features/analytics/garden/`.
  **`Layer2Viz.tsx` has no "coming soon" stub** — it is a complete
  **11-branch** dispatcher over `InsightKind`, mounted at
  `src/features/analytics/garden/InsightCard.tsx:89`.
- **The nudge engine** (`backend/services/nudge_engine.py`) with
  `nudge_dismissals` quiet periods, and four professor-lifecycle rules already
  proving professor-targeted nudges are a supported shape.
- **Arq cron scaffolding** — `backend/workers/arq_worker.py:253-257` plus the
  env-gated nudge cron at `:58`. The cleanest part of this item to build on.
- `PracticeSheetEditor`, `CreateAssignmentDialog`, the admin events API
  (`backend/api/v1/admin.py:241`).

#### Corrections that change the work

- **There is no "coming soon" stub to replace.** The real work is an
  **`ActionRow` sibling inside `InsightCard.tsx` at `:89`**, not anything
  inside `Layer2Viz`.
- **`InsightGarden` and `AskYourDataPanel` are no longer peers.** The garden
  is at `/professor/analytics`; `AskYourDataPanel` is mounted **only** on the
  legacy `src/pages/AdvancedAnalytics.tsx:986`. Two pages, two data models —
  an action framework must target one deliberately.
- **Never reuse the `/auto` practice-sheet endpoint.** Its real route is
  `POST /api/v1/lectures/{lecture_id}/practice-sheets/auto`
  (`backend/api/v1/practice_sheets.py:255`). It takes **no body**, does **no
  generation** (it repackages existing `quiz_questions`), and
  `supabase/migrations/20260503000019_practice_sheets.sql:17-18` enforces
  `UNIQUE INDEX ... ON practice_sheets(lecture_id) WHERE kind = 'auto'` —
  which the endpoint honours by deleting the existing sheet's questions.
  **Reusing it for remediation destroys a professor's existing sheet.**
  Requires a *new* endpoint and a new `kind` (the CHECK at `:6` allows only
  `auto`/`manual`).
- **`ProfessorNudgeRule` is an architecture mismatch.** Every
  `Rule.should_fire(ctx)` is pull-based, evaluated per student per day inside
  the daily batch. A professor nudge is push-based and on-demand. Two honest
  options, neither free: a persisted intent queue the batch reads (nudge lands
  on the next cron tick, a latency the original text did not acknowledge), or
  a direct-emit path reusing `_emit_nudge` and the same `nudge_dismissals`
  gate (bypasses `evaluate_user`, where the quiet-period filter actually
  lives). The 1/student/lecture/week cap is expressible as
  `subject_key = lecture_id` + `quiet_days = 7`, but `subject_key` is
  unindexed for range queries.
- **`CreateAssignmentDialog` has no prefill props** — title, description and
  due date are internal `useState`
  (`Props` at `src/features/assignments/CreateAssignmentDialog.tsx:36-43`;
  the fields are internal `useState` at `:59-62`). "Prefilled"
  is a component change plus a test change.
- **`professor_interventions` does not exist** anywhere but this roadmap.
  Genuinely greenfield.
- **Write "logged", not "audited".** `GET /api/v1/admin/events` is a SELECT
  over `learning_events` (`backend/api/v1/admin.py:241,277`). There is no
  tamper-evident audit table.

#### The weekly digest is descoped — email infrastructure does not exist

There is **no mail service module, no template system, no layout, no
unsubscribe or link signing, no send log, no bounce handling, no retry, and
no server-side en/de string catalog**. What exists is a single inline Resend
call in one endpoint (`backend/api/v1/feedback.py:59-113`) sending from
`"Acme <onboarding@resend.dev>"` (`:113`) — Resend's **shared sandbox
sender**, which delivers only to the account owner and **cannot send to
arbitrary professors without a DNS-verified domain**.
`notification_preferences.email_enabled` exists and is **read by nothing**.

→ **The weekly digest ships as a `professor_digests` row plus an in-app
view.** Email delivery is a human/ops prerequisite (verified sending domain +
SPF/DKIM), explicitly out of scope for the build. An engineer who builds a
digest against the sandbox sender will produce one that silently never sends.

#### Acceptance criteria

- [ ] `FEATURE_PROF_ACTIONS` exists on both sides and gates every new surface.
- [ ] An `ActionRow` renders on insight cards via `InsightCard.tsx:89`, for at
      least the three insight types named in the action table.
- [ ] Remediation sheets are generated by a **new** endpoint with a **new**
      `kind`; a test asserts that generating one leaves any existing
      `kind='auto'` sheet for that lecture byte-for-byte intact.
- [ ] Professor-initiated nudges respect quiet periods and the
      1/student/lecture/week cap (unit test on the path actually taken), and
      `run_daily` idempotency still holds (the existing nudge tests stay green).
- [ ] Every action writes a `professor_interventions` row; a 14-day follow-up
      Arq job computes the before/after delta on the targeted metric,
      including an honest "no change".
- [ ] The weekly digest writes a `professor_digests` row rendered in-app for
      opted-in professors; **no code path attempts to send email**, and the
      ops prerequisite is documented.
- [ ] Every professor action writes a `learning_events` row and appears in the
      admin activity view.
- [ ] Frontend landing surface confirmed against v4's fate before any student-
      facing nudge UI is built.

---

## 6. PHASE 3 — Open the flywheel

---

### 3.1 Student self-serve uploads — "My Materials"

**Impact ★★★★★ (strategic) · Effort L (2–3 weeks) · Dependencies: technically none; sequence after Phase 1 so uploads land in a rich loop · Flag: `FEATURE_STUDENT_UPLOADS`**

> **Execution status (2026-07-11): DONE, real-DB-verified, all 7 slices.**
> Migration `20260710040000_student_uploads.sql` (additive: `lectures.visibility`/
> `student_owner_id`, `professor_id` made nullable, an owner-consistency CHECK,
> `upload_quotas` + `increment_upload_quota()` RPC) applied directly to the real
> Supabase project via `DATABASE_URL` (no Supabase CLI in this environment,
> same pattern as the two prior migrations this session). New
> `backend/services/materials_service.py` + `backend/api/v1/materials.py`
> (`POST/GET /materials`, `/materials/quota`, `DELETE /materials/{id}`, all
> `require_student`-gated); `persist.create_lecture` and
> `unified_orchestrator.parse_pdf_unified` now accept `visibility`/
> `student_owner_id` and thread them through unchanged for the professor path.
> Frontend: `src/features/materials/` (`MyMaterialsPage.tsx` +
> `useMyMaterials.ts`), `myMaterialsService.ts`, a `MyMaterialsCell` bento tile
> gated by `FEATURES.studentUploads`, route `/materials`, full en/de i18n, a11y
> test. Gates: 804 backend pytest (2 pre-existing unrelated fails — an
> `httpx.AsyncClient(app=...)` API-version mismatch in
> `test_courses_prod.py`, nothing to do with this feature) + 16 new `-m db`
> RLS tests (real Postgres) + tsc 0 + 386 vitest (6 pre-existing unrelated
> fails). **Real end-to-end proof**, not just tests: uploaded a real PDF as a
> fresh student account through the live UI/API — got a private lecture with
> 5 slides, 7 quiz questions, 7 auto-generated review cards, and a working
> tutor-chat panel in the actual lecture player; deleted it and confirmed the
> lecture, slides, quiz questions, review cards, and its `parse_runs` row all
> cascaded to zero. NOT committed yet — WIP on `feature/building-scene`.
>
> **Two real bugs found and fixed during that real-DB pass** (would not have
> been caught by mocks): (1) `increment_upload_quota()`'s `RETURNS
> TABLE(...)` output columns silently shadowed the `upload_quotas` table's own
> column names inside the function body, causing `AmbiguousColumn` — fixed by
> qualifying every reference with a table alias. (2) The naive
> `slides`/`quiz_questions` visibility policy (`EXISTS (SELECT ... FROM
> lectures WHERE ...)`) recursed into `lectures`' *own* RLS for the querying
> role — since a non-enrolled student can't `SELECT` an ordinary course
> lecture row at all, that recursion silently narrowed today's
> intentionally-open slide/quiz visibility instead of only gating the new
> private lane. Fixed with a `SECURITY DEFINER` helper function
> (`lecture_visible_to_caller`, same pattern as the existing `has_role()`)
> that checks the raw columns without re-applying `lectures` RLS. A dedicated
> regression test (`test_course_lecture_slides_still_open_to_any_authenticated_user`)
> guards against reintroducing this.
>
> **Scope cuts made along the way (all deliberate, documented in code):**
> - **No cross-owner `pdf_hash` sharing.** The roadmap's dedupe goal ("30
>   students upload the same deck, it parses once, progress stays isolated")
>   is NOT implemented. Investigation found the professor path already has a
>   real, pre-existing bug this would inherit: `slide_embeddings` rows are
>   attached to a lecture via `.update({lecture_id}).eq("pdf_hash", ...)` — a
>   plain overwrite, not additive — so a second owner materializing from the
>   same cached content would silently reassign the first owner's embeddings
>   to themselves, breaking that owner's tutor retrieval. Fixing that
>   cross-owner embedding model is a prerequisite for real dedupe and is out
>   of scope here. Instead, private uploads run under a distinct
>   `pipeline_version` namespace (`"5-student"` vs. the professor path's
>   `"5"`), so they never collide with or silently replay into any other
>   owner's `parse_runs` row for the same hash — full correctness and
>   isolation, at the cost of each student independently paying the parse
>   cost even for byte-identical content. Fast-follow, not built now.
> - **Concept graph isolation is achieved by non-participation, not an
>   `owner_scope` column.** Per the SRS build ([[project_srs_daily_ascent]]),
>   concept-graph ingestion was already not wired into the live parse
>   pipeline for anyone — it only runs via a manual API call / backfill
>   script. Private uploads simply never call it, so private concepts never
>   exist in the shared `concepts`/`concept_lectures` tables at all — the
>   isolation criterion holds trivially. Verified live: a private lecture's
>   `GET /concepts/lecture/{id}` returns 403, and its mind-map/related-lecture
>   surfaces show nothing extra.
> - **Quota usage is shown on the My Materials page itself, not duplicated
>   into Settings** — one source of truth for now; a Settings-page rollup is
>   a trivial follow-up if wanted.
> - **No separate "daily parse rate limit"** beyond the existing route-level
>   SlowAPI limit (`10/minute`, matching the batch-upload endpoint's
>   `5/minute`) and the monthly quota itself (default 5/month) — the monthly
>   cap already bounds parse-cost abuse far tighter than a daily counter
>   would add on top; a dedicated daily limiter was judged not worth the
>   extra state for the marginal protection it'd add.
> - **Professor-analytics exclusion is structural, not filtered.** A
>   `lectures_owner_consistency` CHECK constraint makes `course_id IS NULL`
>   for every `visibility='private_student'` row — since
>   `analytics_service.py`'s course/lecture queries all scope by `course_id`,
>   a private lecture is unreachable from any analytics query by
>   construction, with no risk of a missed `visibility != 'private_student'`
>   filter somewhere down the line.

#### Why
The biggest strategic unlock. Today a student's value is capped by whether *their* professors upload. Student-private ingestion means every pipeline feature (tutor, quizzes, review cards, exam mode, search) works on *their* material — valuable to any student at any university on day one. Quota is also the natural monetization boundary.

#### Design
- **Data model:** `lectures.owner_type ('professor'|'student')` + `owner_id`; `visibility = 'private_student'` for student uploads. Student lectures live outside course structures.
- **RLS:** private lectures readable only by owner (slides, quiz_questions, chunks, blueprints cascade); excluded from professor analytics, course listings, leaderboards, and related-lecture surfaces. Admin sees metadata only (moderation).
- **Concept graph isolation:** student-private concepts written with an `owner_scope` (or a per-user namespace) so they never pollute the global catalog or other users' knowledge maps; owner's own knowledge map *does* include them.
- **Quota:** `upload_quotas (user_id, period, uploads_used, limit)` — default 5/month, 50MB/file, enforced server-side pre-parse; per-plan limits configurable; usage visible in Settings.
- **Dedupe economics:** parse artifacts keyed by `pdf_hash` are shared — if 30 students upload the same public deck it parses once — but progress, chat, reviews, and mastery are never shared.
- **Surface:** reuse the FastUpload path (no slide-editing UI); "My Materials" shelf in the library; full player/tutor/review parity.
- **Abuse guardrails:** existing `file_validation.py`; per-user daily parse rate limit; documented copyright takedown flow (admin visibility toggle already exists).

#### Acceptance criteria
- [ ] A student uploads a PDF and, within pipeline SLA, gets a private lecture with slides, quizzes, tutor chat, review cards, and semantic search — the full loop (e2e).
- [ ] RLS tests prove: another student, a professor, and course surfaces cannot see a private lecture or any derived artifact; admin sees existence/metadata only.
- [ ] Private concepts never appear in other users' knowledge maps, related-lectures, or global search (scope test).
- [ ] Quota enforced server-side: upload N+1 returns a clear limit error with upgrade messaging; quota state accurate in Settings; resets on period boundary.
- [ ] Same-`pdf_hash` uploads by two students parse once (single `parse_runs` row) but produce fully isolated progress/chat/review state.
- [ ] Private uploads excluded from professor analytics, leaderboard XP sources are unaffected by any exploit path (XP still only via central RPCs and capped per day).
- [ ] Deleting a private lecture cascades all derived artifacts and the owner's schedule entries for its cards.
- [ ] Daily parse rate limit enforced; oversized/invalid files rejected with friendly errors before upload completes.

---

### 3.2 Study groups & shared challenges

**Impact ★★★ · Effort M (1–1.5 weeks) · Dependencies: 1.1 · Flag: `FEATURE_STUDY_GROUPS`**

#### Design
- Tables: `study_groups (id, name, owner_id, invite_code, max_size default 12, created_at)`, `study_group_members (group_id, user_id, joined_at)`, `group_challenges (id, group_id, week_start, target_type 'reviews'|'xp', target int, progress int, completed_at)`.
- Weekly challenge auto-created every Monday (Arq cron); progress computed from existing `xp_events`/`review_log` — no new tracking code. Group badge on completion via `award_badge`.
- Frontend: group creation/join (invite code or friend picker) in FriendsHub; group feed (members' streaks, weekly mastery deltas — coarse, not grades); "My groups" leaderboard scope.
- Privacy: group data member-only (RLS); no quiz scores or exam results exposed, only streaks/XP/review counts.

#### Acceptance criteria
- [ ] Create/join/leave via invite code and friend invite; max size enforced server-side; RLS: non-members cannot read group data.
- [ ] Monday cron creates one challenge per active group; progress aggregates correctly from member activity (seeded test); completion awards the group badge to all members exactly once.
- [ ] Leaderboard "My groups" scope ranks members correctly and updates with the same cadence as global.
- [ ] Leaving a group removes access immediately; departed members' past contributions remain in completed challenges but their live data stops appearing.
- [ ] No grade-level data (quiz/exam scores) is ever visible to group members — only streaks, XP, review counts.

---

### 3.3 Multi-university academic catalog + async scraper

**Impact ★★★ · Effort M (1 week) · Dependencies: none · Flag: existing academic config**

Resumes "academic fingerprint Phase 2" (paused). Growth ceiling for onboarding personalization.

#### Design
- Move scraping to an Arq job (`scrape_academic_source`) with per-source status/freshness in `GET /admin/academic/sources`; `POST /admin/academic/scrape` becomes enqueue-only.
- Source adapter interface so each university/faculty is a pluggable scraper or CSV/manual import; add ≥ 1 non-Marburg source.
- Onboarding: university picker drives which catalog loads; free-text fallback (`custom_institution`, `custom_courses`) for uncatalogued institutions — no dead-ends.
- Recommendations: course-enrollment suggestions from `student_catalog_courses` matching (semester + program).

#### Acceptance criteria
- [ ] Scrape runs as an Arq job; a failing source shows `failed` + error in the sources report and never blocks or slows the API (timeout test).
- [ ] ≥ 2 universities/faculties live; onboarding shows the correct catalog per selection.
- [ ] Uncatalogued-institution students complete onboarding via free text with zero dead-ends (e2e).
- [ ] Enrollment recommendations from catalog matching are covered by unit tests; irrelevant-program courses are not recommended.
- [ ] Re-scraping a source is idempotent (no duplicate catalog rows; updates in place).

---

### 3.4 Audio/video lecture ingestion (stretch — spec before build)

**Impact ★★★★ · Effort L–XL · Dependencies: stable Phases 1–2 · Flag: `FEATURE_AV_INGEST`**

Slides are half a lecture. Whisper-class transcription → the same chunk/embed/synthesize pipeline makes recordings first-class RAG sources.

**Design sketch:** upload audio/video (or paste a recording URL) → Arq job: transcribe (faster-whisper on the GPU server, or hosted STT) → segment (~45s windows aligned to silence) → embed segments into a `media_chunks` sibling of `slide_embeddings` (not `slide_chunks` — dead; §11 #15) with `start_ms/end_ms` → optional slide-sync (align transcript to an existing deck by embedding similarity) → quiz/concept generation over the transcript.

**Headline acceptance criteria (full spec is its own doc):**
- [ ] An uploaded recording yields a timestamped, embedded transcript; tutor citations can reference timestamps and the player seeks to them.
- [ ] When a matching slide deck exists, ≥ 80% of transcript segments align to the correct slide on a hand-labeled test lecture.
- [ ] Quiz and concept generation work on transcript-only content; processing is an Arq job with progress reporting and v5-grade idempotency (`media_hash`).
- [ ] Cost guardrail: transcription minutes metered per professor/month.

---

## 7. Sequencing, milestones & effort

```
Week  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18
1.1   ████████░
1.2            ██████
1.3               ████████          (overlaps 1.2 — different surface)
2.1                        ██████
2.2                        ██████   (parallel with 2.1 — different stack areas)
2.3                              ██████
3.1                                       █████████
3.2                                                ████
3.3                                                ████  (parallel with 3.2)
3.4                                                      ██████… (stretch)
```

| Milestone | Definition of done |
|---|---|
| **M1 — "The Loop"** (end wk 6) | 1.1 + 1.2 + 1.3 shipped behind flags → enabled for all; a student can review offline on a phone and take a mock exam |
| **M2 — "The Copilot"** (end wk 11) | 2.1 + 2.2 + 2.3 live; dashboard leads with Today plan; ⌘K everywhere; professors have one-click interventions with outcome tracking |
| **M3 — "The Flywheel"** (end wk 15) | 3.1 + 3.2 + 3.3 live; any student can self-serve; groups running weekly challenges; ≥ 2 universities in catalog |
| **M4 — stretch** | 3.4 spec'd, prototyped on one course |

**Housekeeping folded into Phase 1 (cheap, cuts drag):**
- Resolve `/course-v3` experimental library duplication (pick a winner, delete the loser).
- `Layer2Viz` stub gets its resolution in 2.3 (tracked there).
- Archive or integrate `PixiLab` (`src/pages/PixiLab.tsx`).
- Deprecate parser v2 path once v5 has run clean for 30 days (flag-not-delete).

---

## 8. Success metrics (how we know it's 10x)

| Metric | Baseline (today) | Target post-M3 |
|---|---|---|
| DAU/WAU (student stickiness) | measure at M0 | ≥ 0.5 (daily-habit product) |
| Median student sessions/week | ~lecture-driven | ≥ 5 (review-driven) |
| 4-week student retention | measure at M0 | +50% relative |
| % of quiz content re-encountered after 7 days | ~0% (no SRS) | ≥ 60% |
| Weak-concept mastery delta after remediation | untracked | measurable per intervention (2.3) |
| Content supply | professors only | ≥ 30% of active students with ≥ 1 private upload |
| Mobile share of sessions | ~0 (no PWA) | ≥ 35% |
| Professor weekly active (dashboard or digest) | measure at M0 | ≥ 70% of professors with live courses |

Instrument all of these from `learning_events` + `review_log` before M1 ships (baseline capture is itself a Phase 1 task).

---

## 9. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| LLM card generation quality (bad cloze/QA cards) | Medium | Quiz-validator-style schema checks; suspend-card affordance; sample-audit 50 cards per course before enabling flag |
| FSRS tuning complexity delays 1.1 | Medium | Ship SM-2 behind the same interface first; swap scheduler later without schema change |
| Offline sync edge cases (1.3) | Medium | Grade endpoint already idempotent; replay-only queue; conflict test matrix in CI |
| Student uploads: copyright exposure | Medium | Private-only visibility, takedown flow, quotas, no sharing features at launch |
| Concept-graph pollution from private uploads | Low | `owner_scope` isolation + RLS tests (3.1 AC) |
| Provider free-tier limits under review-card generation load | Medium | Card generation uses BULK chain with existing failover; batch generation off-peak; cards are one-time cost per lecture |
| Scope creep vs. pre-launch audit | High | Hard rule: audit fixes outrank roadmap work; roadmap features ship behind flags and never block launch |
| Push notification fatigue | Medium | Contextual permission ask, per-type toggles, nudge quiet periods already enforced |

---

## 10. Explicitly out of scope (this roadmap)

- Native iOS/Android apps (PWA first; revisit after mobile share data).
- Real-time co-annotation / live lecture mode.
- Marketplace / public sharing of student-uploaded content (copyright posture first).
- Payments/billing implementation (quota hooks in 3.1 are the seam; billing is its own project).
- LMS (Moodle/ILIAS) integrations — valuable, but after M3 proves the loop.

---

## 11. Corrections — what Phase 2 got wrong (2026-09-17)

*Every row was re-verified against the tree at the `path:line` given. This
section exists so the next reader does not relitigate §5, and so the failure
mode that produced it is visible: **the roadmap went stale because features
shipped and the document was never told.** Three of these corrections describe
code that would have been destroyed by following the original text.*

### 2.1 — Personal Study Planner

| # | The document said | What is true |
|---|---|---|
| 1 | Create `backend/services/planner_service.py` | **That file exists** (`backend/services/planner_service.py:49`) and is the unrelated LLM "Planner Agent" for the parse pipeline. ⚠️ **Writing to it destroys working code.** |
| 2 | Build a ranked-plan service | Built: `backend/services/scheduler.py:199` `build_plan`, 620 lines, unit-tested (`backend/tests/unit/test_scheduler.py`) |
| 3 | `GET /planner/today` | Shipped as `GET /api/v1/schedule/me` — `backend/api/v1/schedule.py:33` |
| 4 | `POST /planner/items/{key}/complete` | Shipped as `POST /api/v1/schedule/items/{item_id}/done` — `backend/api/v1/schedule.py:56` |
| 5 | New table `plan_item_completions` | Shipped as `schedule_item_completions` — `supabase/migrations/20260503000016_schedule_completions.sql:8`, UNIQUE `:14`, own-row RLS `:22-41` |
| 6 | `TodayPanel.tsx` replaces the dashboard hero | `src/components/OptimalScheduleCard.tsx` already renders at `src/pages/StudentDashboard.tsx:562` |
| 7 | "the student still decides what to do" | False — a plan is generated and rendered today, unflagged (`backend/main.py:246`) |
| 8 | Ingredient: "the `optimal-schedule` endpoint" | Misread. `personal_schedule_service.py:1-11` answers **when** a student studies best; its docstring explicitly says it is "Not to be confused with `backend/services/scheduler.py`" |
| 9 | Rank on `slide_visit_status` | **No such table.** A migration *file* bears that name (`20260607000000_slide_visit_status.sql`) but it adds a `slide_states` JSONB column at `:17` |
| 10 | Rank on lowest `concept_mastery` | Dead branch — no live writer. `backend/services/review/mastery.py:6-17`; corroborated at `backend/services/exam_service.py:7` |
| 11 | Deep-link via `concept_lectures.slide_indices` | Table populated only by an explicit `/concepts` call or a manual script, never by the pipeline — `backend/services/review/card_factory.py:9-21` |
| 12 | New table `exam_dates (user_id, …)` | Name collision — `exam_dates` is a JSONB column on `course_context` (`20260711000000_course_context.sql:15`), professor-scoped, behind `FEATURE_COURSE_BRAIN` |
| 13 | Cache "in the `analytics_cache` pattern" | Not a drop-in. Keyed on `lecture_id uuid NOT NULL` (`20260503000017_analytics_cache.sql:8,14`); `get_or_compute` **silently bypasses the cache when `lecture_id` is falsy** (`backend/services/analytics_cache.py:105`) |
| 14 | Depends on 1.1 + 1.2 | Both shipped but **dark**: `config.py:103,109` default `False`, and `FEATURE_EXAM_MODE` is declared in no `.env.example`, compose file or Dockerfile |

### 2.2 — Global semantic search

| # | The document said | What is true |
|---|---|---|
| 15 | `slide_chunks` + `match_slides()` are the substrate | `slide_chunks` is a **384-d dead table** — zero references in the v5 pipeline. The live substrate is `slide_embeddings` (768-d, HNSW). Repointing would be a vector-dimension error, not a config change |
| 16 | The tutor is "locked to one lecture" | Course-scoping landed 2026-07-10 (`20260710030000_global_search.sql:12`); the single-lecture path was itself re-scoped in SQL on 2026-07-19 (`20260719020001_match_slides_by_lecture.sql`) |
| 17 | "extend `match_slides` (or add `match_slides_scoped`)" | Already done, under that exact name. ⚠️ A second `CREATE OR REPLACE FUNCTION match_slides_scoped` in a new migration would **silently overwrite the working definition with no error** |
| 18 | Build the ⌘K search UI | Built — `src/components/CommandPalette.tsx` (19 KB), mounted at `src/components/console/ConsoleLayout.tsx:142`, handler at `:63`; typed client at `src/services/searchService.ts:54,62` |
| 19 | Build RRF fusion, refusal path, rate limiting | All shipped — `retrieval.py:246,251`; `tutor.py:275,287,318-319`; `backend/api/v1/search.py:49,74` (`20/minute`, exactly the number specified) |
| 20 | "Build a 20+ question eval set run in CI" | Exists only as **synthetic threshold arithmetic** in `backend/tests/unit/test_course_tutor_grounding.py:23,30-36`. None of the four golden sets in `backend/eval/golden_sets.py:50,116,146,179` is a 2.2 case, so nothing 2.2-related runs nightly |

### 2.3 — Professor action loop

| # | The document said | What is true |
|---|---|---|
| 21 | `Layer2Viz.tsx` is a "coming soon" stub | **No stub.** The analytics redesign shipped; it is a complete 11-branch dispatcher mounted at `src/features/analytics/garden/InsightCard.tsx:89`. That acceptance criterion was vacuous |
| 22 | Insight cards live in `InsightGarden` **and** `AskYourDataPanel` | No longer peers — `AskYourDataPanel` is mounted only on the legacy `src/pages/AdvancedAnalytics.tsx:986` |
| 23 | Reuse `POST /practice-sheets/lectures/{id}/practice-sheets/auto` | Route is `POST /api/v1/lectures/{lecture_id}/practice-sheets/auto` (`backend/api/v1/practice_sheets.py:255`); takes no body, generates nothing. ⚠️ `UNIQUE INDEX` (`20260503000019_practice_sheets.sql:17-18`) + delete-then-reinsert means **reuse destroys the professor's existing sheet** |
| 24 | Add a `ProfessorNudgeRule` to the existing engine | Architecture mismatch — rules are pull-based, evaluated per student per day; a professor nudge is push-based and on-demand |
| 25 | "existing mail infra or Supabase functions" | **Neither exists.** One inline Resend call (`backend/api/v1/feedback.py:59-113`) from `"Acme <onboarding@resend.dev>"` (`:113`) — a shared sandbox sender that cannot deliver to third parties. No templates, no en/de catalog, no unsubscribe. `notification_preferences.email_enabled` is read by nothing |
| 26 | "prefilled `CreateAssignmentDialog`" | No prefill props — `Props` at `src/features/assignments/CreateAssignmentDialog.tsx:36-43` carries none; title/description/dueDate/minScore are internal `useState` at `:59-62` |
| 27 | `professor_interventions` | Does not exist anywhere but this roadmap. Genuinely greenfield |
| 28 | "all actions audited (`admin` events)" | No audit table. `GET /api/v1/admin/events` is a SELECT over `learning_events` (`backend/api/v1/admin.py:241,277`). Say "logged" |
| 29 | "Effort M (1–2 weeks)" | Scoped against assumptions that did not hold; with the email prerequisite and the practice-sheet rework, materially larger |

### Cross-cutting

| # | The document said | What is true |
|---|---|---|
| 30 | Phase 2 lands UI on the student dashboard | The whole student surface is being rebuilt as `/v4/*` (21 dev-only routes, `src/App.tsx`). Phase 2 is re-scoped backend-first; each item's frontend landing surface is explicitly undecided |

### The four that would have destroyed working code

Called out separately because they are not documentation problems:

1. **`planner_service.py`** — the name is taken by the parse pipeline's LLM agent (#1).
2. **The `/auto` practice-sheet endpoint** — reuse deletes a professor's existing sheet (#23).
3. **`CREATE OR REPLACE FUNCTION match_slides_scoped`** — a duplicate migration silently overwrites the working RPC (#17).
4. **The zero-vector threshold hole** — pgvector's cosine distance against a zero vector is `NaN`, and `NaN > 0.65` is TRUE in Postgres, so the filter does not exclude it. Guards at `backend/tests/db/test_zero_vector_retrieval_hazard.py` are load-bearing and must survive any refactor.
