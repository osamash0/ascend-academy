# Overnight goal · make ROADMAP_10X Phase 2 true

*A self-contained overnight brief. Abi is asleep — you cannot ask him anything.
Every open question gets his last known answer or a reported default, never a
silent invention. Written 2026-09-05 by the session that ran the feasibility
sweep this brief is built on.*

---

## 0 · The mission, in one paragraph

`docs/ROADMAP_10X.md` Phase 2 was written 2026-07-06. Since then, **2.2 was
built in full and 2.1 was built under a different name**, and the doc does not
know it. A three-agent sweep on 2026-09-05 found ten stale premises in 2.1,
three in 2.2 and eight in 2.3 — including four that would cause an agent
following the spec literally to *destroy working code*. Tonight you correct the
document so the next session builds the right thing.

**This is a documentation and verification session. You are not building
Phase 2.** The one exception is §3.

---

## 1 · First moves, in order

1. **Invoke `superpowers:using-superpowers`** and follow it. Then
   `superpowers:writing-plans` once, for the whole night. Use
   `superpowers:verification-before-completion` before each commit. Do not use
   subagents for the writing — the value here is one context holding all three
   features at once. Subagents are fine for *re-verification* (§2), which is
   parallel and well-scoped.
2. **Read `docs/ROADMAP_10X.md` §5 in full** (lines ~274–361). That is what you
   are rewriting.
3. **Read `src/features/spaces/CYCLE.md`.** It is the house method and its
   traps apply here — especially "a guard that has never been seen to fail is
   not known to work" and the `&&`-chain rule for gates.
4. Work in this worktree, on this branch. **Never commit to `main`.** Push and
   open a PR at the end (§6).

---

## 2 · The prime directive: verify before you write

The findings in §4 came from an agent sweep, not from Abi. **They are leads,
not facts.** A stale doc rewritten from a stale report is no better than what
it replaced — and this repo has a documented history of exactly that failure
(`CYCLE.md`, "How a guard goes blind").

So: **every claim you write into `ROADMAP_10X.md` must be re-verified by you,
against the file, at the line.** Cite `path:line` for each. If a §4 claim does
not hold up, **say so in the report** — that is a finding, not an
inconvenience. If it half-holds, write the half that holds.

Three claims are load-bearing enough that the whole rewrite is wrong if they
are wrong. Verify these first, before writing anything:

- **`slide_chunks` has zero live writers** and `slide_embeddings` (768-d,
  HNSW) is the real substrate. Check `backend/services/parser/unified_orchestrator.py`
  for any `slide_chunks` reference, and confirm `backend/_legacy/` is imported
  by nothing.
- **`FEATURE_GLOBAL_SEARCH` / `VITE_FEATURE_GLOBAL_SEARCH` are defined in no
  committed file.** Grep `.env.example`, every `docker-compose*.yml`, every
  `Dockerfile`, `.github/workflows/`. If either turns up somewhere, the "dark
  everywhere" claim changes shape.
- **`backend/services/scheduler.py` is mounted unflagged** at
  `backend/main.py:246` and `OptimalScheduleCard` is live on the student
  dashboard. If it is flag-gated after all, 2.1's rewrite changes.

---

## 3 · The one code change you may make

Add the two missing global-search flag definitions to **`.env.example` only**:

```
FEATURE_GLOBAL_SEARCH=
VITE_FEATURE_GLOBAL_SEARCH=
```

Empty (= off), matching how `VITE_FEATURE_REVIEW_ENGINE` and
`VITE_FEATURE_STUDENT_UPLOADS` are already declared there. This documents that
the flag exists; it turns nothing on.

**Do not touch any compose file, Dockerfile, deploy path, or prod config.
Do not flip any flag on.** Abi's decision, 2026-09-05: dev and `.env.example`
only, production untouched. A previous session refused this same flip for the
same reason (`docs/MILESTONE_4_FIX_PLAN.md:22`) — you are honoring that, not
overriding it.

Everything else tonight is Markdown.

---

## 4 · The findings to verify and encode

### 4.1 — Planner (§5 2.1): built already, under another name

