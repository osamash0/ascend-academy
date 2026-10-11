# Session Prompt: Course & Lecture Lifecycle Rebuild

> Paste this whole file as the opening prompt of a fresh Claude Code session
> (or run phases in separate sessions — each phase section is self-contained
> enough to resume from). It encodes the findings of the 2026-08-28 deep audit
> of the course/lecture feature. Do not re-derive the diagnosis; verify the
> cited lines still match before changing them, then build.

---

## Mission

Rebuild the course/lecture lifecycle (create, edit, upload, replace, delete,
archive, publish, review, enroll, visibility) as ONE coherently designed
feature instead of the current accretion of per-entry-point implementations.
Work happens in phases; each phase ends with verification and a PR. Do not
start a later phase before the earlier one is merged or explicitly parked.

## Root cause (established by audit — do not re-litigate)

The app is mid-migration from "professors supply content" to "everyone is a
creator of their own content" (see `docs/MILESTONE_2026_08.md` §"ownership,
not role" and migration `20260713000000_creator_uploads.sql:1-6`). The data
layer made the jump; the feature logic on top never did. Concretely:

1. **Split write authority.** Courses mutate only via FastAPI; lectures mutate
   three ways — FastAPI, the parse worker, and the BROWSER writing directly to
   Postgres via ownership-scoped RLS write policies. All transactional /
   cascade / validation logic that needs a server therefore never got built.
2. **Two contradictory visibility definitions.** API: assignment-scoped +
   `status='published'` (`backend/api/v1/courses.py:148-219,516,539-559`).
   RLS: whole-course via `course_enrollments`, ignoring assignments, course
   status, and course archive state (`20260604000000:56-66`). Dashboard rail
   uses RLS (`src/services/studentService.ts:19-28`), course page uses API —
   same student, different lecture sets.
3. **No lecture publish state.** Content is live the instant parsing finishes
   (`backend/api/v1/upload.py:105,556`). BatchReviewPage "Done reviewing" is a
   localStorage no-op with a lying toast (`src/pages/BatchReviewPage.tsx:118-122`).
4. **Enrollment gates reads, never writes.** `student_progress` /
   `learning_events` RLS check only `user_id`; SRS `grade_card` lazily creates
   schedule rows for any card (`backend/api/v1/review.py:181-194`).
5. **Every operation exists in divergent copies.** 4 upload paths, 2 course-edit
   dialogs, 3 "remove lecture from course" behaviors, 2 delete implementations.

## Locked product decisions

These five decisions drive everything. Defaults below were chosen from the
audit; **confirm them with the user in the first message of the session, then
treat them as frozen.**

| # | Question | Locked default |
|---|----------|----------------|
| D1 | Visibility formula | Course enrollment grants the WHOLE course's live lectures. Assignments become an optional overlay (highlight/sequence), not a visibility gate. API and RLS must encode the identical predicate, including `courses.status='published'` and both archive flags. |
| D2 | Lecture publish state | Add `lectures.status: processing \| failed \| draft \| live \| archived`. Parse finishes → `draft`. Review page performs a REAL publish (`draft→live`). Single-upload editor Save publishes. Migration backfills existing parsed lectures to `live`. |
| D3 | Enrollment-gated writes | Yes — progress, learning events, and SRS grading require the caller to be able to SEE the lecture (D1 predicate). Enforce server-side; tighten RLS where the write is direct. |
| D4 | Roles | Finish the ownership migration. `professor`/`student` become UI-audience labels only. Backend authorization = ownership + D1 visibility. Delete dead `require_professor` vestiges except admin. Route guards may stay for UX but must not be treated as security. |
| D5 | Quota | Meter per-FILE at the two pipeline entrances (`/api/v1/upload/batch`, `/api/upload/parse-pdf-stream`) for student-role callers; remove the `/materials`-only metering. One RPC, counts files not calls. |

## Phase plan

### Phase 0 — Design doc + decision freeze (small, no code)
Write `docs/design/COURSE_LIFECYCLE.md`: the D1 visibility predicate in one
paragraph of English + one SQL boolean expression; the D2 state machines for
course and lecture (states, transitions, who may trigger each); the endpoint
inventory of Phase 1. Get user sign-off. This doc is the spec every later PR
links to.

