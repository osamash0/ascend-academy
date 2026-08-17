# Learnstation — Full-App Audit (live deployed build)

**Target:** `https://learnstation.duckdns.org` — the running production build, not `localhost`.
**Account:** `abdul@test.com` (uid `a3261aae-…-a33f1`, role rendered as **Student**), populated with 3 courses / 13 lectures / 3 trophies / 0 due review cards / 0 past exams.
**Method:** live browser drive via Chrome MCP — DOM measurement, hit-testing, network + console capture, multi-trial reproduction. No repo, no `tsc`, no server introspection (all unavailable this session).
**Date:** 2026-08-17.

> **Scope note.** This supersedes the earlier `PART_2_STUDENT_AUDIT.md` by adding the professor, admin, alternate-view and wizard surfaces you asked about ("everything on the app"). The route inventory was taken from the JS bundle: **~30 client routes declared, and this audit reached 26 of them.** The coverage matrix at the end states exactly what was and was not exercised.

---

## Route inventory vs coverage

Extracted from `assets/index-cGX75uu5.js` (`path:` + `to:` string scan).

| Route | Reached? | Result |
|---|---|---|
| `/` , `/auth` | partial | Redirects to `/dashboard` when authenticated; auth screens not re-tested (already signed in). |
| `/dashboard` | ✅ | Audited — findings 1.x. |
| `/library` | ✅ | Audited — findings 2.x. |
| `/course/:id` | ✅ | Audited — reachable only by deep-link. |
| `/course-v3/:id` | ✅ | Alternate course browser — finding 9.1. |
| `/course/:id/study-guide` | ✅ | Graceful "not enabled" for V101. |
| `/lecture/:id` | ✅ | Deep pass — findings 3.x. |
| `/exam/:courseId` | ✅ | Config screen renders; **generate 404s** — 4.x. |
| `/exam/take/:examId`, `/exam/report/:examId` | ⛔ | Blocked by the 404 (4.1). |
| `/review` | ✅ | Empty-state only (0 cards due). |
| `/materials` | ✅ | Empty-state; renders correctly. |
| `/onboarding`, `/onboarding/upload` | ✅ | Wizard exercised through Process — findings 8.x. |
| `/settings` (General/Security/Preferences/Data&Privacy) | ✅ | All four tabs — findings 5.x. |
| `/ascent` (Overview/Trophies/MindMap/SkillTree) | ✅ | All four sub-views — findings 6.x. |
| `/leaderboard` | ✅ | Renders; All-Time not toggled. |
| `/friends`, `/friends/find`, `/friends/requests` | ✅ | All render with correct empty states. |
| `/profile`, `/profile/:userId` | ✅ | Own profile; foreign profile not tested. |
| `/admin/dashboard` | ✅ | **Redirects to /dashboard** — properly gated (7.1). |
| `/professor/courses` | ✅ | Full manager renders for a Student (7.2). |
| `/professor/courses/:id` | ⚠ | Not individually loaded; manager list covers it. |
| `/professor/lecture/:id` | ✅ | Full lecture **editor** renders for a Student (7.2). |
| `/professor/analytics/:id`, `.../advanced` | ⛔ | **Not reached** — extension navigation failed mid-session. |
| `/professor/upload/batch/:batchId/review` | ⛔ | **Not reached** — no batch id. |

---

## Severity legend
🔴 Blocker · 🟠 High · 🟡 Medium · 🔵 Low

---

