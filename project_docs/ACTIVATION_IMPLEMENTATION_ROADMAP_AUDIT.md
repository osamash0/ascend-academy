# Activation Strategy — Implementation Roadmap & Code Audit

> Audited: 2026-07-21 · Scope: `project_docs/ACTIVATION_STRATEGY.md` and Tasks 1–3
>
> Status: **student activation is substantially implemented in the working tree;
> professor activation, metric definitions, and lifecycle delivery are not.**
>
> This document describes the current code as it exists in the uncommitted
> workspace. It is not a claim that those changes have been deployed.

## Executive decision

Finish and verify the existing student journey before adding scope. Then build
the professor zero-to-one path, and finally make telemetry/retention reporting
canonical. The existing work already changes the student funnel, database
model, course-creation flow, and learning-event data. Shipping only its UI
would leave the new path difficult to measure and the professor persona
unchanged.

## Code audit

| Strategy area | Current state | Evidence | Gap / decision |
|---|---|---|---|
| Student entry path | **Implemented, unverified** | `src/App.tsx` redirects incomplete students to `/onboarding`; `src/pages/ActivationOnboarding.tsx` presents material/example paths. | Run the migration, typecheck, and focused tests before merging. Legacy `Onboarding.tsx` still exists; make the activation route the only reachable student first-run flow, then retire old code only after production validation. |
| Lightweight intent capture | **Implemented** | `ActivationOnboarding.tsx` captures one optional study goal immediately before the material route. | The strategy's explicit name capture and randomized starter avatar are not implemented. Current greeting falls back to email local-part. Keep name optional, but choose whether to capture it on this page or after first learning activity. |
| Immediate material-to-course journey | **Implemented, unverified** | `StudentUploadWizard.tsx`, `backend/api/v1/onboarding.py`, and the course-blueprint migrations support upload, parsing progress, editable structure, splitting, and course creation. | Backend uses a service-role API boundary; add real-DB RLS/ownership tests for every blueprint mutation, not only mocked integration tests. |
| Example-course “aha” path | **Implemented, brittle** | `ActivationOnboarding.tsx` enrolls the user in a course whose title exactly matches `Database Systems`/`Datenbanksysteme`; `StudentCourseLibrary.tsx` tracks demo progression. | Resolve a seeded `is_demo_course`/stable slug rather than a translated title. The current path fails if the catalog title changes or is absent. |
| Progressive profile prompts | **Partial** | `StudentCourseLibrary.tsx` offers Luna theme and verified institution prompts after a meaningful activity. | Course-link prompt at upload/library entry and post-enrollment “Find Classmates” widget are not present. No unlock rules for avatar cosmetics are present. |
| Activation measurement | **Partial** | `onboarding_progress`, `record_onboarding_activation`, and `record_onboarding_second_session` migrations record first activity and first return; `Auth.tsx` logs account creation. | The specified canonical events and metric queries do not exist. Event names differ (`quiz_attempt`, `luna_customized`, `upload_completed`), and several required professor events are absent. |
| Student lifecycle nudges | **Not implemented to strategy** | `backend/services/nudge_engine.py` reliably creates in-app notification rows for streaks, assignments, weak concepts, and SRS backlog. | No Day 1/3/7 activation rules, no push/email transport, and no event-based eligibility for the proposed messages. |
| Professor zero-to-one flow | **Not implemented** | `Auth.tsx` sends a new professor to `/dashboard`; `App.tsx` resolves that role to `/professor/dashboard`; `ProfessorDashboard.tsx` loads the existing dashboard. | No setup state, welcome/profile flow, first-course flow, activation checklist, contextual empty state, or post-course tour. This is the largest strategy gap. |
| Professor telemetry and nudges | **Not implemented** | Existing analytics pages and the generic in-app nudge engine provide reusable surfaces. | `lecture_uploaded`, `analytics_dashboard_viewed`, activation conversion reporting, and Day 2/5/14 email rules are missing. |

## Target event contract

Keep rich UI events if useful, but introduce these as the stable analytics
contract. Emit them server-side whenever the action is authoritative; do not
make conversion metrics depend solely on fire-and-forget browser writes.

| Canonical event | Source of truth | Required properties | Current closest event |
|---|---|---|---|
| `account_created` | Auth signup completion | `role`, `method` | Present in `Auth.tsx` |
| `onboarding_completed` | Student/professor completion transaction | `role`, `path`, `onboarding_version` | Missing |
| `avatar_customized` | Profile update success | `theme` or cosmetic IDs | `luna_customized` |
| `quiz_started` | Quiz session creation | `course_id`, `lecture_id`, `topic`, `difficulty` | `quiz_attempt` |
| `quiz_completed` | Accepted quiz submission | `course_id`, `lecture_id`, `score`, `duration_seconds` | `learning_activity_completed` only for demo |
| `lecture_uploaded` | Backend upload accepted | `role`, `file_type`, `course_id`, `batch_id` | Student-only `upload_completed` |
| `analytics_dashboard_viewed` | Professor analytics route/page view | `course_id` or `lecture_id` | Missing |
| `session_started` | Authenticated app session | `role`, `session_id` | `login` is not equivalent |

