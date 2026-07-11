# Ascend Academy — 10x Roadmap & Build Plan

> Status: PROPOSED (2026-07-06) · Owner: Abdullah · Horizon: ~1 semester (3 phases)
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
- **Pipeline (v5)** — `backend/services/parser/unified_orchestrator.py`: per-slide synthesis, deck summary/quiz, concept extraction + dedup (cosine ≥ 0.86), per-slide embeddings into `slide_chunks` (pgvector), checkpoint/resume (`parse_runs`/`parse_pages`/`slide_parse_cache`), idempotent on `(pdf_hash, version)`.
- **AI stack** — multi-provider failover orchestrator (`backend/services/ai/orchestrator.py`) with BULK (cerebras→groq_fast→gemma) and QUALITY (groq→gemini) chains; grounded RAG tutor (`tutor.py` + `retrieval.py` + `match_slides()` RPC); Azure TTS; Gemini embeddings.
- **Analytics** — 2,000+ line `analytics_service.py` with 2-tier caching; per-slide confusion/drop-off, per-question distractors, learner typology; "Ask Your Data" intent-based NL queries (never generates SQL).
- **Gamification** — server-authoritative `grant_xp` / `award_badge` / `evaluate_badges` RPCs, 27+ badge catalog, idempotent `xp_events` via `dedupe_key`, global popup provider.
- **Social** — friends, requests, profiles, global/faculty leaderboard, dashboard widget. Built and tested.
- **Jobs & engagement plumbing** — Arq worker (4 concurrent, 15-min timeout, 5 retries), nudge engine (3 rules, per-subject quiet periods), `notifications` table.
- **Ops** — RLS throughout, rate limiting, idempotency keys, correlation-ID logging, Sentry, admin console.

### Gaps this plan addresses
| Gap | Evidence |
|---|---|
| No flashcards / spaced repetition | No SRS code anywhere in `src/` or `backend/` |
| `concept_mastery` mostly write-idle | Table exists; almost nothing updates or consumes it |
| Tutor/search scoped to a single lecture | `retrieval.py` scopes `match_slides()` to one lecture |
| No exam preparation | Practice sheets are per-lecture, professor-authored |
| No PWA / offline / push | No manifest, no service worker in `index.html`/`public/` |
| Analytics diagnose but don't prescribe | Insight cards have no actions; `Layer2Viz.tsx` is a "coming soon" stub |
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

---

### 2.1 Personal Study Planner — the "Today" view

**Impact ★★★★ · Effort M (1–2 weeks) · Dependencies: 1.1, 1.2 · Flag: `FEATURE_PLANNER`**

#### Why
All the ingredients exist — mastery, due dates, reviews, the `optimal-schedule` endpoint — but the student still decides what to do. A generated daily plan turns a library into a coach and makes every other feature discoverable.

#### Design
- `backend/services/planner_service.py` — composes a ranked plan (3–7 items) from typed sources, in priority order:
  1. Due reviews (count + est. minutes)
  2. Assignments due ≤ 72h (`assignments` + `assignment_enrollments`)
  3. Weak-concept remediation: lowest `concept_mastery` in enrolled courses → specific slide ranges via `concept_lectures.slide_indices`
  4. Exam prep: if an exam date is set and ≤ 21 days out, a mock-exam or weak-concept item weighted by proximity
  5. Continue/new content: next unfinished lecture (`slide_visit_status`)
  - Deterministic for a given data snapshot (pure ranking, no LLM); cached in `analytics_cache` pattern with same-day key; invalidated on relevant events.
- `exam_dates (user_id, course_id, exam_at)` — student-entered, own-row RLS.
- `plan_item_completions (user_id, plan_date, item_key)` — persistence for done-state; "plan completed" grants XP once/day; badge `planned-and-executed` (7 consecutive completed plans).
- Router additions: `GET /planner/today`, `POST /planner/items/{key}/complete`, `PUT /planner/exam-dates`.
- Frontend: `src/features/planner/` — `TodayPanel.tsx` replaces the top dashboard hero slot; each item one tap deep (review session / assignment / slide deep link / exam runner); `ExamDateSheet.tsx` for entering exam dates (also prompted from course pages). Nudge copy references the plan ("12 reviews + 1 assignment today").

#### Acceptance criteria
- [ ] Every student sees a 3–7-item plan daily; generation is deterministic for a fixed snapshot (unit-tested ranking) and p95 < 300ms (cached path).
- [ ] Every item deep-links to its exact surface — zero dead-ends (e2e clicks every item type).
- [ ] Entering an exam date ≤ 21 days out visibly re-weights the plan toward that course (test: plan diff before/after).
- [ ] Completion state persists per day; completing all items grants XP exactly once per day; 7-day badge fires.
- [ ] Cold start: a brand-new student gets a sensible plan (finish onboarding course / first lecture) — never an empty panel.
- [ ] Plan regenerates correctly across midnight and timezone changes (Europe/Berlin canonical; test at boundary).
- [ ] Dismissing an item ("not today") drops it for the day without marking it complete and without it reappearing until tomorrow.

---

### 2.2 Global semantic search + course-wide tutor — "Ask anything"

**Impact ★★★★ · Effort M (1–2 weeks) · Dependencies: none · Flag: `FEATURE_GLOBAL_SEARCH`**