## 1. `/dashboard`

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 1.1 | 🔴 | `/rest/v1/profiles` refetched forever with a byte-identical query. Never settles. | One fetch per mount, cached. | 182 requests in 63 s (still climbing); clean reload 26 in 10.5 s, rate 2.48/s, median gap 439 ms; `new Set(urls).size === 1`; 182 of 213 page resources were this call. |
| 1.2 | 🔴 | The hero — greeting, current-lecture stats and the **primary `Continue` CTA** — can render fully transparent on load; any scroll reveals it, and it stays click-interactive while invisible. **Intermittent but reproducible.** | In-viewport content must be visible at mount. | Wrapper `div.max-w-2xl.space-y-4` at `opacity:0`, `animationName:"none"`, `transform:"none"`. Reproduced on **4/4 consecutive `navigate` (full-reload) loads** at 1534 px, measured 9 s post-load, `scrollY 0`; the CTA's effective opacity computed to 0 while `elementFromPoint(centre)` still returned the button. **Not universal** — it rendered *visible* on the initial load and when `/dashboard` was reached via redirect, so the trigger is a race in the scroll-reveal observer, not every load. Any scroll (down 3 + up 5, ending `scrollY 0`) fixes it. Mechanism is confirmed; frequency is "often on direct reload," not "always." |
| 1.3 | 🟠 | `button[aria-label="Open account menu"]` is 53.7 % unclickable; its centre navigates to `/dashboard`. | The control's own box should take its own clicks. | 980-point hit-test: 46.3 % reachable; 362 pts stolen by `a[/dashboard]`, 98 by `a[/library]`, 44 NAV, 16 HEADER, 6 DIV. `elementFromPoint(163,42)` → element whose `closest('a')` is `/dashboard`. Hit by accident — a menu click went Home. Visible on every screen (header is global). |
| 1.4 | 🟠 | At mobile width the "3 people to meet" nudge paints over the greeting and `h1`. | Stack, don't overlap. | 406 px: nudge `t80 l130 w244 h54` `position:static`; intersects `h1` **244×14 px**, greeting **124×13 px**. |
| 1.5 | 🟡 | Two `Home` controls (a `BUTTON` and an `A`) overlap in the header; at 1054 px the `50 XP` label also overlaps `Home` (30×16 px). | One Home affordance. | Leaf overlap scan: `BUTTON:Home`×`A:Home` 24 px. Same collision visible on the 404 page and everywhere else. |
| 1.6 | 🟡 | The `div.ai-tutor-invite` "Upload your first lecture PDF" card looks like a CTA but isn't actionable. | Make it navigate, or render as plain copy. | 0 `a/button` descendants; `cursor:auto`; `role/tabIndex:null`; no React onClick. **Copy is correct** — `/materials` confirms 0 uploads. |

**Working:** all `/api/v1` calls on the dashboard return 200; zero console errors; `/course/:id` renders when deep-linked.

---

## 2. `/library` & course reachability

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 2.1 | 🟡 | `/course/:id` works but is unlinked. | Course cards should link to it. | Full-DOM href scan: 0 `/course/:id` hrefs, only `/lecture/:id`. Deep-linking the id from `localStorage.ascend_last_opened_course` renders correctly. Confirms & refines the prior session's "unreachable" note. |
| 2.2 | 🟡 | Course breadcrumbs print the raw UUID (hyphens as spaces) on `/course/:id`, `/exam/:id`, `/course/:id/study-guide`, and `/course-v3/:id`. | Show the title the page already has. | `Home > Course > 49344e75 ef73 41e3 939e e42965909925` while the body renders `V101`. |
| 2.3 | 🟡 | Course aggregate progress reads 0 % while its lectures report non-zero. | Roll up lectures. | `/library` header "0/10 LECTURES · 0%"; same view's cards: "Introduction. 2% complete.", "Basics. 9% complete." |
| 2.4 | 🟡 | Course "System Software and Computer Communication" shows **16 LECTURES** in the Discover drawer but **0/0 LECTURES — "No lectures in this course yet."** in the course view. | One count. | Discover drawer vs course view, same session. |

**Working:** Discover drawer opens; catalog renders.

---

## 3. `/lecture/:id`

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 3.1 | 🔴 | Browser **Back** into a `/lecture/:id?slide=N` entry re-renders the player with the entire left slide pane + all slide nav **absent from the DOM**. User is stranded (only ✕ or reload escapes). | Back restores the player or leaves the lecture. | Post-Back leaf probes `ABSENT FROM DOM` for slide label, `COMPREHENSION`, `^Continue$`, `^Previous$`, `^Listen$`; right pane survives. **Reproduced 2/2.** Same shape as prior blocker 8.1. |
| 3.2 | 🟠 | `?slide=` is inert both ways: advancing never updates the URL; loading `?slide=N` ignores N. The app emits these links itself. | Make it authoritative or stop emitting it. | Advanced to SLIDE 7/54, URL stayed `?slide=6`. Loads of `?slide=1`, `?slide=6`, `?slide=20` all → SLIDE 7. |
| 3.3 | 🟠 | First lecture-PDF fetch returns **503**; retry 200. ~18 s bare spinner. | Succeed first time or show a retry affordance. | `storage/…/01 DBS Basics.pdf`: req1 503, req2 200. Spinner with `img` count 0 at t+8 s; slide at t+18 s. |
| 3.4 | 🟠 | Third comprehension answer 61 % clipped, label unreadable at ≤1054 px. | Fully visible at supported widths. | `❌Confused` spans x457→596 inside `div.glass-card.overflow-hidden` ending x511 → 85/140 px hidden. At 1534 px: 0 px cut. Responsive-only. |

