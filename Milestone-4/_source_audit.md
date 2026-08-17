## Part 4 — Source-level findings (R1–R54)

**Method:** repo + localhost. Every row cites `file:line` and quotes the actual code. This is the
complement to the four browser-driven prod audits: they have route coverage and live DOM/network
evidence but no source access; this has root causes but only localhost. Where a row corresponds to a
browser-observed symptom in the reconciled `M` list, it is cross-referenced.

**Coverage note.** The reconciliation (§D4) records that the **admin panel has zero functional
coverage from any document** — only its gating was tested — and that the **professor shell was
entirely unaudited on localhost**. Both are covered here for the first time.

Severity: 🔴 Blocker · 🟠 High · 🟡 Medium · 🔵 Low

---

### 4.1 Fabricated data presented to operators as real

These are grouped first because they share a failure mode that is worse than a crash: the screen
looks correct and is lying. An admin cannot tell these apart from real telemetry.

| ID | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| R1 | 🔴 | **The admin error console invents production errors.** When `SENTRY_TOKEN`/`ORG`/`PROJECT` are unset the backend returns three hand-written issues — e.g. `"PostgresError: column p.display_name does not exist"`, `"8 users affected"`, with 2026 timestamps — as `data`, and the frontend renders them as live errors. The accompanying `configured: false` / `config_help` payload **is written to state that is never read**: `sentryConfig` appears exactly once in the file, at its own declaration. So the "pending configuration" message can never render, and an admin on a system with no Sentry sees a plausible incident list. | Render `config_help` when `configured === false`. Never return fabricated issues in `data`. | `backend/api/v1/admin.py:347` `if not token or not org or not project:` → `:349 mock_errors = [` … `:392 "data": mock_errors`; `src/pages/AdminDashboard.tsx:72` is the *only* occurrence of `sentryConfig` (verified by grep); rendered at `:413-421` |
| R2 | 🟠 | **Advanced analytics fabricates AI advice on failure.** When `/api/ai/analytics-insights` fails, the `catch` synthesizes three generic recommendations — *"Engagement is lower on a few key slides."* — and renders them in the "AI Summary" hub identically to real model output. The professor gets invented pedagogical advice about slides that were never analyzed, attributed to the AI. | Render an error state. Never synthesize content attributed to a model. | `src/pages/AdvancedAnalytics.tsx:781-790` `} catch { setAiInsights({ summary: 'AI insights unavailable right now.', suggestions: [ … ] }); }`; rendered `:889-897` |
| R3 | 🟠 | **The admin "Error Volume (Last 7 Days)" chart is a hardcoded array**, drawn with hover tooltips ("30 errors") as though it were real history. | Drive from real data or delete the chart. | `src/components/admin/ErrorTrendChart.tsx:9-11` `// Mock data for a trend line …` `const mockData = [12, 19, 15, 25, 22, 30, 28];`; rendered `:24` |
| R4 | 🟡 | The admin "Platform API" health tile is hardcoded: a permanently green ping animation and `99.99%` uptime regardless of any telemetry. | Derive from real health data or delete the tile. | `src/components/admin/HealthGauges.tsx:65-72` |
| R5 | 🟡 | The fifth admin KPI tile always reads "System Health / Online / All systems operational" — a literal in the array, not derived from `stats`. | Bind to `/deployment-info`, or remove. | `src/components/admin/AdminKPISummary.tsx:51-57` |
| R6 | 🔵 | The admin Environment badge shows `0.1.0-alpha` while `package.json` is at `3.0.0`. The version readout an operator would quote in an incident is wrong. | Read the real version. | `backend/api/v1/admin.py:644` `"app_version": "0.1.0-alpha"`; `package.json:4` `"version": "3.0.0"` |

---

### 4.2 Authorization

