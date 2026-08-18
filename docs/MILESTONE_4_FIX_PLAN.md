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
| 11 | A-S3+D | M9, M19, M28, M29, M55, M56 | Exam 404 in prod, `.env` config consolidation, misleading nginx/vite comments | Tonight | ⬜ | not started — touches deploy-time config, extra care needed |
| 12 | E | M8 | Browser Back strands lecture player (no slide pane) | Tonight | ⬜ | not started |
| 13 | F | M21 | `?slide=` URL param inert | Tonight | ⬜ | after E |
| 14 | R+X | M14,M15,M16,M33,M34,M51,R53 | Upload jobs stuck forever, no timeout/terminal state, batch review lies about counts | Tonight | ✅ | [#37](https://github.com/osamash0/ascend-academy/pull/37) — root cause was `asyncio.CancelledError` on job timeout not being caught; added idempotent reconciliation + worker heartbeat |
| 15 | Error-handling sweep (student side) | R8,R11,R17,R18,R21,R22,R23,R24,R25,R29 | Failed fetches silently render empty/success states on student pages | Tonight | ✅ | [#36](https://github.com/osamash0/ascend-academy/pull/36) — 10/11 fixed, R39 was already fixed on main |
| 15b | Error-handling sweep (professor/admin side) | R10,R12,R13,R14,R15,R16,R19,R20,R26,R27,R28 | Same pattern on professor/admin pages | Tonight | ✅ | [#33](https://github.com/osamash0/ascend-academy/pull/33) — all 11 fixed |
| 16 | Legal reachability (mechanical part) | M27, M3 | Wire footer links to real pages, remove links to nonexistent pages | Tonight | ✅ | [#34](https://github.com/osamash0/ascend-academy/pull/34) |
| 17 | Onboarding | M31, M32, M60, M61, M62, M67-M70 | Hardcoded course filter, stale product name, no draft persistence, no virtualization, a11y | Tonight | ✅ | [#34](https://github.com/osamash0/ascend-academy/pull/34) — M68/M70 investigated and found not to be real bugs (documented in PR) |
| 18 | Low-effort correctness | M77, M78, M79(code), M80, R34, R35, R36, R37, R38, R39, R44, R46, R47, R48, R49, R54, R41, R42, R43 | One-line/small correctness fixes scattered across the app | Tonight | ✅ | [#31](https://github.com/osamash0/ascend-academy/pull/31) — all 17 findings fixed |
| 19 | Housekeeping | M57, M58, M59 | Dead component, dead routes, loose root scripts | Tonight | ⬜ | not started |
| 20 | Data cleanup | M36, M37, M39 | 83% noise in course catalog (dev fixtures), 38% of lectures missing review cards | Tonight, if safe | ⬜ | not started |

Sessions 21+ (M38, M40-M43, M45, M46, M48-M50, M52, M53, M63, M65, M71-M76, R18-R33 remainder) will be picked up after the above if time allows — logged here as they land.

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

_This file is updated live as work lands. Last updated: see git log._