**Working:** progress writes persist (`POST learning_events` 201, `POST student_progress` 200); AI tutor answers correctly and flags out-of-slide content; slide rail, Listen, Worksheets/Related tabs, timer all render.

---

## 4. `/exam/:courseId`

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 4.1 | 🔴 | Exam is dead on the deployed backend — `START EXAM` posts to a missing route, so config→take→report is unreachable. | Mount the router or hide the entry. | `POST /api/v1/exams/course/{id}/generate` → **404 `{"detail":"Not Found"}`** (console, twice, from `MockExam-*.js`). Same-session sanity: `upload/jobs`, `assignments`, `concepts`, `schedule/me`, `ai/lecture-tagline` all 200 → unmounted `exams` router, not a down backend. No public OpenAPI to introspect (`/openapi.json` etc. all absent in prod). |
| 4.2 | 🟠 | The 404 is swallowed — pick a count, click START EXAM, nothing happens. | Surface the failure. | 10 s post-click: URL unchanged, still config screen; `window.onerror`+`unhandledrejection` captured 0. |

---

## 5. `/settings`

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 5.1 | 🟠 | The Art. 20 export is assembled client-side from **4 tables** and omits other user-keyed tables. | Cover all personal data. | Export read exactly `profiles`, `student_progress`, `learning_events`, `achievements`. Not included, though queried by `user_id` elsewhere this session: `notifications`, `course_visits`, `user_roles`; also My Materials, upload jobs, friends data, quiz answers. |
| 5.2 | 🟡 | Some tab switches need a second click — the first highlights the tab but leaves the old pane. **Now seen twice** (Data & Privacy, Ascent → Mind Map). | One click switches. | Data & Privacy: first click highlighted, pane stayed `Personal Information`; second switched. Mind Map (§6): ref-click didn't switch, coordinate-click did. **Security and Preferences switched on first click**, so it's intermittent, not universal. Same suspected click-interception family as 1.3. |

**Working — GDPR export end to end:** builds a 42,131-byte `application/json` blob, downloads `learnstation-data-2026-08-17.json` (verified via `URL.createObjectURL` + anchor-click interception). **Account deletion:** `Delete My Account` control present with correct warning copy; **NOT exercised** per instruction, so the deletion path itself remains unverified — test on a throwaway account. Security tab = password change form; Preferences = language (EN/DE) + AI-model picker (Auto/Cerebras/Groq/OpenAI).

---

## 6. `/ascent`

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 6.1 | 🟡 | Mind Map defaults to a 3D WebGL view that is unavailable in this browser; the fallback message names a "2D tree" but exposes no visible switch control on that pane. | Provide an in-pane 2D toggle, or default to 2D when WebGL is absent. | "3D view unavailable — Your browser or device doesn't support WebGL. Switch back to the 2D tree to explore the map." The 2D equivalent exists as the separate **Skill Tree** sub-view (SVG, renders fully), but the Mind Map pane itself offers no button to reach it. |

**Working:** Overview (Level 1, 50 XP, 1-day streak, stat tiles); Trophies (3 earned badges with dates); **Skill Tree** — full SVG constellation of every course/lecture with mastered/in-progress/available/locked states, "0/13 mastered", ALL/SEM filters. Genuinely polished.

---

## 7. Authorization — admin & professor surfaces (resolves the open S-K spike)

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 7.1 | ✅ working | `/admin/dashboard` is gated for a Student. | — | Navigating there **redirects to `/dashboard`**. Correct. |
| 7.2 | 🟠 *(pending backend check)* | A **Student**-role account renders the full professor toolset with no client-side role gate: `/professor/courses` (New Course + Edit/Archive/Delete per course) and `/professor/lecture/:id` (the full editor — `Save Lecture`, `Add New Slide`, all 54 slides). Not redirected, unlike admin. | If author≠student, gate these like admin. If any user may author, this is expected — then it's a **UI-consistency** issue only (admin gated, professor not). | `/profile` renders role `Student`; `/professor/lecture/126bb3c8-…` renders the editor. **Crucially unresolved:** every professor surface reachable was this account's **own** content (its 3 courses), and the account clearly authored those (via upload). So this may be by-design "any user authors their own courses." The decisive test — can it mutate a course it does **not** own — **could not be run**: the clean method (authenticated REST query for a foreign course id) was correctly blocked by the safety layer, and the UI exposes no foreign lecture ids. **No mutation was issued.** Treat as: client role-gating is inconsistent (admin yes, professor no); cross-tenant backend enforcement **untested**. |

