# PART 2 — Authenticated student experience (populated account)

> **Merge note.** This session had **no repo access** — no Learnstation checkout, no
> `preview_start`, no device bridge. `APP_AUDIT_REPORT.md` could not be read, so this
> part could not be appended in place and **could not be deduped against the existing
> 27 findings in Parts 0–8**. Before merging, reconcile the numbering below (`2.x.y`)
> with the existing scheme and drop anything already filed.
>
> **Target audited:** the live deployed build at `https://learnstation.duckdns.org`
> (not `localhost:5173`). Consequently the two repo-based verification methods named in
> the brief were unavailable and were replaced:
> - `backend.main` route introspection → replaced by probing the deployed API and
>   reading real status codes (see 2.4.1). `/openapi.json`, `/api/v1/openapi.json` and
>   `/api/openapi.json` are **not exposed** in production, so the route list was
>   inferred from live responses only.
> - `tsc -p tsconfig.app.json` and CI-trigger checks → **not run**.

## Account and data under test

| Property | Value |
|---|---|
| Signed-in user | `abdul@test.com` — uid `a3261aae-41c0-4e26-890b-8906a17a33f1`, created 2026-07-13 |
| Display name | Abdulah |
| Role as rendered by the app | **Student** (`/profile`) |
| Courses (dashboard rail) | 3 — Datenbanksysteme, Intro to Linear Algebra (Student Notes), V101 |
| Lectures | 13 (10 / 1 / 2) |
| Review cards due | **0** |
| My Materials (student uploads) | **0** |
| Past exams | **none — exam generation is broken, see 2.4.1** |
| Gamification | Level 1, 50/100 XP, streak 1 day, best 1 day, 3 trophies |
| Viewport for desktop measurements | 1054×749 and 1534×835 (Chrome side panel open) |
| Viewport for mobile measurements | 406×693 (window resized to 390) |

---

## 2.1 `/dashboard`

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 2.1.1 | 🔴 | `/rest/v1/profiles` is refetched forever with a byte-identical query string. Never settles. | One fetch per mount, cached; refetch only on invalidation. | `performance.getEntriesByType('resource')`: **182 requests in 63 s**, still climbing. Second clean load: **26 in 10.5 s**, rate **2.48/s**, median inter-request gap **439 ms** (min 175, max 663). `new Set(urls).size === 1` — one distinct URL. 182 of 213 total page resources were this one call. |
| 2.1.2 | 🔴 | The hero block — greeting, current-lecture title, `PROGRESS/SLIDES/ACCURACY` stats, tagline and the **primary `Continue` CTA** — renders fully transparent and stays that way. Any scroll reveals it. It remains click-interactive while invisible. | Content in the viewport at mount must be visible without a scroll gesture. | Culprit is a single wrapper `div.max-w-2xl.space-y-4` with `opacity: 0`, `animationName: "none"`, `transform: "none"` — a settled state, not mid-animation. **4/4 clean loads** at 1534 px, measured 9 s after load, `scrollY === 0`. Screenshot shows an empty hero region while `innerText` contains `"GOOD EVENING · ABDULAH \| Basics \| IN PROGRESS \| PROGRESS 11% \| SLIDES 6/54 \| ... \| Continue"`. Scroll down 3 + up 5 (ending back at `scrollY 0`) flips it to `opacity 1` and it paints correctly. While invisible: `pointerEvents: auto`, `elementFromPoint(centre)` returns the button itself. |
| 2.1.3 | 🟠 | `button[aria-label="Open account menu"]` is more than half unclickable; its centre navigates to `/dashboard` instead of opening the menu. | The control's own box should receive its own clicks. | Button box `l=90 t=12 w=146 h=60`. `a[href="/dashboard"]` box `l=108 t=24 w=97 h=36` sits entirely inside it. 980-point hit-test grid over the button: **46.3 % reachable, 53.7 % stolen** — 362 points by `a[/dashboard]`, 98 by `a[/library]`, 44 by `NAV`, 16 by `HEADER`, 6 by a `DIV`. `elementFromPoint(163,42)` (the button's own centre) → span whose `closest('a')` is `/dashboard`, `hitIsSelfOrChild: false`. Encountered accidentally: a click intended for the account menu navigated Home. |
| 2.1.4 | 🟠 | At mobile width the "3 people to meet" nudge is painted over the greeting and the `h1`. | Nudge should stack above or below the hero text, not intersect it. | Viewport 406×693. Nudge `t=80 l=130 w=244 h=54`, `position: static`, `z-index: auto`. Greeting `t=87 l=24 w=230`; `h1` `t=120 l=24 w=350 h=86`. Rect intersection: nudge×`h1` = **244×14 px**, nudge×greeting = **124×13 px**. |
| 2.1.5 | 🟡 | The header contains two separate `Home` controls — a `BUTTON` and an `A` — whose boxes overlap. | One Home affordance. | Header leaf-node overlap scan: `BUTTON:Home` × `A:Home` overlap **24 px** on x; `BUTTON:Home` × `svg` 12 px; `svg` × `A:Home` 16 px. At 1054 px the `50 XP` label also overlaps `Home` by 30×16 px. |
| 2.1.6 | 🟡 | The `div.ai-tutor-invite` card reads "Ready to explore? / Upload your first lecture PDF" but is not actionable — it is decoration shaped like a call to action. | Either make the card navigate to the upload flow, or render it as plain copy. | On the card element: `querySelectorAll('a,button')` → **0 descendants**; `cursor: "auto"`; `role: null`; `tabIndex: null`; no `__reactProps.onClick`; `closest('a,button')` on its parent → `null`; parent `cursor: auto`. **Copy is correct** — `/materials` confirms 0 student uploads, so "your first" is accurate; the defect is purely the missing click target. |