| ID | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| R7 | 🟠 | **`ProtectedRoute` fails open when the role is unknown.** The guard is `allowedRoles && role && !allowedRoles.includes(role)` — when `role` is falsy the role check is **skipped entirely** and the route renders. `role` is legitimately `null` after loading resolves: `fetchRole` only assigns `if (roleData)`, its rejection/timeout is swallowed by `.catch(() => {})`, and `roleLoading` is cleared regardless — the provider's own comment says so. A student whose `user_roles` read times out therefore lands on `/admin/dashboard` with the console rendered. Server APIs still 403 (verified: all 14 admin routes carry `Depends(require_admin)`), but the **Content-Control tab reads Supabase directly from the client**, so it is bounded by RLS rather than by the route guard. | Deny on unknown: `if (allowedRoles && !allowedRoles.includes(role ?? ''))`. Fail closed. | `src/App.tsx:141-143`; `src/lib/auth.tsx` `fetchRole` `if (roleData) { setRole(…) }` and the deferred fetch's `.catch(() => {})`; comment: *"we then leave `role` as whatever fetchRole managed to set (null if nothing), but mark the lookup as resolved so guards stop spinning"*; client-side reads at `src/pages/AdminDashboard.tsx:114-122` |

> **Relationship to the open cross-tenant question (§D2).** R7 is *not* the same issue and does not
> answer it. R7 is a client-side rendering hole with server enforcement intact on the REST API. The
> unresolved question is whether the backend rejects a *mutation* against a resource the caller does
> not own. R7 does, however, raise the stakes on the Content-Control tab specifically, because that
> tab bypasses the API and is guarded only by RLS.

---

### 4.3 Failures presented to the user as success or emptiness

The dominant defect class in this codebase. A fetch fails, the catch sets `[]`, and the component's
*empty state* renders — so "we couldn't load your data" is displayed as "you have no data". A
professor with 40 lectures is told they have none; a student mid-outage is told they're all caught up.