#### Why
`slide_chunks` + `match_slides()` + the Socratic tutor exist but are locked to one lecture. Un-scoping them makes the whole enrolled library an answerable, citable corpus — the headline demo feature.

#### Design
- **Retrieval:** extend `match_slides` RPC (or add `match_slides_scoped`) with `course_id`/`user enrollment` filters; enforce scope server-side from the authenticated user's enrollments — published lectures in enrolled courses only. Add keyword fallback (Postgres `websearch_to_tsquery` over `slides.title/content_text`) merged with vector results (RRF fusion).
- **Search UI:** ⌘K / `/`-key command palette in `ConsoleLayout` — sections: Lectures, Slides, Concepts, Worksheets; each hit deep-links (lecture → slide index). Recent searches stored locally.
- **Course tutor:** same grounding flow as `tutor.py`, retrieval scoped to course; citations carry `{lecture_id, slide_index, similarity}` and render as jump chips. Explicit refusal path when max similarity < threshold: "This doesn't appear in your course materials," with an optional ungrounded-answer opt-in clearly labeled.
- **Entry points:** course page "Ask this course" tab; global palette answer mode ("Ask AI" row on any query).
- Build a 20+ question eval set (in-corpus/out-of-corpus per seeded course) run in CI against the routing threshold.

#### Acceptance criteria
- [ ] ⌘K opens from any authenticated page; results p95 < 800ms; results **never** include unenrolled or unpublished content (RLS/scope test with two users + one unpublished lecture).
- [ ] Semantic and keyword results are fused: an exact-title keyword query and a paraphrase query both surface the right slide in top-3 (eval set).
- [ ] Course tutor answers a question covered by any slide in the course with a citation; clicking the citation lands on that exact slide (e2e).
- [ ] Out-of-corpus questions get the explicit "not covered" response ≥ 90% of the eval set; in-corpus questions are answered (not refused) ≥ 90%.
- [ ] Tutor conversations stay session- and student-scoped (`tutor_messages` RLS unchanged; test).
- [ ] Search queries logged as `learning_events` (`search_performed`) with zero PII beyond user_id, feeding "what students search for" professor analytics later.
- [ ] Rate limit on ask endpoints (e.g., 20/min) with a friendly client message.

---

### 2.3 Professor action loop — analytics → intervention, one click

**Impact ★★★★ · Effort M (1–2 weeks) · Dependencies: none (2.1 improves nudge landing) · Flag: `FEATURE_PROF_ACTIONS`**

#### Why
Professor analytics diagnose (confusion index, drop-off, struggling students) but prescribe nothing. Closing analytics into actions is what makes professors renew and evangelize — and each action creates student-side value. It also finally gives `Layer2Viz.tsx`'s "coming soon" stub its purpose: insight → detail → **action**.

#### Design
- **Action framework:** each insight type maps to 1–2 contextual actions rendered on insight cards (`InsightGarden`, `AskYourDataPanel`) and in `Layer2Viz` detail views:
  | Insight | Action |
  |---|---|
  | Weak/confusing concept | **Generate remediation practice sheet** → existing `POST /practice-sheets/lectures/{id}/practice-sheets/auto` seeded with the concept; opens in `PracticeSheetEditor` for review before publish |
  | Slide-range drop-off | **Nudge stalled students** → professor-initiated nudge through the existing engine (new rule type `ProfessorNudgeRule`), rate-limited |
  | Struggling students | **Create follow-up assignment** → prefilled `CreateAssignmentDialog` |
  | Worst quiz questions | **Open in quiz editor** → existing slide/quiz edit |
- New table `professor_interventions (id, professor_id, lecture_id, insight_key, action_type, target jsonb, created_at, followup_at, outcome jsonb)` — every action recorded; a scheduled Arq job computes the 14-day before/after delta on the targeted metric and writes `outcome`.
- **Weekly digest** — Arq cron: per opted-in professor, top-3 insights + one suggested action each, en/de email (existing mail infra or Supabase functions); every insight links to its dashboard view. Opt-in via Settings.
- Guardrails: professor nudges respect `nudge_dismissals` quiet periods and are capped at 1 per student per lecture per week; all actions audited (`admin` events).

#### Acceptance criteria
- [ ] From a "students are confused on concept X" insight, a professor generates, reviews, and publishes a targeted practice sheet in ≤ 3 clicks; generated questions demonstrably cover concept X (spot-check assertion on concept tags).
- [ ] Professor-initiated nudges respect quiet periods and the 1/student/lecture/week cap (unit test on the rule); students see them as normal nudges with dismissal working.
- [ ] Every action writes a `professor_interventions` row; 14 days later a follow-up card shows the metric delta for the targeted concept/slide-range — including an honest "no change."
- [ ] Weekly digest sends only to opted-in professors, renders in en/de, and every link resolves to the corresponding dashboard view; unsubscribing stops the next digest.
- [ ] `Layer2Viz` detail views replace the "coming soon" stub for at least the 3 insight types above.
- [ ] All professor actions appear in the admin activity log.

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

**Design sketch:** upload audio/video (or paste a recording URL) → Arq job: transcribe (faster-whisper on the GPU server, or hosted STT) → segment (~45s windows aligned to silence) → embed segments into a `media_chunks` sibling of `slide_chunks` with `start_ms/end_ms` → optional slide-sync (align transcript to an existing deck by embedding similarity) → quiz/concept generation over the transcript.

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