---

## 2.2 `/library`, `/course/:id`, and route reachability

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 2.2.1 | 🟠 | A **Student**-role account reaches `/professor/courses` and is served Edit / Archive / Delete controls for every course. The link is in the student top nav as "Create". | Professor tooling should not be reachable or rendered for a student. | `/profile` renders this account's role as `Student`. `read_page` on `/library` lists `link [ref_9] href="/professor/courses"` in the header nav. Navigating there renders "Courses / Group your lectures into subjects…" plus `New Course` and, per course card, `Edit` `Archive` `Delete` — for V101 (2 lectures), Intro to Linear Algebra (1) and Database Systems (10). **Backend enforcement was NOT tested** — no destructive call was issued. Follow-up needed: confirm whether the API rejects a student's course mutation, which decides between 🔴 (authz hole) and 🟡 (UI-only leak). |
| 2.2.2 | 🟡 | `/course/:id` works but is unlinked — the previous session's "unreachable from nav" note is confirmed and refined. | Course cards should link to the course view. | Full-DOM href scan on `/dashboard`: route hrefs are `/dashboard`, `/library`, `/ascent`, `/leaderboard`, `/friends`, `/professor/courses`, `/settings`, `/lecture/126bb3c8…?slide=6`, `/lecture/6d2b028b…?slide=2`. **Zero `/course/:id` hrefs**; only 2 UUIDs appear in the whole document, both lecture ids. Deep-linking `/course/49344e75-ef73-41e3-939e-e42965909925` (id taken from `localStorage.ascend_last_opened_course`) renders the pathway correctly. |
| 2.2.3 | 🟡 | Breadcrumbs print the raw course UUID with hyphens rendered as spaces, on at least three routes. | Show the course title, which the page already has. | `Home > Course > 49344e75 ef73 41e3 939e e42965909925` on `/course/:id` while the page body renders `COURSE PATHWAY / V101` directly below. Same pattern on `/exam/:courseId` and `/course/:id/study-guide`. |
| 2.2.4 | 🟡 | Course-level progress reports 0 % while its own lecture cards report non-zero progress. | Course aggregate should roll up its lectures. | `/library` header for Database Systems: `NEW`, `0/10 LECTURES · 0%`. In the same view, `read_page` accessible names: `button "Introduction. 2% complete."`, `button "Basics. 9% complete."`. |

---