| ID | Sev | Screen | What it is now | What it should be | Evidence |
|---|---|---|---|---|---|
| R8 | 🔴 | Review / Daily Ascent | `handleGrade` awaits `grade(...)` (a `mutateAsync`) and `grantXp(...)` with **no try/catch**, and the mutation has no `onError`. It is invoked as `void handleGrade(rating)`, so a rejection is an unhandled promise rejection: no toast, `setIndex` never runs, the card never advances. All four rating buttons go silently dead mid-session. | Catch, toast, keep the card with an explicit retry. | `src/features/review/ReviewSession.tsx:43-73`, call sites `:84`, `:179`; mutation `src/features/review/useReviewQueue.ts:12-18` |
| R9 | 🔴 | Exam — take | The attempt query has no error branch. On any failure (403/404/500, or an offline refresh mid-exam) `isLoading` goes false, `exam` is `undefined`, and the component `return null` → a **blank page** inside the console shell. No message, no retry, no way back. `useExamAttempt` exposes no `isError` at all. | Error state with retry + back-to-course. | `src/pages/MockExam.tsx:102`, `:138` `if (!exam ‖ !exam.questions) return null;`; hook `src/features/student/hooks/useExamMode.ts:38-47` |
| R10 | 🔴 | Professor course detail | If `getCourse` rejects, `course` stays `null` and `loading` goes false → the guard `if (loading ‖ !course)` returns a **spinner forever**. The only signal is an auto-dismissing toast. The sibling `ProfessorDashboard` already implements the correct pattern. | Error flag + retry panel, as `ProfessorDashboard.tsx:184-201`. | `src/pages/ProfessorCourseDetail.tsx:270-277`, guard `:338` |
| R11 | 🟠 | Review / Daily Ascent | `useReviewQueue` returns `error`; `ReviewSession` never destructures it. A failed queue fetch yields `cards: []` → the component renders the **success** screen: green gradient, *"You're all caught up."* An outage is shown to the student as an achievement. Given 38% of lectures have no cards (M37), this path is hot. | Branch on `error` before the caught-up state. | `src/features/review/ReviewSession.tsx:26` (no `error`), branch `:105-120`; exported-and-unused at `useReviewQueue.ts:24` |
| R12 | 🟠 | Professor analytics | On fetch failure the catch sets empty arrays, so the picker's empty state renders: *"No lectures yet — Upload a lecture to start seeing insights."* | Error flag + retry. | `src/pages/ProfessorAnalytics.tsx:41-45`; consumed `GardenLecturePicker.tsx:285-296` |
| R13 | 🟠 | Professor dashboard → Assignments | Failed `listAssignments()` → `[]` → *"No assignments yet."* A professor may duplicate assignments that already exist. | Distinguish failed-to-load from none-exist. | `src/features/assignments/ProfessorAssignmentsTab.tsx:54-57`, `:108-115` |
| R14 | 🟠 | Admin → KPI row | `loadStats` swallows to `console.error`; the strip is driven by `loading={stats === null}` → five skeletons pulse **forever**, no message, no retry. | Surface + retry. | `src/pages/AdminDashboard.tsx:87-94`, `:245`; `AdminKPISummary.tsx:12-19` |
| R15 | 🟠 | Admin → User drawer | `loadDetail` swallows; guard is `loading ‖ !detail` → a failed detail fetch spins forever with no reason given. | Error state in the drawer. | `src/components/admin/UserDetailDrawer.tsx:31-35`, `:72-75` |
| R16 | 🟠 | Professor course detail | `openPicker` is an async `onClick` with **no catch** — a rejected `fetchProfessorLectures` escapes as an unhandled rejection, and because `allLectures` stays `[]` the dialog asserts *"All your lectures are already in this course."* | Catch, toast, error row. | `src/pages/ProfessorCourseDetail.tsx:282-292` (no `catch`), `:463-466`, invoked `:379` |
| R17 | 🟠 | Review (entry point) | `/review` has **no nav tab**. Its only entry is a bento tile created `if (reviewDueCount > 0)`, and `reviewDueCount = data?.due_today ?? 0`. A failed `getReviewStats` collapses to `0`, so the entire feature vanishes with no error shown. | Persistent entry point; distinguish 0-due from stats-failed. | `src/features/student/homeFeed.ts:319-321`; `src/pages/StudentDashboard.tsx:84`; tabs `ConsoleTopBar.tsx:22-29` |
| R18 | 🟡 | Lecture view | The catch toasts and clears `loading`, but there is no `if (!lecture)` guard — only `if (loading)`. The page renders full chrome with `lecture === null`: the breadcrumb shows the loading placeholder permanently and the slide column shows *"No slides available"*. A load failure renders as an empty lecture. | Dedicated error state with retry. | `src/pages/LectureView.tsx:487-490`, guard `:948`, empty branch `:1109`, placeholder `:982` |
| R19 | 🟡 | Professor dashboard | `listCourses()` failure is `console.error`-only → `courses = []` → `ProfessorOverviewSection` returns `null`, so the **entire Course Overview block** (4 stat cards, 7-day chart, weakest-concepts list) silently disappears. | Toast and/or render the section's error card. | `src/pages/ProfessorDashboard.tsx:41-43`; `ProfessorOverviewSection.tsx:22-24` |
| R20 | 🟡 | Admin → Content Control | Both Supabase reads destructure only `.data` and drop `.error`. An RLS rejection yields `[]` → *"No content matches your filters."* | Check `.error` and route into the existing toast handler. | `src/pages/AdminDashboard.tsx:114-122` |
| R21 | 🟡 | My Materials | `useMyMaterials` returns `error`; the page destructures only six other fields. A failed `listMaterials` renders *"No materials yet."* — the student is told their uploads don't exist. | Surface the error above the list. | `MyMaterialsPage.tsx:58`, empty `:166-173`; unused `error` `useMyMaterials.ts:49` |
| R22 | 🟡 | Ascent | The achievements query destructures away `error` and has no `.catch()`. An RLS/network failure resolves `data: null` → `[]` → the 🌱 "no badges yet" empty state. | Distinguish load-failure from none-earned. | `src/pages/Ascent.tsx:269-281`, empty `:679-687` |
| R23 | 🟡 | Course view | `useStudentDashboard()` destructured without `isError`. A failed fetch → `lectures = []` → *"Empty Course — This course doesn't have any active lectures yet."* Title also falls back to a generic string. | Error branch with retry — the library screen already implements one and documents this exact hazard. | `src/pages/StudentCourseView.tsx:19`, `:138-143`, `:34-36` |
| R24 | 🟡 | Leaderboard | No error handling; a failed fetch renders `leaderboard.noLearners`. Separately `useSocialUser` falls back to `id: "me"`, so while the profile loads `myIndex` is `-1` and the summary renders rank `-`, reward `0`. | Error branch; gate the rank summary on the profile. | `src/pages/Leaderboard.tsx:19`, `:148-149`, `:70-74`; `useSocialUser.ts` |
| R25 | 🟡 | Friends (hub + find) | Neither page handles query errors. `useFriends()` failing renders the onboarding empty state *"Find your first study buddy"*; `useSearchUsers` failing renders *"No learners match your search."* | Distinguish failure from an empty graph. | `FriendsHub.tsx:11-16`, `:37-45`; `FindFriends.tsx:58`, `:136` |
| R26 | 🟡 | Admin → User Activity | The User Directory `<tbody>` has **no empty state** — a search with no hits renders a bare header with nothing under it. The adjacent Event Stream has one, so the asymmetry is unintended. | Add a `colSpan` empty row as at `:382-384`. | `src/pages/AdminDashboard.tsx:328-351` |
| R27 | 🟡 | Admin (all tabs) | `loading` is set by `loadTabData` but **no tab body consults it** — it is wired only to the Refresh button. First paint and every tab switch shows the *empty state* ("No events found.") until the request lands. | Gate each tab body with a skeleton. | `src/pages/AdminDashboard.tsx:48`, `:102`; used only `:236`, `:239`; bodies `:283`, `:396`, `:400`, `:436` |
| R28 | 🟡 | Profile (own) | `SocialProfile` has no loading or error state at all, and `useSocialUser()` returns hardcoded fallbacks — so before/without data it confidently renders name "You", 0 XP, level 1, streak 0, "No roles set", indistinguishable from a real new account. | Gate on the auth profile + extras loading state. | `SocialProfile.tsx:16-28`; `useSocialUser.ts` |
| R29 | 🟡 | Ascent | `const { data } = useStudentDashboard();` discards `isLoading`/`isError`. First paint renders hard numbers before data arrives — "0% Quiz Accuracy", "0 Lectures Done", plus *"Answer your first quiz to unlock insights."* to students who have answered hundreds. On error those zeros are permanent. | Skeletons + error state. | `src/pages/Ascent.tsx:239`, `:255-256`, `:287-291`, `:557-580`, `:363-373` |