### Phase 1 — Canonical backend lecture service (the root fix)
Build `backend/services/lecture_lifecycle.py` (or extend existing service
layout — match repo conventions) + REST endpoints. Missing endpoints
identified by audit:

1. `POST /api/v1/lectures` — create (metadata shell; pipeline attaches).
2. `PATCH /api/v1/lectures/{id}` — full metadata update (today's
   `PATCH /api/courses/lecture/{id}` accepts title ONLY, `courses.py:611`).
3. `POST /api/v1/lectures/{id}/archive` + `/unarchive` — creator-facing
   (today only admin has it, `admin.py:426-438`).
4. `DELETE /api/v1/lectures/{id}` — **transactional cascade delete**. Must
   clean, in one logical operation: slides, quiz_questions, student_progress,
   review_cards(+schedule/log), slide_chunks, tutor_messages,
   `slide_embeddings` **by pdf_hash AND by lecture_id** (NULL-lecture_id rows
   are the known leak — `cache.py:478-554`), `pdf_parse_cache` /
   `slide_parse_cache` when no other lecture shares the hash, storage objects
   in `lecture-pdfs` AND `lecture-posters`, and (decide in Phase 0) either
   delete or tombstone `learning_events` rows referencing the lecture.
5. `POST /api/v1/lectures/{id}/replace-pdf` — re-hash, re-parse, clear derived
   data first (fixes the stale-embeddings poisoning: `saveExistingLecture`
   updates `pdf_url` but never `pdf_hash` and never re-parses,
   `src/services/lectureService.ts:608-634`).
6. Slide CRUD + quiz CRUD endpoints for the manual editor (today only
   AI-driven writes exist server-side).
7. `POST /api/v1/lectures/{id}/publish` (+ unpublish) per D2.

Also fix in this phase (server-side bugs the new endpoints subsume):
- Ownership stamping: student uploading into a course currently gets
  `professor_id=user.id, student_owner_id=null`
  (`src/hooks/useLectureSubmit.ts:203-206`). The create path must set the
  correct owner column from the caller's identity, never from course presence.
- `delete_material` leaks both storage buckets and caches
  (`backend/services/materials_service.py:220-230`) — re-point it at the
  canonical delete.
- Batch endpoint silently ignores the `parser` field
  (`upload.py:654` hardcodes `"unified"`) — either honor it or remove the
  frontend selector for batch (`src/pages/LectureUpload.tsx:1069-1085`).

TDD per repo norm; DB tests for the cascade (assert zero orphans per table
and per bucket after delete/replace).

### Phase 2 — Re-point frontend, lock down RLS
Blast radius is known and small: **16 direct-write call sites in 2 files**
(`src/hooks/useLectureSubmit.ts:141,217,257`;
`src/services/lectureService.ts:370,396,404,450,459,464,466,630,651,675,714,716,717,735`),
triggered from 5 UI surfaces (LectureUpload, ProfessorDashboard,
ProfessorCourseDetail, ProfessorArchive, StudentUploadWizard). Re-point every
one to Phase-1 endpoints. Then a migration drops the INSERT/UPDATE/DELETE RLS
policies on `lectures`, `slides`, `quiz_questions` for `authenticated`
(KEEP all SELECT policies — reads stay direct). Grep for any missed
`supabase.from('lectures'|'slides'|'quiz_questions')` writes before merging.

### Phase 3 — One visibility formula (D1) + state machine (D2)
- Implement the D1 predicate ONCE: a SQL function (e.g. replace/extend
  `lecture_visible_to_caller`, `20260612000000:72`) used by BOTH the RLS
  SELECT policies and the API list/get queries. Kill the divergence:
  rail vs detail mismatch, draft-course lecture leak, archived-course leak,
  `course_enrollments` INSERT policy missing the published check
  (`20260604000000:21-27`), empty-shell lectures (`total_slides=0` returned by
  `get_course`, `courses.py:521`).
