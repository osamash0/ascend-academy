# Phase 1.2 — Exam Mode — Implementation Plan

> Status: DONE (2026-07-10) · All 7 slices built + real-Postgres-verified (83 db tests, 572 unit tests pass) · NOT committed yet
> Parent: `docs/ROADMAP_10X.md` §1.2 (lines 174-231) · Flag: `FEATURE_EXAM_MODE`
> Depends on: Phase 1.1 Daily Ascent's `review_cards`/`review_schedule` tables + `_activate_new_cards` helper (schema only — not blocked on 1.1's frontend/gamification finishing).

## Roadmap corrections baked in (from grounding survey)

The roadmap spec was written before checking the schema. Three of its assumptions don't hold as written:

1. **No `published` column exists anywhere** (`lectures`/`courses`). The nearest equivalent is `lectures.is_archived = false`. "Enrolled in course" is resolved two ways in the live code: modern `course_enrollments` rows, or legacy `assignment_enrollments → assignment_lectures`. `backend/api/v1/courses.py:111-155` (`_student_visible_course_ids`) already unions both — Exam Mode's course-access check should reuse that logic, not invent a third pattern.

2. **`concept_mastery` table is effectively dead.** It has no real writer: `review/mastery.py`'s `record_grade` only fires when a review card has a non-null `concept_id`, and `card_factory.py` explicitly scopes concept-cards OUT of v1 (see its own docstring) because `concept_lectures` isn't populated by the parse pipeline. The mastery signal that's actually live and populated is `concept_graph.compute_student_mastery(user_id)` (`backend/services/concept_graph.py:512+`) — it computes per-concept mastery on the fly from `learning_events` (`quiz_attempt`/`quiz_retry_attempt`), resolving each attempt's `quiz_questions.metadata.concept` string against the `concepts` table. **Exam Mode must read from `compute_student_mastery`, not `concept_mastery`.**

3. **`concept_lectures.slide_indices` cannot be trusted for deep-linking.** The column exists and is schema-correct, but per `card_factory.py`'s docstring it's "only populated by an explicit `/concepts` API call or the manual `backfill_concept_graph.py` script — never automatically by the v5 parse pipeline." Relying on it would silently produce broken links for any course that hasn't had that script run. **Fix: don't route through the concept graph for links at all.** Every exam question already carries its own `quiz_questions.slide_id`. The exam report links each weak concept to the slide(s) of *that exam attempt's own missed questions* — data we already have, zero dependency on `concept_lectures`.

**Minor, non-blocking bug found in passing:** `backend/services/parser/synthesis.py:150` (`_map_deck_quiz`) sets `"concept": q.get("difficulty", "")` — the deck-level quiz mapper stores the difficulty string ("easy"/"medium"/"hard") in the `concept` metadata field instead of an actual topic. This is self-healing today (those fake "concepts" don't match any row in `concepts.aliases`, so `compute_student_mastery` silently drops them) but worth a one-line fix later. Not in scope here — flagged for a separate task.

## Locked decisions

1. **Mastery/weighting source:** `concept_graph.compute_student_mastery(user_id)`'s `weak` list (live-computed), not the `concept_mastery` table.
2. **Concept→slide links:** always resolved from the exam's own sampled/missed questions' `slide_id`, never from `concept_lectures`.
3. **"Published lectures in a course":** `lectures.is_archived = false` scoped to `course_id`. Course access check reuses/extracts the union-of-enrollments logic already in `courses.py:_student_visible_course_ids`, not the review engine's assignment-only pattern.
4. **`exam_attempts` RLS is pure own-row** (`user_id = auth.uid()`), mirroring `review_schedule`/`review_log` — not `review_cards`. No professor SELECT policy exists at all; course access and enrollment are enforced in Python at generate-time (same "RLS is defense-in-depth, Python enforces" convention as `review.py`), matching the roadmap's own acceptance criterion that professors get zero row-level access.
5. **XP/badges are client-side**, mirroring `ReviewSession.tsx`'s (currently broken) pattern — but this time the `exam-ready` row is **actually inserted** into `badge_definitions` via a real migration. (Confirmed defect to not repeat: `review-streak-7`/`-30`/`centurion` are referenced in `ReviewSession.tsx` but were never seeded, so `award_badge()` silently no-ops for them today.)
6. **Course-wide question pool + difficulty:** no existing helper aggregates `quiz_questions` success-rate across a whole course (`analytics_service._compute_quiz_analytics` is single-lecture only) — new aggregation lives in `exam_service.py`, modeled on that function's join pattern but generalized to `.in_()` over the course's non-archived lecture ids.
7. **"Send misses to review"** reuses `review/card_factory.py`'s existing `_insert_card`/dedup-on-`content_hash` machinery (so re-sending is naturally idempotent — same lecture+question always hashes the same) plus `review.py`'s `_activate_new_cards`-style lazy schedule-row creation for cards the student doesn't have a schedule row for yet.

## Data model (new migration, `supabase/migrations/<ts>_exam_mode.sql`)

```sql
CREATE TABLE exam_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id      uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  question_ids   uuid[] NOT NULL,
  answers        jsonb NOT NULL DEFAULT '{}',
  time_limit_s   int NOT NULL,
  seed           bigint NOT NULL,          -- sampler determinism, per roadmap
  started_at     timestamptz NOT NULL DEFAULT now(),
  submitted_at   timestamptz,
  expired        boolean NOT NULL DEFAULT false,
  score          real,
  concept_report jsonb                     -- built from THIS exam's own questions, no concept_lectures dependency
);
CREATE INDEX idx_exam_attempts_user ON exam_attempts(user_id);
CREATE INDEX idx_exam_attempts_course ON exam_attempts(course_id);

ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY exam_attempts_own_row ON exam_attempts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- No professor policy — professors get aggregates only, via a service-role analytics endpoint.

-- badge_definitions upsert (mirrors 20260616000000's ON CONFLICT shape). Key
-- is 'Exam Ready' (Title Case) to match the catalog's REAL convention — every
-- existing row uses a Title Case English phrase as its key, not kebab-case;
-- confirmed while writing the migration.
INSERT INTO public.badge_definitions (key, name, description, icon, category, xp_reward, metric, threshold, sort_order)
VALUES ('Exam Ready', 'Exam Ready', 'Scored 80% or higher on a mock exam.', '🎓', 'exam', 50, NULL, NULL, 100)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
  icon = EXCLUDED.icon, category = EXCLUDED.category, xp_reward = EXCLUDED.xp_reward;
```

`seed` added vs. the roadmap's original column list — required for the "deterministic given a seed" sampler requirement (roadmap line 207) and for the "two consecutive generations overlap < 50%" acceptance test to be reproducible in CI.

## Build slices (all behind `FEATURE_EXAM_MODE`)

### Slice 1 — Migration + RLS test
- `supabase/migrations/<ts>_exam_mode.sql` (table + badge insert above).
- `backend/tests/db/test_exam_mode_rls.py` mirroring `test_review_engine_rls.py`'s structure (role-impersonation helpers, forged-insert → `psycopg.errors.InsufficientPrivilege`). Needs **new fixtures** in `backend/tests/db/conftest.py`: `make_course(prof)` and `make_course_enrollment(course_id, student_id)` (don't exist yet — `conftest.py` currently only has `make_user`/`make_lecture`). Explicit test: a professor role gets zero rows back from `exam_attempts` under any query (no policy grants it).