---

### 4.4 Correctness and data-integrity

| ID | Sev | Screen | What it is now | What it should be | Evidence |
|---|---|---|---|---|---|
| R30 | 🟠 | Exam — take (timer) | The clock **counts up** and the time limit is never displayed. `timeLimit` is read only to turn the clock red. There is no countdown, no warning and no auto-submit — while the backend independently stamps `expired = now > started_at + time_limit_s + 30s`. The `expired` field is declared in the frontend type and **read nowhere**, so the report never shows it. A student who backgrounds the tab is silently marked expired with no warning at any point. | Show remaining time, warn at expiry, auto-submit or hard-block, and surface `expired` on the report. The strings already exist. | `src/pages/MockExam.tsx:194-195`, `:223-225`; backend `backend/api/v1/exams.py:302-303`; unused field `useExamMode.ts:17`; unused strings `exam.json` `runner.timeRemaining`, `runner.expiredWarning`, `report.expiredNotice` (grep: 0 refs outside locales) |
| R31 | 🟠 | Exam / study guide / config | `apiClient` throws `` `${method} ${path} → ${status}: ${text}` `` and every catch toasts `err.message`, so students see raw transport strings like `POST /api/v1/exams/course/8f3…/generate → 429: {"detail":"Rate limit exceeded"}`. The friendly i18n copy is only reached for non-`Error` throws, which never occur — `generate.notEnoughQuestions`, `generate.rateLimited` and `runner.submitFailed` are **dead strings**. | Map status → existing i18n copy; never surface `apiClient` messages to a student. | Thrower `src/lib/apiClient.ts:69-71`; consumers `MockExam.tsx:31`, `:183`, `MockExamReport.tsx:44`, `StudyGuide.tsx:79` |
| R32 | 🟡 | Exam — take | Every option click fires `saveAnswer.mutate(...)` whose `onSuccess` invalidates `['exam', examId]` → a **full attempt refetch per answer**. A `useEffect` keyed on `exam` then overwrites local `answers` with the server copy, so an in-flight refetch resolving after a newer POST **visually reverts the student's latest selection**. The mutation also has no `onError`, so a 409 ("already submitted", e.g. a second tab) fails silently. | Don't invalidate on autosave; add `onError`. | `src/pages/MockExam.tsx:110-114`, `:152`; mutation `useExamMode.ts:49-59`; backend 409 `exams.py:255-256` |
| R33 | 🟡 | Review / dashboard tile | The tile's count is an **uncapped** `COUNT(*)` of due cards; the session queue is hard-capped at 100. A student with 250 due sees "250 due", grades 100, and is told *"Session complete — 100 reviewed. Come back tomorrow for more."* while 150 are still due today. | Cap the displayed count, or offer "load next batch". | uncapped `backend/api/v1/review.py:261-269`; cap `:39` `DEFAULT_TOTAL_CAP = 100`, `:112`; copy `ReviewSession.tsx:112-115` |
| R34 | 🟡 | Exam — report | `miss_rate` is a backend float rounded to 2dp, multiplied by 100 in JS with no formatting and no i18n number formatter → labels like `28.999999999999996% miss rate`, and the same value in an inline `width:`. | `Math.round(wc.miss_rate * 100)`. | `MockExamReport.tsx:132`, `:137`; backend `exam_service.py:246` |
| R35 | 🟡 | Lecture upload | Per-slide quiz generation hardcodes `ai_model: 'cerebras'`, ignoring the professor's model selection that every sibling call passes through. | Pass `aiModel` as at `:493`. | `src/pages/LectureUpload.tsx:739` vs `:493`; `useAIGeneration.ts:200` |
| R36 | 🟡 | Lecture upload | Bulk quiz generation swallows every per-slide failure to the console, then fires an **unconditional success toast** — if all N slides fail the professor is told *"Generated 0 suggested quiz recommendations."* | Count failures; destructive toast when `successCount === 0`. | `useAIGeneration.ts:216-218`, `:226-229` |
| R37 | 🟡 | Admin → Health | "DB Connections" shows `count(*) FROM pg_stat_activity` — every connection on the **server** — rendered against a pool max the backend re-declares as a literal string. `"47 / 20 used"` is reachable; the bar is silently clamped by `Math.min(…,100)`. | Report pool-held connections, or relabel. | `backend/api/v1/admin.py:589`, `:618-619`; `HealthGauges.tsx:23-24`, `:89` |
| R38 | 🟡 | Exam — take | `navigate()` is called in the render body when the attempt is already submitted — a side effect during render (React logs *"Cannot update a component while rendering a different component"*). | `useEffect`, or return `<Navigate replace />`. | `src/pages/MockExam.tsx:141-144` |
| R39 | 🔵 | Lecture view | `fetchLectureData` calls `setLoading(true)` then early-returns on a missing id **without clearing it** → permanent spinner. | Clear loading on every exit path. | `src/pages/LectureView.tsx:378` vs `:401` |

