# Session Prompt: Course & Lecture UI Rebuild

> Companion to `docs/COURSE_LIFECYCLE_REBUILD_PROMPT.md` (the backend/logic
> rebuild). Paste this file as the opening prompt of a fresh Claude Code
> session for the UI work. Read the companion prompt first — its five locked
> decisions (D1–D5) and phase plan are binding here. Do not build UI against
> endpoints that don't exist yet: each UI phase below names the backend phase
> it depends on. If the backend phase isn't merged, stop and tell the user.

---

## Mission

Consolidate the course/lecture UI from two overlapping, half-duplicated
surface sets (professor-branded + student-branded) into ONE coherent,
role-aware surface set with a single data layer, honest state (no fake
review, no lying toasts), and complete lifecycle coverage (everything that
can be created can be renamed, reordered, republished, archived, restored,
and deleted from the UI).

## Current UI inventory (from the 2026-08-28 audit — verify lines, don't re-derive)

**Course surfaces**
- `src/features/courses/components/CreateCourseDialog.tsx` — create+edit,
  color swatches, AI description. Professor-flavored but reachable by both.
- `src/features/student/components/CourseDetailsSheet.tsx:105` — student edit
  (title/description only, no color; writes `""` where the dialog writes
  `null` for cleared description).
- `src/pages/ProfessorCourses.tsx` — grid, archive, delete (blocked if
  `lecture_count>0` with no bulk-unassign escape hatch).
- `src/pages/ProfessorCourseDetail.tsx` — header, publish toggle,
  assign/unassign, CourseFactsCard, StudyGuideCard.
- `src/pages/ProfessorArchive.tsx` — restore/purge; the ONLY professor-only
  route, so students can archive content but have no screen to restore it.

**Lecture surfaces**
- `src/pages/LectureUpload.tsx` — **2,388-line mega-page**: single upload tab,
  batch tab, full edit mode, slide editor, quiz editor, worksheets, review
  cards, course reassign. The parser-engine selector at `:1069-1085` renders
  above both tabs but batch ignores it server-side.
- `src/pages/BatchReviewPage.tsx` — cosmetic review (localStorage "Done
  reviewing", lying "N lectures are live" toast at `:121`, no
  retitle/reorder/reassign/delete, failed cards have no retry `:240-244`).
- `src/pages/MyMaterialsPage.tsx` + `src/features/materials/useMyMaterials.ts`
  — student uploads; the ONLY react-query surface (the pattern to spread).
- `src/features/student/components/StudentUploadWizard.tsx` — onboarding
  blueprint wizard; the only screen with real retitle/reorder/reclassify/
  merge/split. Retry button vanishes on resumed batches (`:552-561`).
- `src/pages/ProfessorDashboard.tsx` — lecture rail, assign dropdown with
  stale `lecture_count` (`:83-85` updates lectures but never courses).

**Routing** — `src/App.tsx:469,491,501,521`: "professor" routes gated
`['professor','student']` on purpose (ownership-not-role model); only
`/professor/archive` (`:511`) is professor-only.

## UX defects to eliminate (each needs a before/after check)

1. Fake review: BatchReviewPage must become a real publish surface (needs
   backend Phase 3 lecture `status`).
2. Three different "remove lecture from course" behaviors
   (`ProfessorCourseDetail.tsx:334` unassign+archive,
   `ProfessorDashboard.tsx:70` unassign+archive,
   `CourseDetailsSheet.tsx:149` unassign-only) — pick ONE per the Phase-0
   design doc and use the same confirm copy everywhere.
3. Two course-edit surfaces with diverging fields (color, maxLength,
   null-vs-"" description) — one dialog, superset of fields, role-agnostic.
4. No lecture reorder within a course; no quick-rename for professors
   (rename exists only inside the student sheet); no lecture visibility
   editing after creation.
5. Course delete dead-end: blocked when non-empty with no bulk
   unassign/migrate flow in the UI (backend supports `?reassign_to`,
   `courses.py:961` — the UI never offers it).
6. Empty-shell lectures (`total_slides=0`, failed parse) render as normal
   cards; must show a failed/processing state with retry (backend Phase 3
   gives `status`).
7. Stale cross-page state: manual `useState`+`refresh()` everywhere except
   MyMaterials. Everything moves to react-query with shared keys.
8. Students can archive/delete via professor pages but cannot reach an
   archive screen to restore (`App.tsx:511`) — archive becomes role-agnostic
   ("My Archive") or restore moves inline.
9. Upload feedback inconsistency: editor path is a fire-and-forget toast;
   batch/materials show live per-file status. One progress pattern.
10. Dangling controls: parser selector for batch (remove or make honest once
    backend decides), `flagged_count` badge that gates nothing (wire it to
    the new review flow as a "needs attention" filter).

## Locked UX decisions (confirm with user once, then frozen)

| # | Decision | Default |
|---|----------|---------|
| U1 | Surface model | ONE role-aware surface set. "Professor" pages become creator pages; student-specific pages remain only where the audience genuinely differs (onboarding wizard, My Materials as a filtered view of the same library). No new parallel screens. |
| U2 | LectureUpload mega-page | Split into three routes: Upload (single+batch entry), Review/Publish (replaces BatchReviewPage), and Lecture Editor (slides/quiz/worksheets). Shared state via react-query + URL params, not one 2,400-line component. |
| U3 | Remove-from-course semantics | "Remove from course" = unassign only, with an explicit separate "Archive" action. Destructive delete only from the editor or archive screen, always with typed-confirm for cascade. Copy identical everywhere. |
| U4 | Data layer | react-query for ALL course/lecture reads; mutation hooks own invalidation. Query keys: `['courses']`, `['course', id]`, `['lectures', {courseId}]`, `['lecture', id]`, `['my-materials']`. No component-level `useState` caches of server data. |
| U5 | Review flow | After batch parse: Review page lists drafts (per D2 backend state) with per-card publish, retitle, reassign, retry-failed, delete, and "Publish all". Single-upload editor Save = publish. |