- Implement D2 lecture status + real publish. Make BatchReviewPage server-backed
  (publish/retitle/reassign/delete per card); delete the localStorage Set.
  Gate `published→draft` on course (warn + confirm; today ungated,
  `courses.py:711`).
- Fix the professor/student unassign asymmetry
  (`courses.py:1113` demotes visibility only for non-professors).

### Phase 4 — Enrollment-gated writes (D3) + quota (D5)
- Progress / events / SRS grade: enforce the D1 predicate server-side
  (`studentService.ts:118-138` writes move behind endpoints or get RLS
  predicates; `review.py:181-194` gets a visibility check).
- Quota per D5. Remove the bypasses: onboarding wizard and
  `/professor/upload` (open to students, `src/App.tsx:469`) currently hit
  unmetered endpoints while `/materials` meters 5/month per CALL not per file
  (`student_uploads.sql:180-183`).

### Phase 5 — Collapse the duplicates + one data layer
- One role-parameterized upload flow, one course-edit dialog (union of fields:
  color + AI description + maxLength; pick `null` for cleared description —
  today one dialog writes `null`, the other `""`), one "remove from course"
  behavior (per Phase-0 spec).
- Move course/lecture fetching to react-query with shared keys; every
  mutation invalidates. Kills the known stale-state bugs
  (`ProfessorDashboard.tsx:83-85` count staleness, cross-page staleness).
- Failure UX: retry from BatchReviewPage, retry after wizard resume
  (`StudentUploadWizard.tsx:552-561` retry vanishes on resumed batches),
  cleanup/hide dead `parse_runs` rows with `lecture_id IS NULL`.

### Phase 6 — Backfill & cleanup (one-off, supervised)
Scripts (NOT auto-run) to: purge orphaned `slide_embeddings`
(`lecture_id IS NULL` + hash not referenced), orphaned storage objects in both
buckets, dead `parse_runs`, stale caches. Run against prod ONLY in a
supervised session per the prod-deploy rules.

## Project traps (violating these has burned prior sessions)

- **NEVER run `supabase db push`** — the prod migration ledger has 2 rows vs
  115 files. Apply migrations by probing `pg_catalog` and running SQL
  explicitly via the pooler `DATABASE_URL` (port 5432, not 6543).
- `tsc -p tsconfig.json` checks NOTHING. Use `tsc -p tsconfig.app.json`.
- CI does not run on feature-branch pushes — run the suites locally.
- The user may run concurrent Claude sessions on this same working tree —
  re-verify `git status` before every commit/push.
- New UI must match the existing visual language (gradients/CTAs/header
  patterns of neighboring flows), not a plainer treatment.
- Feature flags are build-time Vite env vars (`src/config/featureFlags.ts`);
  there is no runtime flag delivery. `FEATURE_COURSE_BRAIN` stays OFF.
- Storage: do NOT "repair" cache-control on the `lecture-pdfs` bucket
  (see `docs/` egress post-mortem).

## Definition of done (whole effort)

1. Zero direct browser writes to `lectures`/`slides`/`quiz_questions`; RLS
   write policies for `authenticated` dropped; reads unchanged.
2. One SQL visibility predicate shared by RLS and API; the six audit
   contradictions (rail/detail, draft leak, archive leak, draft-enroll,
   empty shell, silent unpublish) each have a regression test.
3. Lecture state machine live; review page performs a real publish; the
   lying toast is gone.
4. Delete/replace leave zero orphans across all derived tables and both
   storage buckets (DB test proves it).
5. Student-in-course uploads carry correct ownership columns.
6. Quota meters files at the pipeline entrances; bypass routes closed.
7. One upload flow, one edit dialog, one remove behavior; react-query
   invalidation across professor pages.
8. `docs/design/COURSE_LIFECYCLE.md` matches what shipped.

## How to work

Use superpowers process skills (brainstorming already done — this doc is its
output; use writing-plans → executing-plans / subagent-driven-development per
phase; TDD; verification-before-completion). Verify cited file:lines before
editing (the codebase moves). Each phase = its own branch + PR with the audit
reference in the description. If a cited line has drifted, re-locate by
symbol name, not by guessing.
