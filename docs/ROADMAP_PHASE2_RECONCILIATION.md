# Phase 2 reconciliation — verification record

*Run 2026-09-17 against `main` @ `a696be1`, per
`docs/OVERNIGHT-PROMPT-ROADMAP-PHASE2.md`. Output: `docs/ROADMAP_10X.md` §5
rewritten, §11 *Corrections* added, two flag declarations added to
`.env.example`. No behaviour changed.*

---

## How this was verified

The brief's §4 handed over ~35 claims from an agent sweep run on 2026-09-05,
explicitly as **leads, not facts**. Main moved **85 commits** between that
sweep and this run, so every claim was re-checked against the tree before
being written into the roadmap. Verification was mechanical — `grep`/`sed` at
the named symbol, reading the surrounding lines — and every claim in the
rewritten §5 and §11 carries the `path:line` it was checked at.

The brief named three claims as load-bearing enough that the whole rewrite
would be wrong if they failed. All three held:

| Load-bearing claim | Result |
|---|---|
| `slide_chunks` has zero writers in the v5 pipeline | **Held** — 0 references in `backend/services/parser/unified_orchestrator.py` |
| Both global-search flag halves are declared in no committed file | **Held** — absent from `.env.example`, every `docker-compose*.yml`, every `Dockerfile` |
| `scheduler.py` is mounted unflagged and `OptimalScheduleCard` is live | **Held** — `backend/main.py:246` (unconditional), `src/pages/StudentDashboard.tsx:562` |

## Claims that did not survive as written

**No claim was outright false.** Four needed correcting in detail, and all four
corrections are reflected in the rewritten text rather than the original
wording:

1. **`slide_visit_status` — "no such table" was right, but imprecise.** A
   migration *file* is named `20260607000000_slide_visit_status.sql`; it adds
   a `slide_states` JSONB column (`:17`). An engineer grepping the filename
   would have found something and concluded the brief was wrong. §11 now says
   this explicitly.

2. **Line numbers had drifted**, as expected across 85 commits. Corrected to
   the current tree: `analytics_cache.py` bypass is at **:105** (brief said
   102-103); `InsightCard.tsx` mounts `Layer2Viz` at **:89** (87-89);
   `admin.py` list handler at **:241** (239-296); `exam_service.py` docstring
   at **:7** (:8); `feedback.py` Resend block at **:59-113** (58-121). The
   symbols themselves were all where the brief said.