---

### 4.5 Dead, dishonest or unreachable UI

| ID | Sev | Screen | What it is now | What it should be | Evidence |
|---|---|---|---|---|---|
| R40 | 🟠 | Global | **`FEATURES.globalSearch` reads `VITE_FEATURE_GLOBAL_SEARCH`, which is defined nowhere** — not in `.env`, not in `.env.example`, not in any compose file or Dockerfile. It is permanently `false` in every environment. The ⌘K/`/` palette never registers, `<CommandPalette>` never mounts, the top-bar search affordance is `undefined`, and the course-view "Ask this course" CTA never renders. A fully-built feature is dark everywhere. | Define the var or delete the flag and its dead branches. | `src/lib/featureFlags.ts:9`; gates `ConsoleLayout.tsx:61`, `:80`, `:142`, `StudentCourseView.tsx:110`, `:207`; absent from `.env` and `.env.example` (verified) |
| R41 | 🟡 | Professor dashboard | `handleArchiveLecture` is fully implemented (confirm → archive → toast) but **never referenced** — `ProfessorHeroStage` exposes only analytics/edit/preview/delete. Meanwhile the Archive page instructs professors to *"select 'Archive' on the lecture control deck"* — a control that does not exist. The only way to archive is the side effect of setting a course to "Uncategorized". | Wire it in, or delete it and fix the Archive copy. | `ProfessorDashboard.tsx:146-157` (no call site); `ProfessorHeroStage.tsx:9-19`; `ProfessorArchive.tsx:353` |
| R42 | 🟡 | Professor analytics → Ask bar | Thumbs-up/down are theatre: they fire a toast thanking the user and record **nothing** — no API call, no state, no store. | Post to a feedback endpoint (one exists), or remove. | `ProfessorAskBar.tsx:145-146` |
| R43 | 🟡 | Advanced analytics | Two whole sections are dead behind `const … = false`, including a "Predictive Intervention Hub" whose **"Intervene" button has no `onClick` at all**, plus a full table/loader/empty-state. Flipping the flag ships a non-functional button. | Delete, or implement `Intervene` before the flag can move. | `AdvancedAnalytics.tsx:540-541`, gates `:976`, `:1294`, button `:1343-1346` |
| R44 | 🔵 | Batch review | "Done reviewing" / "Done reviewing all" mutate only a local `Set` — nothing is persisted, so a refresh resets every card. The file comment concedes this is *"intentionally cosmetic"*. | Persist, or relabel honestly (e.g. "Hide"). | `BatchReviewPage.tsx:23-26`, `:196-199` |
| R45 | 🔵 | Advanced analytics | `extraLoading` is initialised `false` and **never set** (no `setExtraLoading` call exists anywhere in `src/`) — three skeleton branches are unreachable dead code. | Remove, or wire to the fetch it was meant to track. | `AdvancedAnalytics.tsx:582`; consumed `:1170`, `:1205`, `:1400` |
| R46 | 🔵 | Course view | An unconditional, unflagged "Try new view →" button ships to every student, self-described in the adjacent comment as a temporary preview toggle. It routes to `/course-v3/:courseId`, which renders the same component as `/library`. | Flag it or remove it. | `StudentCourseView.tsx:103-109`; route `App.tsx:370-378` |
| R47 | 🔵 | Feedback widget | The route map is keyed by exact `pathname`, and the entry `'/professor/analytics/advanced'` **can never match** the real route `/professor/analytics/:lectureId/advanced` → bug reports from that screen file under a raw pathname with `features: []`. | Key on a pattern. | `FeedbackWidget.tsx:109-112`, matched `:122`; actual route `App.tsx:450` |
| R48 | 🔵 | Study guide | The error state is terminal — icon plus *"Couldn't load the study guide. The feature may not be enabled for this course yet."* — with no retry, even though a transient 500 is the likeliest cause. This copy is also why the reconciliation could not tell flag from data (§C1). | Add a retry calling `refetch()`. | `StudyGuide.tsx:172-178` |
| R49 | 🔵 | Professor analytics | A deep link whose slug matches nothing (deleted/renamed lecture) falls through every branch leaving both ids `undefined` — the page silently renders the course picker with no "not found" signal. | Show a not-found notice. | `ProfessorAnalytics.tsx:59-85`, final `else` `:76-81` |
| R50 | 🔵 | Exam — config/report | Shipped i18n strings with **zero code references**: `generate.timeLimit` (no time-limit control exists), `runner.flagForReview`/`flagged` (no flagging UI), `runner.autosaving`, `runner.submitConfirmOk`/`Cancel` (a native `window.confirm` is used), `report.sentToReview` with a card count (the button flips to a static "Already sent"), `report.viewSlide` (the backend returns `slides` per weak concept; the report never links them), `report.history`. | Ship the UI or drop the strings. | `src/i18n/locales/en/exam.json`; config UI `MockExam.tsx:54-90`; `window.confirm` `:169-170`; `MockExamReport.tsx:106`; unused payload `exam_service.py:247` |

