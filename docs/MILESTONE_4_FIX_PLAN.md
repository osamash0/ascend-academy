# Milestone 4 — Overnight Fix Plan & Log

**Source:** `Milestone-4/APP_AUDIT_REPORT.md` (the canonical consolidated audit — 135 findings, supersedes the other 5 documents in that folder) plus `Milestone-4/PROBLEMS.md` (ranked open-problem table) and `Milestone-4/AUDIT_ADDENDUM_previously_uncovered.md`.

**How this session works:** autonomous overnight run. Every row below either (a) got fixed, tested, and merged to `main` tonight with no need to wake you up, or (b) is flagged `NEEDS YOU` because it requires information, credentials, or a judgment call only you can make. I did not start on anything in category (b) tonight except where a code-level mitigation was possible without the missing piece.

Status legend: ⬜ pending · 🔄 in progress · ✅ done & merged · 🚫 needs you (blocked)

---

## Needs your input (nothing done here without you — see notes)

| ID | What | Why it needs you |
|---|---|---|
| F1 | Live Supabase service-role JWTs committed in git history, still valid | Only the project owner can rotate keys on the live Supabase project. I cannot rotate credentials on your behalf. |
| M1–M3, M66, M81 | Privacy policy / Impressum content (real company name, address, contact, processor list, transfer basis) | Legal content requires your real business details and ideally lawyer review — I will not invent a company name or address. I *did* fix the mechanical parts (see below). |
| M17 / cross-tenant mutation test | Verifying whether a student account can actually mutate another user's course via the API | Requires deliberately attempting a destructive/authz-bypassing write against your **live production** database with a second real account. I won't do this without your explicit go-ahead on which environment/account to use. |
| M79 removal candidates that touch deploy config | `VITE_AUTH_URL`, prod `.env` consolidation | Fixed the code-level dead-var removal; did **not** touch the deployed Hetzner env without your confirmation (see A-S3 note below). |
| A-S3+D (session #11): M9, M19, M28, M29, M55, M56 — exam-router mount + `.env` consolidation + nginx/vite comment fixes | Deliberately **not attempted tonight.** The audit's own Part 7 §E2 guidance says this class of change "can silently flip a feature flag in production" and must be merged alone, smoke-tested against `docker-compose.prod.yml`, never bundled with anything else. That already argues for isolation and caution; on top of it, some of these findings (M9 exam-router-mount-in-prod, M28/M29 env consolidation) only truly matter once they're reconciled against the **actual deployed** Hetzner `.env`/nginx config, which I can't safely diff and reload without your live access and without risking a prod outage while you're asleep and unable to confirm the site is still up. This is exactly the kind of "only you can decide" call flagged in your instructions — deferring is the conservative choice, not a decision to skip it. Recommend tackling this as its own dedicated session with you present to verify prod after deploy. |
| Data cleanup (session #20): M36, M37, M39 — 83% dev-fixture noise in the course catalog, 38% of lectures missing review cards | Deliberately **not attempted tonight.** These aren't code bugs — they're row-level `DELETE`/backfill operations against the **live shared Supabase project** (`lkiiideqjoiksnycgplc`), the same project that had the [egress-overage incident](project_supabase_egress_overage.md) and where a prior audit found the `reset_all_analytics` RPC could wipe data ([DB/env audit](project_db_env_audit.md)). Even a "verifiably safe" dev-fixture delete is a destructive, hard-to-reverse action on production data with **no backup/PITR on the free tier** (confirmed 2026-08-17) — a bad WHERE clause here isn't a revertable PR, it's a data-loss incident. I have not built or run a query against this data tonight. If you want this done, I'd want you to review the exact `DELETE`/backfill SQL before it runs, ideally after taking a fresh `pg_dump` first. |

Everything else below was actionable without you and is being worked tonight.

---

## Execution plan (priority order, following the audit's own merge-order in Part 7)

| # | Session | IDs | Area | Category | Status | PR |
|---|---|---|---|---|---|---|
| 0 | A-S0 | M64 | Fix 18 TypeScript errors so `tsc` can gate CI | Tonight | ✅ | [#27](https://github.com/osamash0/ascend-academy/pull/27) |
| 1 | F8 | F8 | Student enrollment query has no filter — new students can't enroll | Tonight | ✅ | [#28](https://github.com/osamash0/ascend-academy/pull/28) |
| 2 | U(b) | M4/N1 | Kill stale AI-replay overwriting saved slide edits (data corruption) | Tonight | ✅ | [#32](https://github.com/osamash0/ascend-academy/pull/32) |
| 3 | O | M5 | Editor "Save Lecture" button unreachable under sticky header at scroll | Tonight | ✅ | [#32](https://github.com/osamash0/ascend-academy/pull/32) |
| 4 | V | M12/N2 | Unsaved-changes guard (beforeunload + dirty marker) | Tonight | ✅ | [#32](https://github.com/osamash0/ascend-academy/pull/32) — also found & fixed a *pre-existing* broken version of this guard (checked "has content" not "was edited") |
| 5 | U(a) | M4 | De-amplify save writes (1 field edit → 20 writes) | Tonight | ✅ | [#32](https://github.com/osamash0/ascend-academy/pull/32) |
| 6 | W | M13/N3 | Quiz suggestion generated but never persisted/shown | Tonight | ✅ | [#32](https://github.com/osamash0/ascend-academy/pull/32) |
| 7 | C | M24, M44 | Header hit-target collisions (account menu / Home button) | Tonight | ✅ | [#35](https://github.com/osamash0/ascend-academy/pull/35) — root-caused live in a real browser (long display name + narrow-ish viewport overlaps the nav), not just from the audit description |
| 8 | B | M7 | Dashboard hero can render fully transparent | Tonight | 🔍 | Checked live across 4 fresh reloads with real opacity/animation inspection — did not reproduce (opacity:1 every time). Likely already mitigated by the M6 dashboard-refetch fix that landed before this audit ran, or highly environment/timing-specific. Not fixed further; flagging as unconfirmed rather than closing it. |
| 9 | R1,R3,R4,R5,R6 | — | Admin panel fabricates data (fake errors, fake charts, fake uptime, wrong version) | Tonight | ✅ | [#30](https://github.com/osamash0/ascend-academy/pull/30) |
| 10 | R7 | — | `ProtectedRoute` fails open on unknown role (security) | Tonight | ✅ | [#29](https://github.com/osamash0/ascend-academy/pull/29) |
| 11 | A-S3+D | M9, M19, M28, M29, M55, M56 | Exam 404 in prod, `.env` config consolidation, misleading nginx/vite comments | Tonight | 🚫 | **Moved to "Needs your input" below — not attempted.** |
| 12 | E | M8 | Browser Back strands lecture player (no slide pane) | Tonight | ✅ | [#39](https://github.com/osamash0/ascend-academy/pull/39) |
| 13 | F | M21 | `?slide=` URL param inert | Tonight | ✅ | [#39](https://github.com/osamash0/ascend-academy/pull/39) — shipped together with E since both touch `LectureView.tsx`'s restore-index logic (per the hard-serialize rule below) |
| 14 | R+X | M14,M15,M16,M33,M34,M51,R53 | Upload jobs stuck forever, no timeout/terminal state, batch review lies about counts | Tonight | ✅ | [#37](https://github.com/osamash0/ascend-academy/pull/37) — root cause was `asyncio.CancelledError` on job timeout not being caught; added idempotent reconciliation + worker heartbeat |
| 15 | Error-handling sweep (student side) | R8,R11,R17,R18,R21,R22,R23,R24,R25,R29 | Failed fetches silently render empty/success states on student pages | Tonight | ✅ | [#36](https://github.com/osamash0/ascend-academy/pull/36) — 10/11 fixed, R39 was already fixed on main |
| 15b | Error-handling sweep (professor/admin side) | R10,R12,R13,R14,R15,R16,R19,R20,R26,R27,R28 | Same pattern on professor/admin pages | Tonight | ✅ | [#33](https://github.com/osamash0/ascend-academy/pull/33) — all 11 fixed |
| 16 | Legal reachability (mechanical part) | M27, M3 | Wire footer links to real pages, remove links to nonexistent pages | Tonight | ✅ | [#34](https://github.com/osamash0/ascend-academy/pull/34) |
| 17 | Onboarding | M31, M32, M60, M61, M62, M67-M70 | Hardcoded course filter, stale product name, no draft persistence, no virtualization, a11y | Tonight | ✅ | [#34](https://github.com/osamash0/ascend-academy/pull/34) — M68/M70 investigated and found not to be real bugs (documented in PR) |
| 18 | Low-effort correctness | M77, M78, M79(code), M80, R34, R35, R36, R37, R38, R39, R44, R46, R47, R48, R49, R54, R41, R42, R43 | One-line/small correctness fixes scattered across the app | Tonight | ✅ | [#31](https://github.com/osamash0/ascend-academy/pull/31) — all 17 findings fixed |
| 19 | Housekeeping | M57, M58, M59 | Dead component, dead routes, loose root scripts | Tonight | ✅ | [#38](https://github.com/osamash0/ascend-academy/pull/38) — deleted `AppSidebar.tsx`/`Insights.tsx`, moved 16 loose root scripts into `scripts/archive/` (verified root `main.py` is harmless dead Replit boilerplate, not the real backend entrypoint) |
| 20 | Data cleanup | M36, M37, M39 | 83% noise in course catalog (dev fixtures), 38% of lectures missing review cards | Tonight, if safe | 🚫 | **Moved to "Needs your input" below — not attempted.** |

Sessions 21+ (M38, M40-M43, M45, M46, M48-M50, M52, M53, M63, M65, M71-M76, R18-R33 remainder) will be picked up after the above if time allows — logged here as they land.

---

## Sessions 21+ (post-blocker sweep)

Continuing the night: went back through the audit for everything not yet scheduled above, including a few findings the original session-21+ list missed on first pass (M20, M23, M25, M47, R9, R30–R33). Dispatched as parallel background fix-sessions, each independently tested and reviewed before merge.

| # | Session | IDs | Area | Status | PR |
|---|---|---|---|---|---|
| 22 | Upload limits + dedupe | M65, M75 | nginx 100M vs backend 50M upload-limit mismatch; upload wizard queued the same file twice with no client dedupe | ✅ | [#40](https://github.com/osamash0/ascend-academy/pull/40) — nginx limit needs a container rebuild/redeploy to take effect, not attempted (deploy step, not a code risk) |
| 23 | Enrolled-course count | M41 | `/profile` (2) vs dashboard (3) vs Discover drawer (20, all "Enrolled") disagreed | ✅ | [#41](https://github.com/osamash0/ascend-academy/pull/41) — new additive migration broadens `get_user_courses` RPC to match the backend's enrollment+assignment+owned definition (did not edit the historical migration file); Discover drawer turned out to already be fixed by F8's PR #28, no separate bug found |
| 24 | Ascent Mind Map 2D toggle | M47 | WebGL-unavailable fallback told users to "switch back to the 2D tree" with no button to do it | ✅ | [#42](https://github.com/osamash0/ascend-academy/pull/42) — fallback now has a working "Switch to Skills" button wired to the parent's existing tab-switch handler |
| 25 | Professor hero/editor guardrails + dead CTA | M42, M45, M48, M49, M50, M74 | Breadcrumb UUIDs, dead `ai-tutor-invite` CTA, 0-slide lecture headlined as "Active Protocol", empty Pipeline Diagnostics table, destructive delete buttons with no separation from primary actions, professor shell showing student XP | ✅ | [#43](https://github.com/osamash0/ascend-academy/pull/43) |
| 26 | Course title/progress/link consistency | M38, M40, M43 | Course title translated on the card list only (not the other 4 surfaces); course progress rollup stuck at 0% while lecture cards showed real progress; library cards not linked to `/course/:id` | 🔄 | in progress |
| 27 | Responsive sweep | M23, M25, M52, M53 | Exam answer clipped ≤1054px; mobile dashboard nudge overlaps h1; professor editor doesn't collapse on mobile; `/course-v3` blank vertical space | 🔄 | in progress |
| 28 | Branding/auth polish + flaky test | M63, M72, M73 | 3 different logo treatments across Landing/Auth/Impressum; password placeholder dots look pre-filled; flaky Onboarding test | 🔄 | in progress |
| 29 | Exam feature reliability | R9, R30, R31, R32, R33 | Exam fetch errors render a blank page; timer counts up with no countdown/auto-submit; raw API error strings shown to students; answer-save race can revert the latest selection; review due-count uncapped vs the 100-card session cap | 🔄 | in progress — highest regression risk in this batch, will get extra review before merge |
| — | M20 (GDPR export) | M20 | Audit found the export missing several tables | ✅ already fixed | Investigated — `Settings.tsx`/`account_service.py` already export via a server-side `EXPORT_TABLES` list (~22 tables), not the old 4-table client-side assembly the audit found. No longer reproduces; no action needed. |
| — | M46 retest | M46 | Settings/Ascent tab switch sometimes needs a second click | 🔍 confirmed, root cause unclear | Personally retested live in the browser (not delegated). Confirmed it's genuinely intermittent — reproduced 2 consecutive failed clicks on the Data & Privacy tab in one session, worked cleanly in another. `activeTab` is driven by `useSearchParams()` or the `?tab=` URL param; couldn't isolate whether the loss is a React Router `setSearchParams` batching race or a click-hit-target issue in the time available. Not fixed — flagging as confirmed-but-unresolved rather than guessing at a change to state management I'm not fully confident about. |
| — | M76 retest | M76 | Single drag-drop appeared as two queued rows | not independently retested | The audit itself flags this as possibly a synthetic-drop artifact ("confirm with a real drag before treating as real"). A real drag-and-drop isn't something I can reliably simulate through this session's browser automation, so I did not attempt a fresh repro — leaving the audit's own low-confidence flag as-is rather than fixing blind. M75 (the confirmed, related dedupe bug) is fixed in PR #40 regardless. |

---

## Rules I'm following

- Never bundle env/config consolidation with anything else (audit's own warning — it can silently flip a feature flag in prod).
- Hard-serialize sets that touch the same files (per audit Part 7 §E2): legal vs landing reveal; dashboard-refetch family; lecture Back vs `?slide=`; save-write-set vs quiz-suggestion persistence; editor action bar vs unsaved-guard.
- Every merge to `main` is tested first (unit tests for backend logic, `npm test`/`tsc`/`lint` for frontend, and a live browser check via the preview tools for anything user-visible).
- Squash-merge each session as one PR so any single fix can be reverted independently.
- Branch from the now-current `main` (`5b789d5`, synced from `origin/main` at session start — local `main` was 95 commits stale; old tip preserved at `backup/local-main-pre-sync-20260818`).

---

## Discovered along the way (not in the original audit)

| What | Where | Status |
|---|---|---|
| `Settings.test.tsx` has a pre-existing failing/flaky test (`notification_preferences` toggle never becomes enabled in the test harness) | `src/__tests__/pages/Settings.test.tsx:118-123` | Confirmed it fails identically on unmodified `main` before any of tonight's changes — not a regression from this session. Not fixed yet; flagging for a future session. |

---

## End-of-night summary (good morning)

13 PRs merged to `main` tonight (#27–#39), covering every audit blocker except the ones that genuinely need you (F1 key rotation, M1–M3/M66/M81 legal copy). Highlights:

- **Security:** `ProtectedRoute` no longer fails open on an unknown role (R7); student enrollment query filter restored (F8).
- **Data integrity:** editor no longer replays stale AI output over saved edits, write amplification fixed, quiz suggestions now actually persist (M4/M12/M13 family).
- **Reliability:** upload jobs no longer get stuck forever on job-timeout cancellation — root cause was `asyncio.CancelledError` not being caught by `except Exception` (R+X family).
- **UX correctness:** ~30 error-handling findings across student/professor/admin fixed (failed fetches were silently rendering as empty/success states); header hit-target collisions fixed; lecture Back-button/`?slide=` param fixed; onboarding, legal-link, and low-effort correctness batches all landed.
- **Trust:** admin panel no longer fabricates errors/charts/uptime data.
- **Housekeeping:** dead component/routes removed, loose root scripts archived.

Every merge was tested (backend pytest, frontend tsc/lint/vitest, and live browser verification via the preview tools for anything user-visible) and squash-merged as an independently-revertable PR.

**Two items deliberately left for you** (see "Needs your input" above for full reasoning): A-S3+D (deploy-config/env consolidation — production-config risk) and data cleanup M36/M37/M39 (destructive DELETEs on the live, backup-less Supabase project). Both are code-clean but operationally risky in ways only you can green-light safely.

**One item flagged, not closed either way:** M7 (dashboard hero transparency) — checked live 4x, never reproduced; likely already fixed by an earlier commit, but not confirmed clean.

**One pre-existing flake found, not fixed:** `Settings.test.tsx`'s notification-preferences toggle test — reproduces on unmodified `main`, not a regression from tonight.

_This file is updated live as work lands. Last updated: see git log._