| Spec says | Reality |
|---|---|
| Create `backend/services/planner_service.py` | **That file already exists** — an unrelated LLM parse-pipeline "Planner Agent" (`generate_blueprint`). Writing to it clobbers the pipeline. |
| Build a ranked-plan service | `backend/services/scheduler.py` (~620 lines) already does it — `build_plan(UserState, horizon, budget)`, deterministic, unit-tested in `backend/tests/unit/test_scheduler.py` |
| `GET /planner/today` | `GET /api/v1/schedule/me?days=7` — `backend/api/v1/schedule.py:33` |
| `POST /planner/items/{key}/complete` | `POST /api/v1/schedule/items/{item_id}/done` — `backend/api/v1/schedule.py:56` |
| New table `plan_item_completions` | Shipped as `schedule_item_completions` — `supabase/migrations/20260503000016_schedule_completions.sql:8`, UNIQUE + own-row RLS |
| `TodayPanel.tsx` replaces the dashboard hero | `src/components/OptimalScheduleCard.tsx` already mounted at `src/pages/StudentDashboard.tsx:562` |
| "the student still decides what to do" | False. A plan is generated and rendered today. |
| Ingredient: "the `optimal-schedule` endpoint" | Misread. `GET /api/v1/analytics/personal/optimal-schedule` answers **when** you study best (circadian), not **what** to study. Its own docstring says so — `backend/services/personal_schedule_service.py:8-11` |
| Rank on `slide_visit_status` | **No such table.** It is `student_progress.slide_states` (JSONB) and `lecture_visits` / `course_visits` |
| Rank on lowest `concept_mastery` | **Dead branch.** No live writer — `backend/services/review/mastery.py:6-17` says so itself, corroborated at `backend/services/exam_service.py:8`. Live mastery is computed on the fly by `concept_graph.compute_student_mastery` |
| Deep-link via `concept_lectures.slide_indices` | Column exists, but `concept_lectures` is only populated by an explicit `/concepts` call or a manual backfill script — never by the pipeline (`backend/services/review/card_factory.py:12-16`) |
| New table `exam_dates (user_id, course_id, exam_at)` | Name collision: `exam_dates` is already a **JSONB column** on `course_context` (`supabase/migrations/20260711000000_course_context.sql:15`), professor-scoped, behind `FEATURE_COURSE_BRAIN` |
| Cache "in the `analytics_cache` pattern" | Not a drop-in. `analytics_cache` is keyed on `lecture_id uuid NOT NULL` and `get_or_compute` **silently bypasses the cache when lecture_id is falsy** (`backend/services/analytics_cache.py:102-103`). A per-user daily plan has no lecture_id. |
| Depends on 1.1 + 1.2 | Both shipped but **dark**: `feature_review_engine` and `feature_exam_mode` default `False` (`backend/core/config.py:103,109`), and `FEATURE_EXAM_MODE` appears in no env file at all. With them off, `review_cards` is never populated. |

**What genuinely remains for 2.1**, once the doc is honest: a *student-owned*
exam-date store under a non-colliding name + exam-proximity weighting; a
single-day view (the API is 7-day); "dismiss for today" (only "done" exists);
XP-once-per-day + the `planned-and-executed` badge; per-user caching (needs an
`analytics_cache` schema change or a separate table); `FEATURE_PLANNER` on both
sides.

**Rewrite 2.1 as "extend `scheduler.py` / `schedule.py` /
`schedule_item_completions`" — never as "create a planner service."** That
sentence is the single most valuable line you will write tonight.

### 4.2 — Global search (§5 2.2): shipped; dark for want of two env vars

The whole vertical slice is merged. Verify and record:

- `supabase/migrations/20260710030000_global_search.sql` — its header cites
  "feature 2.2" by name. Defines `match_slides_scoped` (`:12-45`), a GIN FTS
  index `slides_fts_idx` (`:50-53`), and four keyword RPCs:
  `search_slides_keyword` (`:55`), `search_lectures_keyword` (`:96`),
  `search_concepts_keyword` (`:122`), `search_worksheets_keyword` (`:150`)
- RRF fusion — `backend/services/ai/retrieval.py:245-275`, `rrf_constant=60`
- Course tutor with refusal — `backend/services/ai/tutor.py:287-363`;
  `is_grounded()` at `:275-284`; short-circuits *before* the LLM call at
  `:318-319`; ungrounded opt-in at `:332-344`