---

### 4.6 Feature flags — full inventory

Three flags exist, all build-time Vite vars, all compared `=== '1'`, so **any unset or empty value is
`false`**. `.env.example` ships all three blank, so a fresh checkout gets three dark features with no
console warning.

| Flag | Env var | `.env` | `.env.example` | What disappears when off |
|---|---|---|---|---|
| `reviewEngine` | `VITE_FEATURE_REVIEW_ENGINE` | `1` | empty → **off** | Dashboard review-stats query `enabled: false` → `reviewDueCount` 0 → the Daily Ascent tile never renders. `/review` stays routable by URL. Also hides the professor review-cards panel (`LectureUpload.tsx:1947`). |
| `studentUploads` | `VITE_FEATURE_STUDENT_UPLOADS` | `1` | empty → **off** | "My Materials" tab filtered out of `STUDENT_TABS`; materials bento widget suppressed. `/materials` stays routable by URL. |
| `globalSearch` | `VITE_FEATURE_GLOBAL_SEARCH` | **absent** | **absent** | Permanently off everywhere — see R40. |

Definitions `src/lib/featureFlags.ts:7-11`. Consumers `ConsoleTopBar.tsx:74-76`, `ConsoleLayout.tsx:61,80,142`, `StudentDashboard.tsx:82,89,92`, `StudentCourseView.tsx:110,207`, `LectureUpload.tsx:1947`.

