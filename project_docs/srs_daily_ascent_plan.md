# Phase 1.1 — SRS Review Engine ("Daily Ascent") — Implementation Plan

> Status: READY TO BUILD · Grounded against current code 2026-07-08 (two codebase surveys)
> Parent: `docs/ROADMAP_10X.md` §4.1 · Flag: `FEATURE_REVIEW_ENGINE`

## Locked decisions
1. **Scheduler:** SM-2 first, behind a stable interface; FSRS swap later with no schema change.
2. **XP/badges:** client-side after a successful grade (idempotent via `dedupe_key`), mirroring `LectureView`'s `grantXp(...)`. Review-streak/`centurion` are **event** badges the client awards at threshold (state-badge sweeping via `evaluate_badges` only knows coded metrics).
3. **Mastery:** reuse `concept_mastery.attempts/correct` + recompute the existing Laplace-smoothed `mastery_score`. No schema change to `concept_mastery`, no EWMA column.

## Roadmap corrections baked in (from survey)
- Gamification is **client-driven** — RPCs run under `auth.uid()`, zero Python callers. Grade endpoint does NOT grant XP; the client does after the call returns.
- `quiz_questions` FK → `slides`, not `lectures`. Card factory joins `quiz_questions → slides → lectures`.
- `slide_chunks.text` is the card-generation source (embedding is vector(384) FastEmbed, irrelevant here).
- Migrations: `supabase/migrations/<YYYYMMDDHHMMSS>_review_engine.sql`. RLS harness: testcontainers `pgvector:pg15`, `backend/tests/db/conftest.py` factories (`make_user`/`make_lecture`/`make_slide`/`make_quiz`).

## Data model (`supabase/migrations/<ts>_review_engine.sql`)
- `review_cards(id, lecture_id→lectures CASCADE, concept_id→concepts, source_type CHECK(quiz_question|concept_qa|concept_cloze), source_id, front jsonb, back jsonb, content_hash, created_at, UNIQUE(lecture_id, content_hash))`
- `review_schedule(user_id→auth.users CASCADE, card_id→review_cards CASCADE, due_at, stability real, difficulty real, reps int, lapses int, state CHECK(new|learning|review|relearning), last_reviewed, suspended bool, PK(user_id,card_id))` + `idx (user_id,due_at) WHERE NOT suspended`
- `review_log(id bigint identity PK, user_id, card_id, rating smallint CHECK 1..4, elapsed_ms, reviewed_at)`
- **RLS:** `review_cards` readable by students enrolled in the lecture's course (mirror `slides`/practice-sheets policy) + service-role write; `review_schedule`/`review_log` own-row only.

## Build slices (all behind `FEATURE_REVIEW_ENGINE`)

### Slice 1 — Migration + RLS test
- `supabase/migrations/<ts>_review_engine.sql` (tables above).
- `backend/tests/db/test_review_engine_rls.py` mirroring `test_practice_sheets_rls.py`: user A can't read/grade B's schedule; unenrolled student sees no cards; forged insert → `InsufficientPrivilege`.

### Slice 2 — Scheduler (pure)
- `backend/services/review/scheduler.py`: `schedule(state, rating, now) -> new_state`. SM-2 math; interface stable for FSRS swap.
- `backend/tests/unit/test_review_scheduler.py`: property tests — interval monotone in rating; rating=1(again) → due within session; rating=4(easy) strictly later than rating=3(good); lapse resets.

### Slice 3 — Card factory (Arq job)
- `backend/services/review/card_factory.py`: `generate_review_cards(ctx, lecture_id)`.
  1. One card per `quiz_questions` (join through `slides`), transform-only (no LLM).
  2. Per concept (via `concept_lectures`): 1–2 QA/cloze cards from `slide_chunks.text` via BULK chain, schema-validated; idempotent on `content_hash`.
- Register in `backend/workers/arq_worker.py` `functions`. Enqueue from `unified_orchestrator.py:~339` (after `persist.finalize_lecture`) via `get_arq_pool()`.
- `scripts/backfill_review_cards.py` — all published lectures, idempotent.

### Slice 4 — Review API
- `backend/api/v1/review.py` (prefix `/review`, `Depends(require_student)`, SlowAPI):
  - `GET /review/queue?limit=` — due cards, new-card daily cap (default 20 new / 100 total), interleaved by lecture.
  - `POST /review/{card_id}/grade` `{rating, elapsed_ms}` — idempotency-key guarded; writes `review_log`, updates `review_schedule` via scheduler, returns next interval.
  - `GET /review/stats` — due today, streak, retention %, per-course.
  - `POST /review/cards/{card_id}/suspend`.
- Register in `backend/main.py` v1_router. Emit `review_graded` to `learning_events`.

### Slice 5 — Mastery bridge
- `backend/services/review/mastery.py`: on grade, for each concept on the card increment `attempts` (+`correct` when rating≥3), recompute Laplace `mastery_score`. Called from the grade path.

### Slice 6 — Frontend
- `src/services/reviewService.ts` (central, `apiClient`): `getQueue`, `grade`, `getStats`, `suspend`.
- `src/features/review/`: `ReviewSession.tsx` (flip, grade 1–4, keyboard space/1–4, progress, summary), `useReviewQueue.ts` (TanStack Query).
- Route: add `StudentRoutes.REVIEW='/review'` in `routes.ts`; `<Route>` with `ProtectedRoute allowedRoles={['student']}` + `ConsoleLayout` in `App.tsx`.
- Dashboard tile: add `ReviewWidget` kind to the `homeFeed.ts` union + push in `buildWidgets` + `ReviewCell` + `case` in `BentoGrid.tsx` ("Daily Review — N due", top slot when N>0).
- i18n: `src/i18n/locales/{en,de}/review.json`, register in `src/i18n/index.ts` (resources + `ns`).
- Post-quiz toast in lecture player: "N cards added to your reviews".

### Slice 7 — Gamification + nudges
- Client: after successful grade, `grantXp(xp,'review',`review:${user}:${card}:${yyyy-mm-dd}`)`; at streak thresholds `awardBadge('review-streak-7'|'-30')`, `centurion` (100/day).
- Badge rows: add event badges to `badge_definitions` seed (new migration or extend `20260616000000` INSERT ON CONFLICT).
- Nudges: add `ReviewsPilingUpRule` (due>50) to `DEFAULT_RULES`; extend `UserContext` + `run_daily` to fetch per-user due counts; point streak-at-risk copy at review streak.

## Build order
1 → 2 → 3 → 4 → 5 → 6 → 7. Slices 1–2 are independent and safe to land first. Each slice ships green (unit/integration + `tsc`) before the next.

## Open questions (defaults chosen, revisit if needed)
- **New-card daily cap:** default 20 new / 100 total per queue call. (Anki-like; tune after dogfood.)
- **Card activation trigger:** first quiz attempt OR first slide completion in a lecture activates that lecture's cards for the student (avoids flooding). Implemented as a lazy `review_schedule` row creation on first queue-eligibility check.
- **Retention % metric:** define as `review_log` correct(rating≥3)/total over trailing 30d.