3. **The brief's own §6 "Repo state you are inheriting (2026-09-05)" is
   stale** and was not followed. It tells the session to expect three open PRs
   (#61, #62, #63) and a red SCA job. All three merged on 2026-09-16, six more
   PRs landed after them, and **there are zero open PRs**. The CI red it warns
   about was separately fixed by #65 and #66.

4. **The brief prescribed `superpowers:writing-plans`.** That skill is built
   for TDD implementation plans — "code blocks required for code steps". This
   job has no code steps. The brief itself already functions as the plan
   (numbered deliverables, constraints, goal condition), so a second planning
   document would have been ceremony. Executed directly instead; recorded here
   rather than passed over silently.

## What could not be verified from the repository alone

These are **unknowns, not findings**, and the rewritten §5 states each as a
precondition rather than an assumption:

- **Whether `slide_embeddings` is actually populated** for any corpus. This is
  the difference between 2.2 working and 2.2 refusing every question while
  looking correct. §5 2.2 makes a `--dry-run` backfill check the first step
  and requires the row count in the PR body.
- **Whether `review_cards`, `assignments` or `assignment_enrollments` hold
  rows** in any environment. Affects whether the planner degrades to filler.
- **Search p95.** No perf test exists; the number in the original acceptance
  criteria was never measured.
- **Whether the production deploy path sets the feature flags outside version
  control.** Only committed files were checked. A server-side `.env` could
  differ — and per `docs/MILESTONE_2026_08.md` this repo has been bitten by a
  two-env-file trap before.

## Open questions, with a recommended default for each

| # | Question | Recommended default |
|---|---|---|
| 1 | **Turn global search on in production?** Everything is built; two env vars stand between it and users. | **Leave off.** Declaring the flags (done) is reversible; flipping them exposes an untested-in-prod surface that spends real LLM budget per "Ask AI". A previous session declined this for the same reason (`docs/MILESTONE_4_FIX_PLAN.md:22`). Owner's call. |
| 2 | **Is v4 replacing the student dashboard?** Phase 2's frontend landing surface depends on it. | **Assume yes, build backend-first.** §5 now scopes all three items that way and marks each frontend surface undecided. Cheap to reverse; expensive to guess wrong. |
| 3 | **Turn on `FEATURE_REVIEW_ENGINE` / `FEATURE_EXAM_MODE`?** Three of the planner's five ranking sources are empty without them. | **Leave off, and make the planner degrade honestly.** §5 2.1 now requires a test that the plan never renders empty with all three sources dry. |
| 4 | **Does `concept_mastery` get a writer, or get dropped?** It is read in three places and written by none. | **Neither yet — record it.** Deciding costs more than the roadmap rewrite; it is now visible in §11 #10 instead of being rediscovered a fourth time. |
| 5 | **Weekly digest without email — acceptable?** | **Yes.** Ship the `professor_digests` row + in-app view; email needs a DNS-verified sending domain, which is an ops task no engineer can complete from the repo. |

## What changed on disk

| File | Change |
|---|---|
| `docs/ROADMAP_10X.md` | §5 rewritten (89 lines → 315); §11 *Corrections* added (30 numbered corrections + the four destructive ones); status line notes the revision |
| `docs/ROADMAP_PHASE2_RECONCILIATION.md` | This file |
| `.env.example` | `FEATURE_GLOBAL_SEARCH` and `VITE_FEATURE_GLOBAL_SEARCH`, both empty (= off), each with a comment saying both halves are required |

No `.py`, `.tsx`, `.sql`, compose file, Dockerfile or deploy path was touched.
No flag was turned on. `main` was not committed to.

## Scope extended once, deliberately

The brief scoped this session to §5. A read-back of the whole document found
**§2 "Current-state assessment" still carrying the same stale claims §5 had
just corrected** — leaving the document contradicting itself, which is the
exact failure this session exists to prevent. Six lines were corrected outside
§5, each pointing at the §11 entry that proves it:

| Line | Was | Now |
|---|---|---|
| §2 pipeline | "per-slide embeddings into `slide_chunks`" | `slide_embeddings` (768-d, HNSW); `slide_chunks` named as the dead 384-d table |
| §2 AI stack | "`match_slides()` RPC" | `match_slides_scoped` / `match_slides_by_lecture` |
| §2 gaps | "`concept_mastery` mostly write-idle" | has **no** live writer — understated before |
| §2 gaps | "Tutor/search scoped to a single lecture" | **CLOSED 2026-07-10** — the single most wrong line in the document, and the one a reader consults to decide whether Phase 2 is worth doing |
| §2 gaps | "`Layer2Viz.tsx` is a 'coming soon' stub" | no longer a stub; the insight-action gap itself is still real |
| §3.4 (AV, stretch) | "a `media_chunks` sibling of `slide_chunks`" | sibling of `slide_embeddings` |

Left alone on purpose: §4 (Phase 1) contains spec text for features that have
since shipped — it reads as a historical record of what was planned, not as a
claim about today, and rewriting it was not this session's job.

## Incidental finding — a flaky guard

`npx vitest run` on the full suite failed once at
`src/features/spaces/components/__tests__/readerRail.test.tsx:322`
(`findByText('walked the path')` timing out). The same file re-run in isolation
passes **35/35**, and the **full suite re-run on the identical tree passed
1283/1283, exit 0**. Same commit, same command, two different answers — so the
test is flaky at the full-suite level, not merely slow. No source file was
modified by this session (only two Markdown files and `.env.example`), so this
is not a regression from this work.

It is a timing-sensitive `findByText` that fails under full-suite load
(that run reported 179 s of setup and 200 s of collection) and passes alone.
By `src/features/spaces/CYCLE.md`'s own standard — "a guard that has never
been seen to fail is not known to work", and its inverse — a guard that fails
for reasons unrelated to its subject is one that gets muted within a week.
Worth a look, separately from Phase 2.

## The pattern worth naming

Phase 2 went stale for one reason: **features shipped and the document was
never told.** 2.2 was built four days after the roadmap described it as
unbuilt, and nothing closed the loop.

That same loop is open right now in `docs/design-v4/`: 21 screens are built,
Doc 2 (Navigation) was never written, and "streak" ships across five surfaces
while appearing in no design doc. This session fixed one instance of the
pattern. The other is still running.