## Phase plan (each names its backend dependency)

### UI Phase A — Data layer + honest state (needs backend Phase 1–2 merged)
- Introduce the react-query hooks (U4) and migrate ProfessorCourses,
  ProfessorCourseDetail, ProfessorDashboard, ProfessorArchive off manual
  state. Fix the dashboard stale-count bug as the proof case.
- Re-point all mutations to the new backend endpoints (this overlaps backend
  Phase 2's re-pointing — coordinate: if backend Phase 2 already re-pointed
  the service files, this phase only wraps them in mutation hooks).
- Remove dead/lying UI now: the batch parser selector no-op, the
  "Done reviewing" localStorage flow's lying toast (interim copy: "Reviewed
  (visual only)" if backend Phase 3 isn't merged yet).

### UI Phase B — One dialog, one behavior set (needs backend Phase 1)
- Merge CreateCourseDialog + CourseDetailsSheet edit form into one
  role-agnostic CourseEditDialog (superset fields, `null` for cleared
  description, maxLength kept).
- Unify remove/archive/delete per U3 with shared confirm components and
  identical copy. Add professor quick-rename (inline, same pattern as the
  student sheet). Add the course-delete migrate flow (offer "move N lectures
  to another course" using `?reassign_to`).

### UI Phase C — Review/Publish surface (needs backend Phase 3: lecture status)
- Rebuild BatchReviewPage per U5 against real `draft/live` states. Failed
  cards get retry (works after resume — fix the vanished-retry bug pattern
  from `StudentUploadWizard.tsx:552`). Wire `flagged_count` as a filter.
- Editor Save becomes publish; unsaved-draft state visible in library lists
  (badge on draft lectures).
- Draft/processing/failed lecture cards get distinct visual states in every
  list (dashboard rail, course detail, library) — no more empty shells.

### UI Phase D — Split the mega-page + unify upload UX (needs Phases A–C)
- Split LectureUpload per U2. Keep behavior identical while splitting;
  refactor commits separate from behavior commits.
- One upload progress pattern (per-file status like batch) across single,
  batch, and materials. One dedupe UX (server duplicate → clear per-file
  message, matching batch's `'duplicate'` handling).
- Role-aware navigation cleanup per U1: creator library/archive reachable by
  both roles; kill orphan entry points.

### UI Phase E — Lifecycle completeness polish (needs backend Phases 3–4)
- Lecture reorder within a course (position field lands with backend
  Phase 3 — if it didn't, park this and tell the user).
- Lecture visibility editing (course ↔ private) where D1/D2 allow.
- Quota feedback: show remaining quota at every upload entrance (per D5,
  now metered at the pipeline), not just My Materials.
- Empty/error/loading states pass for every list and detail screen.

## Design conventions (binding)

- **Match the existing visual language.** New/merged screens reuse the
  gradients, CTA styles, and header patterns of the strongest neighboring
  flow (BatchReviewPage's treatment was previously confirmed as the bar) —
  never a plainer new treatment.
- Brand voice is "Calm Competence" — no exclamation-mark toasts, no lying
  success copy. Toasts state exactly what happened ("Lecture published to
  BWL 101", not "Done!").
- i18n: all new strings through the existing i18n setup; check both locales.
- Feature flags are build-time Vite env vars (`src/config/featureFlags.ts`).
  Gate risky UI swaps behind a flag so old/new can be diffed in dev.
- Accessibility: keyboard + aria on every new dialog/confirm; the audit
  previously fixed onboarding a11y — don't regress it.

## Verification (every phase)

- `tsc -p tsconfig.app.json` (NOT tsconfig.json — that one checks nothing)
  + the frontend test suite locally (CI does not run on feature branches).
- Drive the changed flows in the browser via the preview tools (dev server
  configs exist in `.claude/launch.json`; backend + dev both launch). Prove
  with snapshots/screenshots: the stale-count repro fixed (Phase A), one
  remove behavior everywhere (Phase B), a real publish round-trip (Phase C),
  the split pages behavior-identical (Phase D).
- Re-verify `git status` before every commit — the user may run concurrent
  sessions on this working tree.

## Definition of done

1. Zero manual `useState` caches of course/lecture server data; all reads on
   shared react-query keys; every mutation invalidates.
2. One course-edit dialog, one remove/archive/delete behavior set with
   identical copy, one upload progress pattern.
3. Review page performs real publishes; drafts/failed/processing are visually
   distinct everywhere; no lying toasts anywhere (grep the toast strings).
4. LectureUpload.tsx no longer exists as a mega-page; no route component over
   ~400 lines in the new flow.
5. Every lifecycle operation reachable in the UI for its owner regardless of
   role label: rename, reorder, reassign, publish/unpublish, archive/restore,
   delete-with-cascade-warning, retry-failed (including after resume).
6. Both locales complete; a11y checks pass on new dialogs.

## How to work

Superpowers process skills apply (writing-plans → executing-plans per phase,
TDD where logic exists, verification-before-completion). Verify cited
file:lines before editing — the backend rebuild will have moved things.
Each phase = own branch + PR referencing this doc and the companion prompt.