## 2.3 `/lecture/:id` — core study surface

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 2.3.1 | 🔴 | Browser **Back** into a `/lecture/:id?slide=N` history entry re-renders the player with the entire left slide pane and all slide navigation **absent from the DOM**. The user is stranded: no slide, no Previous/Continue, no comprehension check. Only ✕ or a manual reload escapes. | Back should either restore the full player or leave the lecture. | After Back, leaf-text probes return `ABSENT FROM DOM` for: slide label `SLIDE \d+ / \d+`, `COMPREHENSION`, `^Continue$`, `^Previous$`, `^Listen$`. Not an opacity artifact — the nodes do not exist. `canvas` count 3 but nothing paints; right-hand Notes/Chat pane survives intact. Screenshot shows the left half as empty background. **Reproduced 2/2.** Same shape as the confirmed blocker 8.1. |
| 2.3.2 | 🟠 | The `?slide=` query parameter is inert in **both** directions: advancing slides never updates the URL, and loading with an explicit `?slide=N` never honours N. The app generates these links itself from the dashboard. | Either make the param authoritative, or stop emitting it. | Write direction: clicked `Continue`, player advanced to `SLIDE 7 / 54`, `location.href` stayed `…?slide=6`. Read direction, all three loads landed on **slide 7**: <br>`?slide=6` → SLIDE 7/54<br>`?slide=20` → SLIDE 7/54<br>`?slide=1` → SLIDE 7/54<br>No param → SLIDE 1/54. Dashboard emits `/lecture/126bb3c8-6f69-4184-9ceb-9ccbfd4b3609?slide=6`. |
| 2.3.3 | 🟠 | The first request for the lecture PDF returns **503**; a retry succeeds. First slide paint takes ~18 s, showing a bare spinner throughout. | Signed-URL fetch should succeed first time, or fail visibly with a retry affordance. | `storage/v1/object/sign/lecture-pdfs/lectures/126bb3c8…/01 DBS Basics.pdf` — request 1 **503**, request 2 **200**, request 3 (fresh token) **200**. At t+8 s the pane is a spinner with `img` count 0; at t+18 s the slide is rendered. |
| 2.3.4 | 🟠 | The third comprehension-check answer is 61 % clipped and its label unreadable at ≤1054 px. | All three answers fully visible at supported widths. | Viewport 1054: `❌Confused` button spans x 457→**596**; nearest clipping ancestor `div.glass-card.overflow-hidden` ends at x **511** → **85 px of 140 px hidden**. `✅Got it` (310) and `🤔Unsure` (445) are inside. At viewport 1534 the same button ends at 726 vs clip 751 → **0 px cut off**. Responsive-only. |

**Verified working on this surface:** progress writes persist — clicking `Continue` fires `POST /rest/v1/learning_events` → **201** (233 ms) and `POST /rest/v1/student_progress` → **200** (356 ms). The AI tutor answers correctly and stays grounded: asked a test question about SSDs, it returned an accurate answer and explicitly flagged which part "goes beyond the provided lecture slides". Slide rail, `Listen`, `Worksheets`/`Related` tabs and the 25:00 timer all render.

---

## 2.4 `/exam/:courseId`

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 2.4.1 | 🔴 | The exam feature is dead on the deployed backend. `START EXAM` posts to a route that does not exist, so **config → take → report is entirely unreachable**. | Either mount the exams router or hide the entry point. | `POST /api/v1/exams/course/49344e75-ef73-41e3-939e-e42965909925/generate` → **404 `{"detail":"Not Found"}`**. Console, twice (23:13:57 and 23:14:36), from `assets/MockExam-CkRNjfuv.js`. Other v1 routers on the same host answer normally in the same session: `GET /api/v1/upload/jobs` 200, `GET /api/v1/assignments` 200, `GET /api/v1/concepts/student/{uid}` 200, `GET /api/v1/schedule/me?days=7` 200, `POST /api/v1/ai/lecture-tagline` 200 — so this is a missing/unmounted `exams` router, not a down backend. A 404 (rather than 403/501) is consistent with a feature flag gating router registration. |
| 2.4.2 | 🟠 | The 404 is swallowed. The user picks a question count, clicks `START EXAM`, and nothing whatsoever happens — no toast, no inline error, no disabled state, no spinner. | Surface the failure, or don't offer the control. | 10 s after each click: `location.href` unchanged, visible text still the config screen (`QUESTIONS / 20 / 30 / 40 / START EXAM`), `window.onerror` and `unhandledrejection` listeners captured **0** page-level errors. The only trace is the console line in 2.4.1. |