- Thresholds — `DEFAULT_THRESHOLD = 0.65`, `retrieval.py:30-32`
- API — `backend/api/v1/search.py`, rate-limited `20/minute` at `:46` and `:72`
  (exactly the spec's number), logs `search_performed` at `:61-67`
- Frontend — `src/services/searchService.ts` (typed, not a stub) and a complete
  `src/components/CommandPalette.tsx`, mounted at
  `src/components/console/ConsoleLayout.tsx:63,142`

**Stale premises to correct:** (1) `slide_chunks` + `match_slides` are the
substrate — no, `slide_chunks` is a 384-d orphan and the live table is
`slide_embeddings` at 768-d, so even repointing would be a dimension error;
(2) "locked to one lecture" — course-scoping landed 2026-07-10, and the
single-lecture path was itself re-scoped in SQL on 2026-07-19
(`20260719020001_match_slides_by_lecture.sql`); (3) the search UI is
something to build — it is built.

**Genuine remaining gaps, and 2.2 should be rewritten down to exactly these:**
define the flags; confirm `slide_embeddings` is populated for the target corpus
(`backend/scripts/backfill_slide_embeddings.py --dry-run`); promote the 20-case
grounding eval from `backend/tests/unit/test_course_tutor_grounding.py` — which
tests *threshold arithmetic against synthetic vectors*, not real retrieval —
into `backend/eval/golden_sets.py` so it runs in the nightly harness; add e2e
for the palette and citation-click; measure p95.

**Record these three silent-failure hazards in the doc**, because each makes
"working" and "broken" look identical:
- Empty `slide_embeddings` → every question refused, indistinguishable from
  correct out-of-corpus behavior.
- Zero-vector rows → pgvector cosine distance is `NaN`, and `NaN > 0.65` is
  TRUE in Postgres, so the threshold filter does **not** exclude them and an
  unrelated slide is injected into grounding context exactly when the tutor
  should refuse. Guards exist (`backend/tests/db/test_zero_vector_retrieval_hazard.py`,
  `test_embedding_zero_vector_guard.py`) — the doc must say do not let a
  refactor remove them.
- Empty `concept_lectures` → the palette's "Concepts" section renders
  permanently empty with no error.

Also worth a line: the FTS index and both `to_tsvector` / `websearch_to_tsquery`
calls hardcode `'english'` while the seeded institution is German. Degrades,
does not fail.

### 4.3 — Professor actions (§5 2.3): the real work, minus one human-only blocker

- **`Layer2Viz`'s "coming soon" stub is gone.** The analytics redesign shipped;
  `src/features/analytics/garden/Layer2Viz.tsx:22-109` is a complete 11-branch
  dispatcher. That acceptance criterion is vacuous and must be replaced — the
  real work is an **`ActionRow` sibling in `InsightCard.tsx:87-89`**, not
  anything inside Layer2Viz.
- **`InsightGarden` and `AskYourDataPanel` are no longer peers.** The garden is
  at `/professor/analytics`; `AskYourDataPanel` is mounted only on the legacy
  `src/pages/AdvancedAnalytics.tsx:986`. Two pages, two data models.
- **The practice-sheet endpoint is wrong in the spec and wrong for the job.**
  Actual route is `POST /api/v1/lectures/{lecture_id}/practice-sheets/auto`
  (`backend/api/v1/practice_sheets.py:255`). It takes **no body**, does **no
  generation** (it repackages existing `quiz_questions` and 400s if there are
  none), and is constrained by
  `UNIQUE INDEX ON practice_sheets(lecture_id) WHERE kind='auto'`
  (`supabase/migrations/20260503000019_practice_sheets.sql:18`) — which it
  enforces by **deleting the existing sheet's questions** (`:308-316`).
  **Reusing it for remediation destroys a professor's existing sheet.** The doc
  must demand a *new* endpoint and a new `kind` (the CHECK constraint allows
  only `auto`/`manual`).
- **`ProfessorNudgeRule` is an architecture mismatch.** Every `Rule.should_fire`
  is pull-based, evaluated per student per day inside `run_daily`
  (`backend/services/nudge_engine.py:734-775`, cron at 13:00 UTC). A professor
  nudge is push-based and on-demand. Record both options — a persisted intent
  queue read by the batch, or a direct-emit path reusing `_emit_nudge` and the
  same `nudge_dismissals` gate — and note the cap is expressible via
  `subject_key = lecture_id` + `quiet_days = 7`, but that `subject_key` is
  unindexed for range queries.
- **`professor_interventions` does not exist** anywhere but the roadmap itself.
  Genuinely greenfield.
- **`CreateAssignmentDialog` has no prefill props** — title/description/dueDate
  are internal `useState` (`src/features/assignments/CreateAssignmentDialog.tsx:35-42`).
  "Prefilled" is a component change plus a test change.
- **There is no mail infrastructure.** One inline hardcoded Resend call in
  `backend/api/v1/feedback.py:58-121`, sending from `onboarding@resend.dev` —
  Resend's *shared sandbox sender*, which delivers only to the account owner and
  **cannot send to arbitrary professors without a DNS-verified domain**. No
  templates, no layout, no unsubscribe, no send log, no server-side en/de string
  catalog, no per-user locale column, no Supabase Edge Functions.
  `notification_preferences.email_enabled` exists and is **read by nothing**.
  → **The doc must descope the weekly digest** to a `professor_digests` row plus
  an in-app view, and mark email delivery as a human/ops prerequisite. Say
  plainly that "Effort M (1–2 weeks)" was scoped against assumptions that did
  not hold.
- **"Audited" is an overclaim.** `GET /api/v1/admin/events` is a SELECT over
  `learning_events` (`backend/api/v1/admin.py:239-296`). There is no
  tamper-evident audit table (`backend/services/account_service.py:53-55`).
  Write "logged", not "audited".

### 4.4 — Cross-cutting, and it belongs in the doc

The last ~10 commits rebuild the entire student surface as `/v4/*`
(`src/App.tsx:289-320`, 21 routes, `import.meta.env.DEV` only, mock data). Any
Phase 2 work that lands new UI in `src/pages/StudentDashboard.tsx` may be
building into a screen slated for replacement. **Phase 2 should be re-scoped
backend-first**, with a note that its frontend landing surface is undecided
until v4's fate is. Do not decide v4's fate — report it as the open question it
is.

---

## 5 · Deliverables

1. **`docs/ROADMAP_10X.md` §5 rewritten.** Keep the doc's existing shape
   (Why · Design · Acceptance criteria per feature) and its voice. For each of
   2.1/2.2/2.3, the Why must open with what **already exists**, and every
   acceptance criterion must be one that is not already met. Delete criteria
   that are already satisfied rather than leaving them to look like work.
   Bump the doc's status line; it says `PROPOSED` — leave that judgement alone,
   but date the revision.
2. **A "Corrections" appendix in the same file** — every stale premise, what it
   said, what is true, and the `path:line` that proves it. This is the part
   that stops the next session relitigating.
3. **`.env.example`** — the two lines from §3. Nothing else.
4. **A report at `docs/ROADMAP_PHASE2_RECONCILIATION.md`**: what you verified
   and how, which §4 claims **failed** re-verification (expect some), what you
   could not verify from the repo alone (anything needing a live DB — say so
   rather than guessing), and the open questions left for Abi with your
   recommended default for each.
5. **Optionally**, if time remains: file the four "would destroy working code"
   traps as GitHub issues so they exist outside a doc nobody may read —
   the `planner_service.py` collision, the `/auto` practice-sheet clobber, the
   `CREATE OR REPLACE FUNCTION` migration-overwrite hazard on
   `match_slides_scoped`, and the zero-vector `NaN` threshold hole.

---

## 6 · Rules that override everything

- **No feature code.** Markdown plus the two `.env.example` lines. If you find
  yourself editing a `.py` or `.tsx` file, you have left the brief — stop and
  write it in the report instead.
- **No flag flips, no compose/Dockerfile/deploy edits, no `main` commits.**
- **Never `supabase db push`** — the prod ledger holds 2 rows against 115
  migration files; it would replay 113 migrations against a live database.
- **Never `git add -A`.** Other Claude sessions work in this tree by choice.
  Stage explicit paths; run `git status` first. This has already swept another
  session's work into the wrong commit once.
- **Gates, bare and in one `&&` chain** before the commit — no pipes between a
  gate and `&&`, ever (`CYCLE.md` documents three ways that has silently
  disabled a gate here):
  ```
  npx tsc -p tsconfig.app.json --noEmit \
    && npx eslint src --quiet \
    && npx vitest run \
    && git commit ...
  ```
  A docs-only night should not move any of these; if one goes red, something
  you did was not docs-only. `tsconfig.json` checks nothing — use
  `tsconfig.app.json`.
- **Report, don't resolve.** Anything the evidence does not settle goes in the
  report with options and a recommended default. Do not invent a fact to close
  a gap.
- **Cite or cut.** A claim in the rewritten doc without a `path:line` behind it
  is how this doc got stale the first time.

### Repo state you are inheriting (2026-09-05)

Three open PRs, all v4 work, none of them yours to touch:
[#63](https://github.com/osamash0/ascend-academy/pull/63) fixes the SCA job and
is CLEAN; [#61](https://github.com/osamash0/ascend-academy/pull/61) and
[#62](https://github.com/osamash0/ascend-academy/pull/62) are UNSTABLE **only**
because of that same SCA job. If CI goes red on your PR for
"Dependency vulnerability scan (SCA)", that is pre-existing and not yours.

---

## 7 · The goal condition

The night is done when:

1. `ROADMAP_10X.md` §5 describes the codebase as it is on 2026-09-05, with a
   `path:line` behind every factual claim.
2. The Corrections appendix exists and covers all three features.
3. `docs/ROADMAP_PHASE2_RECONCILIATION.md` exists, including the honest list of
   §4 claims that did **not** survive re-verification and everything that could
   not be checked without a live database.
4. `.env.example` has the two flag lines and nothing else changed in it.
5. Working tree clean, committed on this branch, pushed, PR opened against
   `main` with a body that states plainly: this is a documentation correction,
   no behaviour changed, and the production global-search flag flip is still
   Abi's call.

Do not mark the goal met until the reconciliation report exists. A rewrite with
no record of what was wrong is just a different set of claims to trust.