---

## 8. `/onboarding/upload` — the "AI Course Kitchen" wizard

5-step flow: Upload → Process → Review → Quiz → Done. Exercised with an injected, clearly-labeled test PDF (`AUDIT-TEST-ignore.pdf`, a minimal 1-page doc) via synthetic drop, since the OS file picker can't be driven.

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 8.1 | 🟠 | Processing has no timeout / failure state. A file that doesn't process cleanly leaves "Luna is reading your materials…" spinning **indefinitely** with no error, cancel, or retry. | Time out and surface a failure with retry. | After **>90 s** (advertised "about 30 seconds per lecture"), still spinning; **38** polls of `/api/v1/upload/jobs`; no course produced (`/professor/courses` still shows the original 3). One list row green-checked, the other never resolved. Note the degenerate test PDF likely triggers this — but *any* unparseable upload hitting an infinite spinner is the finding. |
| 8.2 | 🔵 | The single dropped file appeared as **two** rows in the queue/process list. | One row per file. | Both rows read `AUDIT-TEST-ignore.pdf`. **Low confidence — possibly an artifact of the synthetic drop** (dragenter/dragover/drop dispatched on a bubbling container). Flagged for confirmation with a real drag-drop, not filed as certain. |

**Working:** the dropzone accepts `.pdf` (multi, 30/batch); the "29 more files" counter decremented correctly; `Generate Course` triggered an upload `POST` → **200** and advanced Upload→Process; the Process step polls job status.

**⚠ Cleanup for you:** a test upload named **`AUDIT-TEST-ignore.pdf`** was submitted. No course/lecture was created (checked `/professor/courses`), but a server-side upload job may still be queued — worth a glance at your uploads/jobs so it doesn't linger.

---

## 9. `/course-v3/:id`, social, and the 404 page

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 9.1 | 🟡 | `/course-v3/:id` renders a semester-organized course browser with a large blank mid-region between the top rail and the lecture cards. | Fill or remove the dead vertical space. | Screenshot: ~400 px of empty viewport between the semester chips and "V101 · 2 LECTURES". Renders otherwise; same UUID-breadcrumb as 2.2. |

**Working:** the wildcard `*` 404 page ("404 / Oops! Page not found / Return Home") renders cleanly; `/friends/requests` (Incoming/Outgoing empty states); `/profile/:userId` with own id redirects to `/profile` and renders; `/friends/find` returns 50 suggestions with add-friend actions.

---

## 10. Investigated and explicitly NOT defects

| Claim | Why rejected |
|---|---|
| 124 px horizontal overflow at mobile | `body{overflow-x:hidden}` clamps it; `scrollTo(300)` leaves `scrollX` 0. No sideways scroll. |
| "Back to Dashboard" (course page) stuck at opacity 0 for 16 s | Did **not** reproduce (3/3 clean loads opacity 1). Original reading was my polling script racing the entrance animation. |
| Main content invisible on `/materials`, `/ascent`, `/leaderboard` (a "systemic 1.2") | **Measurement artifact.** This app animates opacity on the compositor, so `getComputedStyle().opacity` returns the base value, not what's painted — the `Feedback` button read `opacity:0` while plainly visible. Screenshots show those pages fully rendered. **Finding 1.2 survives only because it has independent visual + behavioural proof.** *Do not trust computed opacity in this codebase.* |
| Discover courses all show disabled `Enrolled` | Can't be called wrong without a second account. |
| Dashboard hero `Continue` "does nothing" | Button was healthy on re-inspection; failure explained by a stale ref + the 1.1 re-render storm. |
| No ⌘K palette | Expected — `FEATURE_GLOBAL_SEARCH` off (already logged as 4.2 in the prior report). |

---

## 11. Not covered / could not test

| Item | Why |
|---|---|
| `/professor/analytics/:id` and `/advanced`, `/professor/upload/batch/:id/review` | Extension navigation failed mid-session; not reached. |
| `/exam/take`, `/exam/report` | Blocked by 4.1 (generate 404). |
| Review-session grading | 0 cards due; none could be forced due without DB. |
| Cross-tenant professor mutation (the actual authz test) | Clean method blocked by safety layer; UI exposes no foreign ids; no mutation issued. |
| Account **deletion** end-to-end | Deliberately not exercised (destructive) — verify on a throwaway account. |
| Foreign `/profile/:userId`, Leaderboard All-Time, notifications & uploads panels, exam 30/40 configs | Time; lower priority. |
| Upload wizard Review/Quiz/Done steps | Process never completed for the test file (8.1). |
| `tsc -p tsconfig.app.json`, CI trigger check, `backend/.env` vs `.env` reconciliation | No repo access this session. |