---

## 2.5 `/settings` — GDPR export and account deletion

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 2.5.1 | 🟠 | The Art. 20 export is assembled client-side from **4 tables** and omits other tables the app itself queries keyed to this user's `user_id`. | An Art. 20/15 export must cover all personal data held. | During export the client read exactly: `profiles`, `student_progress`, `learning_events`, `achievements`. Observed elsewhere in the same session, filtered by `user_id=eq.a3261aae-41c0-4e26-890b-8906a17a33f1` and **not** in the export: `notifications`, `course_visits`, `user_roles`. Also absent: My Materials, `/api/v1/upload/jobs`, friends/friendship data (`rpc/get_friend_suggestions`), quiz answers. |
| 2.5.2 | 🟡 | `Data & Privacy` needed two clicks to open — the first click highlighted the tab but left the `General` pane rendered. | One click switches the pane. | After the first click on `button "Data & Privacy"` the pane heading was still `Personal Information` and `General` remained the active tab; a second click at (310,416) switched it. Reproduced once; **low confidence on the mechanism** — may be the same click-interception class as 2.1.3. Worth a targeted retest before fixing. |

**Verified working — GDPR export, end to end.** Clicking `Export` reads `profiles` 200, `student_progress` 200, `learning_events` 200, `achievements` 200, builds a `application/json` blob of **42,131 bytes**, and triggers an anchor download named **`learnstation-data-2026-08-17.json`** from a `blob:` URL. Instrumented via `URL.createObjectURL` and `HTMLAnchorElement.prototype.click` interception.

**Account deletion — control confirmed, endpoint deliberately NOT exercised.** `Data & Privacy` renders a `Danger Zone` with the copy "Permanently delete your account and all associated data. This action cannot be undone." and a `Delete My Account` button. Per the brief I did not click it. Note this means the promised deletion path is **still unverified**: confirming it requires issuing the destructive call, which cannot be done on this live populated account. Recommend verifying on a throwaway account.

---

## 2.6 `/profile`, `/ascent`, `/leaderboard`, `/friends`, `/materials`, `/review`

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 2.6.1 | 🟡 | Enrolled-course count disagrees across three surfaces. | One number. | `/profile` "Enrolled courses" lists **2** (Datenbanksysteme, Intro to Linear Algebra). The dashboard course rail shows **3** (adds V101). The `/library` → Discover drawer renders **20** cards, every one a disabled `Enrolled` badge (`Enroll` variants: 0). |

**Verified working:**

- `/review` with an empty queue renders a correct empty state — "You're all caught up / No cards are due right now." with a `Back to dashboard` action. **Grading was not exercised: 0 cards were due**, and no card could be forced due without DB access.
- `/materials` with zero uploads renders correctly: `My Materials`, a `Drop PDFs here, or click to browse` dropzone with "Up to 1 more file (1 per batch)", and "No materials yet — upload a PDF to get started."
- `/ascent` renders fully — OVERVIEW/TROPHIES/MIND MAP/SKILL TREE tabs, Level 1, 50 TOTAL XP, 1 DAY STREAK, 50/100 to Level 2, and the 0 % / 0 / 4 stat tiles.
- `/leaderboard` renders This Week / All Time plus institution, faculty, semester and "Verified only" filters.
- `/friends` with 0 friends renders "Find your first study buddy" and a `Find friends` action. `/friends/find` returns 50 suggestions with institution, mutual and shared-course counts and `Add friend` buttons.
- `/course/:id/study-guide` fails **gracefully** for V101: "Couldn't load the study guide. The feature may not be enabled for this course yet." Not filed as a defect — V101 may legitimately lack a guide. **Not retested against Datenbanksysteme, which does advertise a study guide on the dashboard** — do that before closing this out.
- No `4xx`/`5xx` on `/dashboard`; every `/api/v1` call there returned 200.

---

## 2.7 Investigated and explicitly NOT defects

Recorded so nobody re-audits them.