### Slice 2 — Sampler (pure, seeded)
- `backend/services/exam_service.py::sample_questions(pool, mastery_weak, num_questions, seed) -> list[question_id]`:
  1. Pool = `quiz_questions` joined through `slides!inner(lecture_id)` filtered to the course's non-archived lecture ids (new query, no existing course-wide helper to reuse).
  2. Coverage pass first: ensure ≥70% of the pool's distinct `metadata.concept` values represented at least once.
  3. Weight remaining picks by (low mastery for that concept, from `compute_student_mastery`'s `weak` list × question `metadata.difficulty`) — students with unresolved/no mastery data get neutral weighting (cold-start).
  4. `random.Random(seed)` for determinism — seed is generated server-side (not client-supplied) and stored on the attempt row.
- `backend/tests/unit/test_exam_sampler.py`: coverage ≥70% property test; two different seeds overlap <50% (statistical, per roadmap's own acceptance criterion); weak-concept weighting is observable (seeded low-mastery student gets measurably more of that concept's questions than a fresh student).

### Slice 3 — Exam API router
- `backend/api/v1/exams.py` (prefix `/exams`, `Depends(require_student)`, mirrors `review.py` conventions exactly: raw asyncpg via `get_db_connection()`, `@limiter.limit(...)`, UUID `try/except ValueError` parsing, literal-SQL insert into `learning_events`):
  - `POST /exams/course/{id}/generate` — `{num_questions: 20-40, time_limit_s?}`, `3/hour` rate limit. Authorizes course access via the reused `_student_visible_course_ids`-equivalent check (Locked decision 3), 403s otherwise. Calls the Slice-2 sampler, inserts `exam_attempts` row, returns `{exam_id, question_ids, time_limit_s}` (never `correct_answer` — that's graded server-side only).
  - `GET /exams/{id}` — own-row fetch (404 if not found/not owned — RLS backs this but Python checks explicitly per `review.py`'s pattern).
  - `POST /exams/{id}/submit` `{answers}` — idempotency-key guarded (`check_idempotency`, matching `review.py:153`). Rejects (marks `expired=true`, still grades but flags it) if `now > started_at + time_limit_s + 30s` — server clock is authoritative, never trust a client-sent elapsed time.
  - `GET /exams/mine?course_id=` — attempt history list.
  - `POST /exams/{id}/send-misses-to-review` — idempotency-key guarded; Slice 4 wires the actual card creation.
  - Emits `exam_generated` / `exam_submitted` to `learning_events` (literal SQL insert, same style as `review.py:206-209`).

### Slice 4 — Grader + report + review bridge
- `backend/services/exam_service.py::grade(conn, exam_id, answers) -> report`:
  - Server-side correctness check against `quiz_questions.correct_answer` (never trust client-submitted correctness).
  - Groups the exam's own questions by `metadata.concept` (normalized, same `_normalize()` helper `concept_graph.py` uses — import it, don't reimplement), computes correct/total per concept, ranks weakest-3, and links each to the actual `slide_id` of that concept's missed question(s) *within this exam* (Locked decision 2 — no `concept_lectures` read).
  - `send_misses_to_review(conn, exam_id, user_id)`: for each missed question, reuse `card_factory._insert_card`-equivalent (same `content_hash` scheme so it dedupes against cards the normal pipeline already created) + reuse/extract `review.py`'s `_activate_new_cards` lazy-schedule-creation logic scoped to just the newly-touched cards, so the student sees them in their next `/review/queue` call. Idempotent: calling twice creates zero duplicate cards or schedule rows.

### Slice 5 — Professor aggregate endpoint
- `GET /api/v1/analytics/course/{id}/exam-aggregate` — service-role read (no RLS reliance, matches how other professor analytics endpoints already read across students), `n`, mean, per-concept miss aggregate; returns a suppressed/404-style response when `n < 5` (roadmap's explicit anonymity floor). `backend/tests/unit/test_exam_aggregate.py`: suppression boundary test at n=4 vs n=5.

### Slice 6 — Frontend
- `src/services/examService.ts` mirrors `reviewService.ts` exactly (header comment convention, typed interfaces, thin `apiClient.get/post` wrappers, `/api/v1/exams/...` paths).
- `src/features/exam/`: `useExam.ts` (mirrors `useReviewQueue.ts`'s TanStack Query shape — flattened return object, service-layer-only calls), `ExamRunner.tsx` (timed, question nav, flag-for-review, answers autosaved to backend every 10s — not just local state, so the "kill tab mid-exam" acceptance criterion holds without a PWA/offline layer), `ExamReport.tsx` (score, weakest-3 concepts with slide deep links, "Send misses to review" CTA calling `sendMissesToReview`).
- Routes: `StudentRoutes.EXAM = '/exam'`, `StudentRoutes.EXAM_REPORT = (id: string) => \`/exam/${id}/report\`` in `routes.ts` (matches the existing `ADVANCED_ANALYTICS` function-form convention). Lazy-import + `ProtectedRoute allowedRoles={['student']}` + `ConsoleLayout` wrap in `App.tsx`, matching the `/review` route registration verbatim.
- **Entry point (MVP): course page header.** `src/pages/StudentCourseView.tsx:81-86` already has a sibling button (`Try new view →`) in exactly the right spot — add a "Prepare for exam" button next to it, `navigate(StudentRoutes.EXAM_WITH_COURSE)` or similar, calling `POST /exams/course/{courseId}/generate` then routing to the runner. This matches the roadmap's stated entry point and needs no new dashboard-widget plumbing.
- A `BentoGrid`/`homeFeed.ts` dashboard tile (mirroring the `ReviewWidget` pattern) is a good fit for later (exam history/"exam-ready" nudge) but is **not required for MVP** — deferred to an open question below so Slice 6 stays inside the roadmap's own M-effort estimate.
- i18n: `src/i18n/locales/{en,de}/exam.json`, registered in `src/i18n/index.ts` mirroring the `review` namespace (import, `resources.{en,de}.exam`, append to `ns: [...]`).

### Slice 7 — Gamification
- Client: after a successful submit response, `grantXp(xp, 'exam', \`exam:${user}:${examId}\`)` (fixed amount, not score-scaled, per roadmap); `awardBadge('Exam Ready')` when `score >= 0.8` and it's the user's first such attempt for that course (check via `getMine` history before awarding, to avoid a wasted RPC call — `award_badge` itself is already idempotent server-side).
- The `badge_definitions` insert from Slice 1's migration is the fix that makes this actually work, unlike the current silent-no-op precedent in `ReviewSession.tsx`.

## Build order
1 → 2 → 3 → 4 → 5 → 6 → 7. Slices 1-2 are independent of each other and safe to land first (same shape as the Daily Ascent plan). Each slice ships green (unit/db tests + `tsc`) before the next.

## Open questions (defaults chosen, revisit if needed)
- **Dashboard tile entry point:** deferred per Slice 6 — build it only if course-header MVP proves the flow works. Default: skip for v1.
- **Autosave mechanism:** spec'd as a real backend write every 10s (simplest way to satisfy "kill tab mid-exam and reopen restores answers" without needing IndexedDB/service-worker infra that Phase 1.3 (PWA) will add later). Revisit if this proves too chatty (30-40 questions × autosave traffic over a 60-90 min exam is small, should be fine).
- **Course access check helper:** plan assumes `_student_visible_course_ids` in `courses.py` is extractable/importable as-is; if it's tightly coupled to that router's request context, a small refactor to lift it into a shared `backend/services/enrollment.py` may be needed first — check at Slice 3 build time, not a blocker for planning.
- **`synthesis.py:150` concept/difficulty bug:** flagged, not fixed here — separate follow-up task.