> Note the routability asymmetry: turning a flag off hides the **entry point** but leaves the route
> live. A user with a bookmark reaches a feature the product believes is disabled.

---

### 4.7 Verified working — do not "fix" these

Recorded because several are the reference implementations the broken screens above should copy.

**Reference patterns worth copying**
- **`StudentCourseLibrary`** is the reference three-state implementation: loading spinner, a dedicated `isError` screen with a working `refetch()` retry, and a *separate* empty state with a catalog CTA — and it carries a comment explaining exactly why error and empty must not be conflated (`:538-577`). Every R3 finding is a failure to do what this file already does.
- **`ProfessorDashboard`** has a real loading skeleton, a dedicated error screen with a working Retry (`:168-201`, `setIsError(true)` at `:127`), and a genuine empty state (`:261-269`).
- **`Settings`** is the best-covered screen in the app: every async handler (avatar upload, preset select, profile save, password change, notification toggle, data export, account delete) has try/catch with a destructive toast and a `finally` clearing its pending flag. The notification loader carries a comment explaining why it uses `await`+`finally` rather than `.then().finally()` precisely to avoid a stuck-disabled toggle (`:469-472`).

**Backend authorization**
- Every route in `backend/api/v1/admin.py` carries `Depends(require_admin)` — all 14 verified by enumerating the `@router` decorators. Client-side role manipulation cannot reach admin data **through this API**. (R7 is about client rendering and the direct-Supabase Content-Control tab, not this.)
- `signUp` deliberately does **not** upsert `user_roles` from the client, with a comment explaining that doing so would let any user grant themselves `professor`. Role assignment is a DB trigger.

**Exam correctness that is genuinely right**
- The timer **survives refresh and tab backgrounding**: elapsed time is recomputed from the server's `started_at` every tick rather than accumulated locally, so a reload or a throttled background interval cannot drift it (`MockExam.tsx:117-128`). This is the correct pattern and is worth noting given R30 criticises the same component.
- Answers survive refresh — autosaved server-side and rehydrated from `exam.answers` on mount.
- Submit failure is handled: `mutateAsync` in try/catch with a toast, button disabled while pending; network loss at submit does not navigate away or lose answers. Double-submit is blocked server-side with a 409.
- The report handles a missing report explicitly rather than rendering blank, and guards weak-concepts on a non-empty array.

**Other verified-correct**
- Professor courses list, professor archive, batch review page and the insight garden all implement the full loading/error/empty triad with catch+toast on every mutation; `actionInProgress` correctly disables every button during an in-flight action.
- All friend-graph mutations have `onError` toasts (add, accept, decline, cancel, unfriend, bootstrap, profile save).
- Lecture-view telemetry is fire-and-forget with `.catch()` throughout, so it can never block or break the lesson.
- Upload hooks fail safe **by design and say so**: duplicate-check and parse-cache soft-fail to a normal upload with documented rationale; file type/size validated before any network call.
- Destructive admin actions (factory reset, restore, delete backup) are all behind an `AlertDialog` with a `disabled={actionLoading}` confirm and catch+destructive toast.
- Dev-only routes (`/pixi-lab`, pipeline test) are excluded from production builds via `import.meta.env.DEV`; the retired `FAST_UPLOAD` route redirects rather than 404s.
- **No `href="#"`, no-op `onClick`, or console.log-only handler exists on any student screen.** The only `href="#"` occurrences are in the public marketing footer (already filed), and there are no `TODO`/`FIXME` markers in any rendered student path.

---

### 4.8 Live-verified on the professor account (localhost, 2026-08-18)

First localhost browser drive of the professor shell, on `prof@admin.com` (32 lectures, 4 courses,
34 students). **Non-visual evidence only** — DOM, network and database reads. No opacity, layout or
animation claim is made here, because the window reported `visibilityState: "hidden"` throughout and
the Part 1 pre-flight never passed. Anything visual on this surface remains uncovered.