## Implementation roadmap

### Phase 0 — Stabilize the current student activation change

**Goal:** make the existing activation-first flow safe to merge and observable.

1. Apply the eight activation/onboarding migrations in timestamp order to an
   ephemeral database. Confirm generated Supabase types include all columns and
   RPCs used by the frontend.
2. Run `npx tsc --noEmit`, `npm run build`, the ActivationOnboarding Vitest
   suite, and onboarding API tests. Add browser coverage for signup →
   onboarding → example and signup → upload → course creation.
3. Add owner-isolation database tests for blueprint read, update, split, and
   create-course endpoints. Verify another student cannot supply a batch or
   blueprint ID they do not own.
4. Replace the title-based example-course lookup with a stable seed flag/slug
   and an explicit “unavailable” fallback state.
5. Emit `onboarding_completed` only after the user selects a path; record the
   selected path/version consistently. Define activation as the first
   server-accepted learning activity and second session as a separate
   retention event.

**Exit criteria:** both paths are usable after a clean signup; the old flow is
not reachable for new students; real DB authorization tests pass; the funnel
can compute denominator, path selection, activation, and first return.

### Phase 1 — Complete progressive profiling and student activation

**Goal:** capture only contextual information after value is demonstrated.

1. Decide the name policy: either a single optional field on the activation
   screen or an after-activity prompt. Persist it through the existing profile
   endpoint with a test for refresh/redirect behavior.
2. Implement a course-context micro-modal for uploads/library discovery when
   no course is selected. It must be dismissible, preserve the pending action,
   and never block a study session.
3. Surface “Find classmates” only after at least one enrollment and only when
   a matching social query returns meaningful candidates.
4. Move Luna cosmetic configuration fully to Settings/Profile and introduce
   cosmetic unlock rules only if backed by existing badge/XP state; do not
   grant cosmetic state client-side.
5. Normalize student events to the contract above, with a compatibility map
   for existing event names during analysis.

**Exit criteria:** no first-run field is mandatory beyond authentication;
personalization prompts are contextual, dismissible, and idempotent; first
quiz completion and Week-1 return can be measured without client-side joins.

### Phase 2 — Professor zero-to-one activation

**Goal:** replace the cold empty dashboard with an explicit first-content
journey.

1. Add `professor_onboarding_progress` (or extend a role-safe generalized
   onboarding table) with `profile_completed_at`, `first_course_id`,
   `first_upload_at`, `tour_completed_at`, and version. RLS must be own-row
   only; service role may aggregate.
2. Route incomplete professors to `/professor/onboarding`. Build three short
   steps: profile metadata, create first course, then upload into that course.
   Reuse `CreateCourseDialog` and the established upload pipeline rather than
   cloning either flow.
3. Add a dashboard activation card when no first upload exists: `0/3` course,
   upload, invite. Make the next action deep-link to the exact route and keep
   the normal dashboard usable.
4. After the first course, show a skippable, persistent-once tour for upload,
   analytics, and batch review. Do not show it before there is content to
   point at.
5. Emit authoritative `lecture_uploaded` from the backend after upload
   acceptance and `analytics_dashboard_viewed` from the analytics route.

**Exit criteria:** a newly registered professor can reach a first upload in
one continuous flow; every checklist state survives a new session; first
upload and analytics-view conversion are measurable.

### Phase 3 — Metrics, reporting, and lifecycle recovery

**Goal:** make activation outcomes decision-grade before adding channels.

1. Add a versioned `activation_funnel_daily` view/materialized view (or a
   read-only analytics endpoint) with cohorts by signup date and role. It
   should report account creation, onboarding completion, first activity,
   first quiz, first upload, analytics view, and Day-7 retention.
2. Define timestamps and windows in SQL: student activation within 24 hours;
   professor upload within 48 hours; professor analytics view within 7 days of
   first upload; student Week-1 return as a distinct authenticated session on
   days 1–7 after signup.
3. Implement a channel abstraction for in-app, push, and email. Start by
   shipping the activation rules as in-app notifications, then enable email or
   push only after consent, delivery provider, unsubscribe, and retry/failure
   handling are in place.
4. Add the five strategy rules with event-based predicates and quiet periods:
   student no-quiz Day 1, no-avatar Day 3, inactive Day 7; professor no-upload
   Day 2, upload/no-analytics Day 5, inactive Day 14. Treat the requested
   schedule as a maximum frequency, not a reason to send duplicates.
5. Add tests for cohort boundaries, each nudge predicate, quiet periods, role
   isolation, and channel preference/opt-out.

**Exit criteria:** each North Star metric is available by cohort and role,
every nudge is idempotent and consent-aware, and metric definitions are
documented alongside their queries.

## Delivery order and risk controls

`Phase 0 → Phase 1 → Phase 2 → Phase 3`. Do not launch lifecycle email/push
before the canonical event contract and consent mechanics exist. Do not remove
legacy onboarding until activation cohorts show that the replacement is stable
for a full release window.

The immediate work is Phase 0: it converts the substantial current student
implementation from promising working-tree code into a verified, measurable
release candidate.