---

## 12. Fix plan (value / effort / risk, merge order, collisions)

File paths are **inferred from deployed chunk names** — confirm against the repo before scheduling.

| Session | Fixes | Value | Effort | Risk | Notes |
|---|---|---|---|---|---|
| **A — Kill dashboard refetch loop** | 1.1 | ★★★★★ | S | Low | Unstable query key / non-memoised dep. Do first — re-baselines every other measurement and likely also cures the 1.2 race and the stale-ref flakiness. |
| **B — Scroll-reveal fires for in-viewport content** | 1.2 | ★★★★★ | S | Med | Fire the reveal when already intersecting at mount, or drop the initial `opacity:0`. Verify **visually** (computed opacity lies here). After A. |
| **C — Header hit-target collision** | 1.3, 1.5, retest 5.2 | ★★★★☆ | S | Low | One header stacking fix frees a 53.7 %-dead primary control + the duplicate Home. Acceptance = hit-test grid ≥99 % reachable. |
| **D — Exam router + error surfacing** | 4.1, 4.2 | ★★★★☆ | S–M | Low | Ship the error-surfacing half even if the router stays unmounted; a silent dead button is worse than a disabled one. |
| **E — Lecture Back state machine** | 3.1 | ★★★★★ | M | **High** | Same class as blocker 8.1. Own PR, full player regression pass. After A. |
| **F — Make `?slide=` authoritative** | 3.2 | ★★★☆☆ | M | Med | Same player/history code as E — **serialize, never parallel**. Cheap alt: stop emitting the param. |
| **G — GDPR export completeness (+ verify deletion)** | 5.1 | ★★★★☆ | M | Low | Compliance-facing. Add missing user-keyed tables or move assembly server-side. Pair with deletion verification on a throwaway account. |
| **H — Upload pipeline timeout/error state** | 8.1 | ★★★★☆ | M | Low | Infinite spinner on a failed parse is the core-flow risk; add timeout + retry + failure UI. |
| **I — Aggregate/count consistency** | 2.3, 2.4, and the profile 2-vs-3 enrolment count | ★★★☆☆ | M | Low | Several surfaces compute course/enrolment aggregates independently — fix once in a shared selector. |
| **J — Responsive clipping + mobile hero overlap** | 3.4, 1.4 | ★★★☆☆ | S | Low | Independent CSS. Good filler. |
| **K — Mind Map 2D fallback control** | 6.1 | ★★☆☆☆ | S | Low | Add an in-pane "switch to 2D" button (Skill Tree already is the 2D view) or auto-fallback when WebGL absent. |
| **L — Cosmetic/copy** | 2.1, 2.2, 1.6, 9.1 | ★★☆☆☆ | S | Low | Link course cards to `/course/:id`; resolve breadcrumb titles; make/─unmake the ai-tutor-invite CTA; fill course-v3 dead space. |
| **M — Role-model consistency** | 7.2 | ★★★★★ *if confirmed* | ? | ? | **Spike first.** Test whether the API rejects a student's course mutation. Outcome decides severity. Security-sensitive; gate professor routes client-side to match admin regardless. |
| **N — Slide PDF 503 on first fetch** | 3.3 | ★★★☆☆ | ? | Low | Spike: Supabase storage vs signed-URL timing. An 18-s spinner on the core surface justifies it despite the retry mask. |

### Merge order
1. **A** (re-baselines everything) → 2. **C** (independent; hit-test acceptance) → 3. **B** (after A; verify visually) → 4. **D** (independent; ship error half regardless) → 5. **E** (after A; highest risk; own PR) → 6. **F** (**after E, never alongside**) → 7. **G/H/I/J/K/L** (parallel-safe with each other) → **M, N** spikes any time.

### File-collision flags
- **A ↔ B ↔ I** likely all touch `useStudentDashboard` / `studentService` / `homeFeed` — sequence, don't parallelize.
- **E ↔ F** share the lecture-player mount + history logic — hard serialize.
- **C ↔ L** both touch header/breadcrumb shell — land C first (L is cosmetic).
- **D** isolated to `MockExam` + one backend router registration.
- **H** touches the onboarding wizard + upload job polling; isolated.
- **G** touches settings Data&Privacy + export assembly; small overlap with C if 5.2's retest folds into C.
- **J, K** isolated CSS / Ascent view.