| Claim | Why it was rejected |
|---|---|
| 124 px of horizontal overflow at mobile | `documentElement.scrollWidth` 530 vs `innerWidth` 406, but `body{overflow-x:hidden}` clamps it. `window.scrollTo(300, y)` leaves `scrollX` at **0** — the page does not scroll sideways. Carousel children extend to x=1968 but sit inside an `overflow-x: auto` scroller. No unclipped overflowing element exists (`count: 0`). |
| "Back to Dashboard" on `/course/:id` stuck at opacity 0 for 16 s | **Did not reproduce.** 3/3 clean loads read `opacity: 1` at t+8 s with `scrollY 0`. The original 16-s reading came from a `setInterval` probe injected immediately after `navigate`, racing the entrance animation. |
| Main content at effective opacity 0 on `/materials`, `/ascent`, `/leaderboard` (i.e. a systemic version of 2.1.2) | **Measurement artifact.** The app animates opacity on the compositor, so `getComputedStyle().opacity` returns the *base* value, not what is painted. Proof: the `Feedback` button reported `opacity: 0` while plainly visible in the same screenshot, and `html`/`body`/`#root` were all `opacity: 1`. Screenshots of `/materials` and `/ascent` show both fully rendered. **2.1.2 survives only because it has independent visual and behavioural proof** (blank in screenshot + fixed by scroll + 4/4). Do not trust computed opacity in this codebase. |
| All 20 Discover courses show a disabled `Enrolled` badge | Cannot be called wrong without a second account to compare against. Not filed. |
| Dashboard hero `Continue` "does nothing" when clicked | Not filed. One click produced no navigation, but the button was healthy on re-inspection (`hasReactClick: true`, `hitIsSelf: true`, `pointerEvents: auto`, not disabled) and the earlier failure is explained by a stale element ref plus the constant re-rendering from 2.1.1. |
| No `⌘K` palette | Expected — `FEATURE_GLOBAL_SEARCH` off, already logged as 4.2. |

---

## 2.8 Scope not covered this session

State honestly rather than implying coverage.

| Brief item | Status |
|---|---|
| 8. `/onboarding/upload` with a real PDF | **Not done.** |
| 6. `/review` — grade a few cards | **Not possible** — 0 cards due. |
| 9. `/exam/:courseId` take + report | **Blocked** by 2.4.1 (404). |
| 4. Quizzes on the lecture surface, in depth | Only the inline `QUICK CHECK` and comprehension-check rows were inspected; no quiz was completed. |
| Mobile resize on the 3 heaviest screens | Only `/dashboard` at 390 px. Lecture player and exam not tested at mobile. Windows would not resize below 1534 px once the side panel was open, except for the one 390 px pass. |
| N+1 patterns beyond `/dashboard` | Only `/dashboard` was profiled in depth (2.1.1). Note `/api/v1/upload/jobs` was polled 9× in one dashboard session — interval not characterised. |
| `tsc -p tsconfig.app.json`, CI trigger check, `backend/.env` vs `.env` flag reconciliation | **Not run** — no repo. |

---

## §7 delivery-plan extension

Scoring: **Value** = user-visible impact × breadth. **Effort** = S/M/L. **Risk** = chance of regression elsewhere.
File paths are **inferred from deployed asset chunk names** (`StudentDashboard-*.js`, `useStudentDashboard-*.js`, `MockExam-*.js`, `studentService-*.js`, `homeFeed-*.js`, `reviewService-*.js`, `myMaterialsService-*.js`, `coursesService-*.js`, `api-*.js`) — **confirm against the repo before scheduling.**