| ID | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| R51 | 🟠 | **`lectures.total_slides` silently desynchronises from the real slide count, and the dashboard renders the stale counter.** The professor hero shows `Slides {lecture.total_slides}` — a denormalised column — while the slides themselves live in the `slides` table. Measured across all 32 of this professor's lectures: **2 (6%) report `0` while actually holding slides — 32 and 127 respectively.** "Advanced Topics in Cryptography" displays `SLIDES 0` and has **127 slides**. To the professor the lecture looks empty and unprocessed. | Derive the count, or make the counter's update transactional with slide insertion so it cannot be left behind. | Rendered `src/features/analytics/components/ProfessorHeroStage.tsx:52` `Slides {lecture.total_slides}`; selected `src/pages/ProfessorDashboard.tsx:90` `.select('id, title, description, total_slides, …')`; live REST comparison of `lectures.total_slides` vs `count(slides)` per lecture, 32/32 lectures checked |
| R52 | 🟠 | **Stalled extraction jobs have already done the work — this reframes M16.** The two jobs stuck in `extracting` (`09-pq.pdf`, `05-boolean-functions-sboxes.pdf`) are the **same two lectures** as R51. So the pipeline extracted the slides successfully (127 and 32 rows written) and then hung *before* the finalisation step that sets `total_slides`. The prod audit recorded these as stuck "since at least 23:45"; they were still `extracting` at 01:20 the next day, ~2h later. M16 was filed as "uploads never complete"; in fact **the content is present and recoverable** — only the terminal transition is missing. | A fix that only adds a timeout would mark these *failed* and discard recoverable work. Make finalisation idempotent and re-runnable, and reconcile `total_slides` from the real count on completion **and** on recovery. | `GET /api/v1/upload/jobs` → 2 jobs, both `status: "extracting"`; slide counts 127/32 present for the corresponding lectures; header control reads "2 uploads in progress" |
| R53 | 🟡 | **`/api/v1/upload/jobs` returns no timestamps.** The payload carries `status` and filename but no `created_at`/`updated_at`, so neither the UI nor an operator can tell whether a job is 30 seconds or 2 days old. This is why M16 needed a human to notice it, and why the two stuck jobs above sat unremarked. | Return `created_at`/`updated_at` and surface job age in the uploads popover. A stuck job should be self-evident. | `GET /api/v1/upload/jobs` response objects contain no timestamp fields (verified live; both returned `null` for every timestamp probe) |
| R54 | 🔵 | **"Good morning" is shown from 00:00 to 11:59.** At 01:00 the professor dashboard greeted "GOOD MORNING · PROF". The logic is `if (hour < 12) return morning`, **duplicated verbatim in two files**, and no `night` key exists in either locale. Affects EN and DE equally. | Add a night band (or make it neutral), and extract the one shared helper. | `src/pages/ProfessorDashboard.tsx:161-163`; `src/pages/StudentDashboard.tsx:283-285`; locales expose only `morning`/`afternoon`/`evening` (`en/common.json:50`, `en/dashboard.json:2`) |

**R41 confirmed live.** The lecture control deck exposes exactly four controls — `View Analytics`,
`Preview Lecture`, `Edit Lecture`, `Delete Lecture`. There is **no Archive control**; the only
"Archive" in the DOM is the nav link to `/professor/archive`. This confirms from the running app
what §4.5 found in source: `handleArchiveLecture` is implemented, nothing reaches it, and
`ProfessorArchive.tsx:353` instructs professors to use a control that does not exist.

**Verified clean on this surface:** the professor dashboard loads with **zero console errors**, all
data populated (34 students, 32 lectures, 155 quiz attempts), and **0 dead anchors across 55
interactive controls** — no `href="#"`, no handler-less links. The `href="#"` problem is confined to
the public marketing footer.

**Observed, not filed — needs a second look by someone with product context:**
- The "Course Overview" panel reports `ACTIVE STUDENTS (7D) 0`, `AVG COMPLETION 0%`, `AVG QUIZ ACCURACY 0%`, `MEDIAN TIME 0` while the global strip above it reports 34 students and 155 quiz attempts. The panel is explicitly scoped "LAST 7 DAYS", so all-zero may be perfectly correct on a quiet week. **Not filed as a defect** — distinguishing "no activity in 7 days" from "the 7-day aggregate is broken" needs a known-active window to test against. Related: M38–M41 (aggregate/count roll-ups).
- Both assignments visible to this professor are titled *"Auto-generated load-test assignment."* — load-test fixtures sitting in the working data set, consistent with M36 (catalog is largely fixtures).