| Session | Fixes | Value | Effort | Risk | Notes |
|---|---|---|---|---|---|
| **S-A — Kill the dashboard refetch loop** | 2.1.1 | ★★★★★ | S | Low | Almost certainly an unstable query key or a non-memoised dep in the profile hook. Highest value per line changed: it burns ~2.5 req/s per session, and its re-render storm is the likely cause of the flakiness behind the rejected "Continue does nothing" claim. Do this first — it changes the baseline every other perf measurement is taken against. |
| **S-B — Reveal-on-scroll for in-viewport content** | 2.1.2 | ★★★★★ | S | Medium | Make the reveal fire when the element is already intersecting at mount, or drop the initial `opacity: 0`. Risk is Medium because the same reveal wrapper is used widely, so it must be re-verified **visually**, never via `getComputedStyle` (see 2.7). |
| **S-C — Header hit-target collision** | 2.1.3, 2.1.5, and retest 2.5.2 | ★★★★☆ | S | Low | One stacking/layout fix in the header clears a 53.7 %-dead primary control and the duplicate Home affordance. Re-run the 980-point hit-test grid as the acceptance check. |
| **S-D — Exam router: mount it or hide it** | 2.4.1, 2.4.2 | ★★★★☆ | S–M | Low | Two independent decisions: (a) register the `exams` router / flip the flag on the deployed backend; (b) regardless of (a), stop swallowing non-2xx from generate. Ship (b) even if (a) is deferred — a silent dead button is worse than a disabled one. |
| **S-E — Lecture Back-navigation state machine** | 2.3.1 | ★★★★★ | M | **High** | Same class as blocker 8.1. Touches player mount/unmount and history handling, so it is the one session that genuinely needs regression testing across the whole player. Schedule after S-A so the re-render noise is gone. |
| **S-F — Make `?slide=` authoritative** | 2.3.2 | ★★★☆☆ | M | Medium | Overlaps S-E in the same player/history code. **Do not run in parallel with S-E.** Cheaper option if effort is tight: stop emitting the param from the dashboard, which removes the broken promise without touching the state machine. |
| **S-G — GDPR export completeness** | 2.5.1 | ★★★★☆ | M | Low | Compliance-facing, so value is higher than user-visible impact suggests. Add the missing user-keyed tables; better still, move assembly server-side so the table list can't silently drift from the schema. Pair with verifying deletion on a throwaway account. |
| **S-H — Progress roll-up and enrolment counts** | 2.2.4, 2.6.1 | ★★★☆☆ | M | Low | Both are the same underlying problem — several surfaces each computing course/enrolment aggregates independently. Fix once in a shared selector. |
| **S-I — Responsive clipping + mobile hero overlap** | 2.3.4, 2.1.4 | ★★★☆☆ | S | Low | Independent CSS, no collisions with anything else here. Good filler session. |
| **S-J — Cosmetic + copy** | 2.2.3, 2.2.2, 2.1.6 | ★★☆☆☆ | S | Low | Breadcrumb should resolve the course title; add `/course/:id` links to course cards; make the `ai-tutor-invite` card either actionable or plain text. |
| **S-K — Investigate: student ↔ professor authorization** | 2.2.1 | ★★★★★ *if confirmed* | ? | ? | **Spike, not a fix.** Test whether the API rejects a student-role course mutation. Outcome decides severity and effort; do not schedule a fix until it returns. Treat as security-sensitive. |
| **S-L — Slide PDF 503 on first fetch** | 2.3.3 | ★★★☆☆ | ? | Low | Also a spike: determine whether the 503 originates in Supabase storage or in signed-URL generation timing. An 18-s spinner on the core study surface justifies the investigation even though the retry currently masks it. |

### Merge order

| Order | Session | Gate |
|---|---|---|
| 1 | S-A | Merge first — re-baselines all later perf and flakiness measurements. |
| 2 | S-C | Independent of S-A; acceptance = hit-test grid ≥99 % reachable. |
| 3 | S-B | After S-A. Verify visually; computed opacity is unreliable here. |
| 4 | S-D | Independent. Ship the error-surfacing half even if the router stays unmounted. |
| 5 | S-E | After S-A. Highest regression risk — own PR, full player regression pass. |
| 6 | S-F | **After S-E, never alongside it.** |
| 7 | S-G, S-H, S-I, S-J | Parallel-safe with each other. |
| — | S-K, S-L | Spikes; run any time, they produce findings not diffs. |

### File-collision flags

- **S-A ↔ S-B ↔ S-H** all likely touch `useStudentDashboard` / `studentService` / `homeFeed`. Sequence them; do not run concurrently.
- **S-E ↔ S-F** touch the same lecture-player mount and history logic. Hard serialization — S-F waits for S-E.
- **S-C ↔ S-J** both touch the header/breadcrumb shell. Minor overlap; land S-C first since S-J is cosmetic.
- **S-D** is isolated to `MockExam` plus one backend router registration — no collisions.
- **S-I** is isolated CSS — no collisions.
- **S-G** touches the settings Data & Privacy pane plus export assembly. If 2.5.2's retest folds into S-C, flag a small S-C ↔ S-G overlap in that pane.
