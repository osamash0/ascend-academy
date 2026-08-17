# Learnstation — Consolidated App Audit

**Compiled:** 2026-08-18 · **Branch:** `docs/f8-bounded`
**Supersedes:** every other audit document in this folder. Those remain on disk as primary evidence
(see [Source documents](#source-documents)); this file is the one you act from.

**135 distinct findings** — 81 reconciled from five prior audits (`M1`–`M81`) plus 54 new
source-level findings (`R1`–`R54`) for surfaces no previous document had read.

| | Blockers | High | Medium | Low |
|---|---|---|---|---|
| Reconciled (`M`) | 8 open + 3 fixed | 26 | 30 | 15 |
| Source-level (`R`) | 4 | 15 | 25 | 10 |

---

## Source documents

Five audits ran independently, with different access and against different builds. That difference
is the single most important thing to understand before reading a finding, because it determines
what each document could and could not see.

| Doc | Build | Access | Blind to |
|---|---|---|---|
| **A** `APP_AUDIT_REPORT.md` | localhost | repo + DB + browser | Professor shell, admin panel, most authenticated student depth |
| **B** `LEARNSTATION_FULL_APP_AUDIT.md` | **prod** (`learnstation.duckdns.org`) | browser only | Source, config, DB — no `file:line` possible |
| **C** `PART_2_STUDENT_AUDIT.md` | **prod** | browser only | Same; superseded by B, which absorbed it |
| **D** `PROFESSOR_ACCOUNT_AUDIT.md` | **prod** | browser only | Same |
| **E** `AUDIT_ADDENDUM_previously_uncovered.md` | **prod** | browser + authorized writes | Same |
| **R** (this doc, Part 4) | localhost | repo + live professor drive | Prod drift; anything visual (pre-flight never passed) |
| **F** (this doc, Part 8) | `main` + **live prod DB** | repo + `pg_catalog` + prod storage | Anything visual — no browser drive; code- and query-level only |

**Prod is not necessarily main.** B/C/D/E audited a deployed build; several of their findings may
already be fixed in the repo, and several repo findings may not be deployed. Part 5 separates these.

---

## 0. Executive summary

### 0.1 Fixed today — verified, committed

| ID | What | Evidence |
|---|---|---|
| **M6** | **The dashboard was making 60 Supabase requests/second while idle** — ~216k/hour per open tab. `refreshProfile` was an unmemoized closure and an effect dependency, closing a self-driving loop: fetch → `setProfile(new object)` → provider re-render → new identity → effect re-fires. It turned on object **identity**, so it span at full speed while everything was working. The 1000+ repeated `fetchProfile error` console entries were this loop running against an expired token — a symptom, not a separate defect. | Measured in Chrome on an idle `/dashboard`: **300 requests in 5s → 0 after the fix**. Cause isolated pre-fix by navigating away (`/friends` = 0.8/s, a 75× drop). Zero console errors on clean reload where 6020 had accumulated. Commit `24dc9a2`; regression test verified to fail against the un-memoized version. |
| **M10** | Onboarding dead-ended into a blank screen — intro → step 1 → Back → continue left the user with no controls and no escape but a reload. | Commit `f682bde` + regression test. |
| **M11** | The upload wizard's primary CTA failed silently — every failure mode (expired session, 5xx, dropped connection, 429) looked like "the button did nothing". | Commit `cd426cf` + regression test. |

> **M6 is a prime suspect for the documented Supabase egress overage.** It was reported as a
> symptom by a prod audit that could not see the cause; the root cause and fix are new here.

### 0.2 The fourteen open blockers — 8 reconciled + 4 source-level + 2 from the milestone consolidation

Ordered by what I would fix first, not by discovery order. M1–M3 share a row: they are one legal workstream.

| ID | Blocker | Why it ranks here |
|---|---|---|
| **F8** | **A new student cannot enroll in any course.** Every catalog entry renders disabled reading "Enrolled" | **Nothing downstream matters if signup dead-ends.** Confirmed and reproduced live with a zero-enrollment account. Scope is bounded — one policy, one caller. |
| **F1** | **Live Supabase service JWTs are committed in git history** and still valid | Credential exposure, not a bug. Fails the nightly `secret-scan` every night. Needs key rotation, which only the account owner can do. |
| **M4** | Professor save writes every slide, and a later AI action re-writes them from stale client state — silently resurrecting values already changed and saved | **The most severe finding that destroys user data.** Fix before anything else in the app itself. |
| **M5** | Scrolling makes "Save Lecture" unclickable — it slides under the sticky header, and clicks land on **Sign out** | Edit → scroll → Save = sign yourself out and lose the work. Compounds M4. |
| **M1–M3** | Privacy policy states a falsehood in both languages; Impressum is unfilled boilerplate; both legal pages unreachable | Genuine legal exposure in a DACH market, and the cheapest fix in the document — no runtime code. |
| **R1** | **The admin error console invents production errors** | An operator cannot tell fabricated incidents from real ones. Worse than a crash: the screen looks correct and is lying. |
| **M9** | Exam is dead on the deployed backend — `START EXAM` posts to a missing route | Whole feature unreachable in prod. May be a config artifact (see M29). |
| **M8** | Browser Back into a lecture strands the user in a player with no slide pane | Only ✕ or reload escapes. |
| **M7** | Dashboard hero can render fully transparent while staying click-interactive | ⚠️ **Verify under the Part 1 pre-flight before touching** — the one retracted finding in this audit had this exact shape. |
| **R8** | Review grading has no error handling — a rejection silently deadens all four rating buttons mid-session | Unhandled rejection; no toast, card never advances. |
| **R9** | Exam attempt fetch has no error branch — any failure renders a **blank page** with no way back | `return null` on `undefined`. |
| **R10** | Professor course detail spins **forever** if the course fetch rejects | The sibling dashboard already implements the correct pattern. |

### 0.3 The two structural themes

Most of the 135 findings are instances of two patterns. Fixing the pattern is worth more than
fixing the instances.

**1. Failure rendered as emptiness or success.** A fetch fails, the catch sets `[]`, and the
component's *empty state* renders. A professor with 40 lectures is told they have none (`R12`); a
student mid-outage is told *"You're all caught up"* on a green success screen (`R11`); a failed
admin query says *"No content matches your filters"* (`R20`). 20+ findings share this shape.
`StudentCourseLibrary.tsx:538-577` already implements it correctly **and carries a comment
explaining exactly why error and empty must not be conflated** — every one of these is a failure to
do what that file already does.

**2. Fabricated data presented as real.** Invented Sentry incidents (`R1`), a hardcoded error-volume
chart with hover tooltips (`R3`), synthesized "AI insights" attributed to the model on API failure
(`R2`), permanent `99.99%` uptime (`R4`). These are the most dangerous class in the document because
they are invisible to the user: nothing looks broken.

### 0.4 What no one has tested

Full detail in Part 6. The one that matters most:

> **Cross-tenant mutation has never been tested.** All four prod audits flag it; none ran it. Every
> one stopped at the same line — *"no mutation was issued."* It is the audit's only open security
> question, it is scoped and reversible, and it is one login away. `R7` raises the stakes: the
> client-side route guard **fails open when the role is unknown**, and the admin Content-Control tab
> reads Supabase directly rather than through the API, so it is bounded by RLS alone.

Also entirely uncovered: **the admin panel's functionality** (only its gating was ever tested — no
admin-role account has ever been signed into), **auth screens**, **dark mode on any screen**, and
**a German-locale walkthrough** — which matters because §1 establishes the DE text is the legally
operative version.

---

## Part 1 — Methodology, and the traps that produced false findings

**Read this before verifying any visual finding.** These rules are not process hygiene; between them
they account for one retracted finding and two phantom blockers across the five audits.

### 1.1 The rAF pre-flight — mandatory before any visual measurement

Chrome throttles `requestAnimationFrame` to **zero** in a backgrounded window. framer-motion drives
every reveal animation in this codebase with rAF. Therefore, in a background tab, *any*
reveal-animated element measures `opacity: 0`, and **a screenshot captures the pre-animation frame** —
looking exactly like a genuine rendering bug.

```js
let n = 0; const t0 = performance.now();
await new Promise(r => { const tick = () => { n++;
  if (performance.now() - t0 > 800) return r(); requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
({ frames: n, PASS: n > 20, vis: document.visibilityState, focus: document.hasFocus() })
```

A healthy foreground tab returns ~48. **Do not record a visual finding unless this passes.**

This was reproduced **three times** during compilation of this document:
1. Original: 0 frames in 15 s → produced the retracted "2 of 6 feature cards are invisible" finding.
2. 2026-08-18, second session, different tab: the probe **never returned at all** (CDP timed out at 45 s) while a screenshot of that same frozen tab painted a full, correct-looking page.
3. Same session, minutes later: `/` rendered **completely blank** in a screenshot. Not filed — same artifact.

`M7` (transparent dashboard hero) has exactly this shape and **must** be re-verified under a passing
pre-flight before any work is done on it.

### 1.2 Never trust `getComputedStyle().opacity` in this codebase
Two documents independently reached this rule. Verify visually, in a foreground tab.

### 1.3 Run a single-variable control before filing an interaction bug
A "double-click wedges the wizard" claim died to exactly this.

### 1.4 Gates that lie
- **`tsc -p tsconfig.json` checks nothing.** Always `tsconfig.app.json`.
- **CI runs nothing on feature branches** — only `pull_request` and `push` to `main`. A green-looking branch is not a tested branch; you get signal only once a PR is open.
- **`test_force_reparse_skips_cache` is genuinely nondeterministic**, not order-dependent. A clean run is expected roughly half the time and is not evidence of anything.
- **Concurrent Claude sessions share this working tree.** Re-check `git status` immediately before every commit. During this session alone, another session opened a PR from this branch and a third moved this report into `Milestone-4/`.

### 1.5 `useSound` is not a suspect
It wraps every AudioContext call in try/catch, so `play()` cannot throw and abort a handler. Ruled out; don't re-investigate.

---
# Milestone-4 audit reconciliation — Sections A & B

**Source labels used throughout:**

| Label | Doc | Environment |
|---|---|---|
| **A** | `APP_AUDIT_REPORT.md` | localhost:5173 + repo + backend introspection + DB |
| **B** | `LEARNSTATION_FULL_APP_AUDIT.md` | prod, browser-only, student acct `abdul@test.com` |
| **C** | `PART_2_STUDENT_AUDIT.md` | prod, browser-only, same acct (**superseded by B**) |
| **D** | `PROFESSOR_ACCOUNT_AUDIT.md` | prod, browser-only, `prof@admin.com` |
| **E** | `AUDIT_ADDENDUM_previously_uncovered.md` | prod, authorized write-testing, `prof@admin.com` |

---

## Part 2 — Reconciled findings (M1–M81)

**81 findings after merge** (from ~90 raw rows across the five docs). B and C are near-total duplicates of each other — every C finding is merged into its B twin below.

| ID | Severity | Screen/Area | What it is now | What it should be | Evidence | Source doc(s) |
|---|---|---|---|---|---|---|
| **M1** | 🔴 | `/datenschutz` — legal | Privacy policy states a falsehood in **both** languages: §4 Processors says *"Ollama (local) … No data is sent to external AI services"*; DE `legal.json`: *"Es werden keine Daten an externe KI-Dienste gesendet."* In reality `litellm/config.yaml` routes every LLM stage (`stage-text`, `stage-vision`, `stage-outline`, `stage-deck`) to **Cerebras, Groq, Google Gemini** — three US providers. Ollama is not on the LLM path. | Name Cerebras/Groq/Google as processors + DPA + Art. 44–46 transfer basis; remove the Ollama claim; fix EN **and** DE; lawyer review. | `litellm/config.yaml` model list; `grep -rli ollama backend src` → only requirements.txt + OCR fallback tests; `grep -i ollama de/legal.json`. Corroborated in prod: B/C observed the Settings→Preferences AI-model picker offering **Auto/Cerebras/Groq/OpenAI** to end users. | A §1.1 (+ prod corroboration B §5) |
| **M2** | 🔴 | `/impressum` — legal | Unfilled boilerplate in both locales: EN `[First and last name / Company name]`, `[Street and number]`, `[Postal code and city]`; DE `[Vor- und Nachname / Firmenname]`, `[Straße und Hausnummer]`, `[PLZ und Ort]`; repeated under §55(2) RStV. | Real name, address, contact. §5 TMG/DDG requires a *complete* Impressum; incomplete is independently `abmahnbar`. | Screenshot of live page; `grep -oE "\[[^]]+\]"` on both `legal.json` files | A §1.2 |
| **M3** | 🔴 | Landing footer / legal reachability | Both legal pages are unreachable. `/impressum` has **zero** inbound links; all 13 landing footer links are `href="#"` incl. the one labelled "Privacy". `/datenschutz` is linked only from a consent line at `Auth.tsx:428`. | Reachable from every page footer; German law requires "easily recognisable and directly reachable" (~2 clicks). | `document.querySelectorAll('footer a')` → all 13 hrefs are `#` | A §1.3 (same footer as M27) |
| **M4** | 🔴 | Professor lecture editor — save path | **Save writes every slide, and a later AI action re-writes them from stale client state, silently resurrecting values already changed and saved.** One-field edit fans out into un-transacted writes; a subsequent AI generation replays a stale in-memory copy over the DB. | Write only what changed, in one transaction; never replay a cached slide set. | Changing *one* slide title → **20 writes**: `PATCH /rest/v1/lectures` ×1, `PATCH /rest/v1/slides` ×**15**, `PATCH /rest/v1/quiz_questions` ×**4** (quizzes never touched), all 204, **19.4 s cumulative**, slowest 2088 ms. Resurrection: set title `…Basics [AUDIT]` → save → revert to `Database Systems Basics` → save (3 writes) → hard-reload verified clean (`titleExactlyOriginal: true`, `auditMarkerGone: true`) → clicked *Suggest Quiz* → `POST /api/v1/ai/generate-quiz` + **14 × `PATCH /rest/v1/slides`** → after reload title read `Database Systems Basics [AUDIT]` **again**. Restored and re-verified. | E N1 |
| **M5** | 🔴 | `/professor/lecture/:id` editor | Scrolling makes **"Save Lecture" completely unclickable** — it slides under the sticky global header; clicks land on **Sign out** and **Settings**. Edit → scroll → click Save = sign yourself out and lose the work. | Editor action bar stays below the header, or header yields. | 1122-point hit-test grid over Save. At `scrollTop = 0`: button `top:135`, **99.1 % reachable**. At `scrollTop = 121` (page max scroll): button `top:14`, **0 % reachable — 0/1122 points**. Interceptors: `HEADER` 304 pts, `a[/settings]` 225, `btn:"Sign out"` 225, `DIV` 216, `btn:"Notifications (2 unread)"` 152. Header is `position:sticky; top:0; height:76; z-index:40`. Screenshot confirms. | D P1 (+ E §2 confirms Save itself persists — 204s survive hard reload — so this is *purely* click interception) |
| **M6** | 🔴 ✅ **FIXED — commit `24dc9a2` on `docs/f8-bounded`** | `/dashboard` — auth context / profile refetch | `/rest/v1/profiles` refetched forever with a byte-identical query string. Never settled. **Root cause (repo-level, found and fixed today):** `refreshProfile` in `src/lib/auth.tsx` was a **fresh closure every render** and is an effect dependency in `useStudentDashboard.ts:26` and `StudentCourseLibrary.tsx:150`. That closed a self-driving loop: `refreshProfile` → `fetchProfile` → `setProfile(new object from network)` → `AuthProvider` re-render → **new `refreshProfile` identity** → effect re-fires. The **unmemoized context value object at `auth.tsx:287`** re-rendered every `useAuth` consumer and supplied the engine. The trigger is **object identity, not failure**, so it span at full speed while everything was working. | Memoize the context value and every function it exposes so effect dependencies are identity-stable. | **Prod (B/C):** `performance.getEntriesByType('resource')` → **182 requests in 63 s**, still climbing; clean reload **26 in 10.5 s**, rate **2.48/s**, median gap **439 ms** (min 175, max 663); `new Set(urls).size === 1`; 182 of 213 total page resources were this one call. **Not present on the professor shell** — `/professor/dashboard` made **1** profiles call in 23 s (D §3). **Localhost reproduction (today):** idle `/dashboard` in Chrome → **300 requests to `/rest/v1/profiles` in 5 s = 60/s, ~216k/hour per open tab**. Isolated by navigating away pre-fix: `/friends` = **0.8/s**, a **75× drop**. **Fix:** memoized `fetchProfile`, `fetchRole`, `signUp`, `signIn`, `signOut`, `refreshProfile` and the context value. **After: 0 requests in 5 s.** Zero console errors on clean reload where **6020** had accumulated. **452/452 frontend tests pass.** Regression test added and verified to fail against the un-memoized version. **Also explains** the 1000+ repeated `fetchProfile error` console entries some docs may have recorded — that was this loop running while an access token was expired, i.e. a **symptom of M6, not a separate defect**. | B 1.1 = C 2.1.1 (+ D §3 scope-limit; + localhost repro, root cause and fix, this session) |
| **M7** | 🔴 | `/dashboard` hero (prod) | Hero — greeting, current-lecture stats, tagline and the **primary `Continue` CTA** — can render fully transparent on load; any scroll reveals it; stays click-interactive while invisible. Intermittent but reproducible. | In-viewport content must be visible at mount. | Wrapper `div.max-w-2xl.space-y-4` at `opacity:0`, `animationName:"none"`, `transform:"none"` — a *settled* state, not mid-animation. **4/4 consecutive `navigate` full-reload loads** at 1534 px, measured 9 s post-load, `scrollY 0`. Screenshot shows empty hero while `innerText` contains `"GOOD EVENING · ABDULAH \| Basics \| … \| Continue"`. Scroll down 3 + up 5 (ending `scrollY 0`) → `opacity 1`, paints correctly. While invisible: `pointerEvents: auto`, `elementFromPoint(centre)` returns the button. **Not universal** — visible on initial load and when reached via redirect. **Not present on the professor shell.** ⚠️ See §B1 — shares a shape with A's retracted §2.1; both B and C independently rejected the *systemic* version as a compositor-opacity artifact and defend this one only on independent visual + behavioural grounds. **Note:** with M6 now fixed, re-measure — B itself predicted the refetch storm was "likely also cur[ing] the 1.2 race and the stale-ref flakiness". | B 1.2 = C 2.1.2 (+ D §3, + B §10 / C §2.7 self-limits) |
| **M8** | 🔴 | `/lecture/:id` (prod) | Browser **Back** into a `/lecture/:id?slide=N` entry re-renders the player with the entire left slide pane and all slide nav **absent from the DOM**. User stranded — only ✕ or reload escapes. | Back restores the full player or leaves the lecture. | Post-Back leaf-text probes return `ABSENT FROM DOM` for: slide label `SLIDE \d+ / \d+`, `COMPREHENSION`, `^Continue$`, `^Previous$`, `^Listen$`. **Not an opacity artifact — the nodes do not exist.** `canvas` count 3 but nothing paints; right-hand Notes/Chat pane survives. **Reproduced 2/2.** | B 3.1 = C 2.3.1 |
| **M9** | 🔴 | `/exam/:courseId` (prod) | Exam is dead on the deployed backend — `START EXAM` posts to a missing route, so config → take → report is entirely unreachable. | Mount the `exams` router (or flip the flag) or hide the entry point. | `POST /api/v1/exams/course/49344e75-ef73-41e3-939e-e42965909925/generate` → **404 `{"detail":"Not Found"}`**, console, twice (23:13:57, 23:14:36), from `assets/MockExam-CkRNjfuv.js`. Same-session sanity: `GET /api/v1/upload/jobs` 200, `/api/v1/assignments` 200, `/api/v1/concepts/student/{uid}` 200, `/api/v1/schedule/me?days=7` 200, `POST /api/v1/ai/lecture-tagline` 200 → unmounted router, not a down backend. 404 (not 403/501) is consistent with a flag gating router registration. No public OpenAPI in prod to introspect. **See §C — locally `backend/.env` sets `FEATURE_EXAM_MODE=1` and the feature is live.** | B 4.1 = C 2.4.1 (+ A §4.1 for the local flag state) |
| **M10** | 🔴 ✅ **FIXED — commit `f682bde` on `docs/f8-bounded`** | `/onboarding` | Onboarding dead-ended into a blank screen: intro → step 1 → Back → intro → continue left the user on a permanently empty container with no controls; only escape was a manual reload. Root cause: `handleBack` set `setStep(0)` (`Onboarding.tsx:337`) but step content renders via discrete guards `{step === 1 …}` through `{step === 5 …}` (lines 712, 742, 844, 1010, 1134) — **no branch for `step === 0`**. | `setStep(1)` alongside `setStage('form')` at line 224, making intro→form entry self-healing. | Repro table (100 % reproducible, clean load, no HMR): step 3 gives `input=false btns=[] bodyTextLen=0`. **Fix verified 3 ways:** live browser repro now ends `input=true btns=[Back,Next]`; survives 3 consecutive Back→continue cycles; regression test in `src/__tests__/pages/Onboarding.test.tsx` **fails with the fix reverted**. **Committed**, not a working-tree change. ⚠️ Prod status unverified — B exercised `/onboarding` but did not run the Back-then-continue repro. | A §8.1 |
| **M11** | 🔴 ✅ **FIXED — commit `cd426cf` on `docs/f8-bounded`** | Student upload wizard — "Organize my material" | The primary CTA failed silently: every failure mode was invisible. `useBatchUpload.ts` wrapped the request in `try { … } finally { setIsSubmitting(false); }` with **no `catch`**; the call site (`StudentUploadWizard.tsx:333`) is an `async onClick` with no try/catch. Rejection became an unhandled rejection; `finally` cleared the spinner so the UI looked idle. Not 429-specific — 401, 500 and network loss take the same path. | `catch` in `submitBatch` surfacing the server's `detail`, marking queued rows `failed` so `retryFile()` can act. | Observed live: `toastNodes=0`, no error text in `document.body.innerText`; only trace was console `Upload /api/v1/upload/batch → 429: {"detail":"The processing queue is busy right now. Please retry in a few minutes."}` with the stack `apiClient.ts` → `useBatchUpload.ts` → `StudentUploadWizard.tsx`. Fix adds `toUserMessage()`, `submitError`, a `role="alert"` banner, and returns `null` on failure. 3 regression tests in `src/__tests__/hooks/useBatchUpload.test.tsx` (real 429 body, non-JSON 502 falling back to generic copy, error-clearing on later success), **all 3 fail with the fix reverted**. **Committed**, not a working-tree change. ⚠️ Prod status unverified. | A §8.5 |
| **M12** | 🟠 | Professor lecture editor | **No unsaved-changes protection of any kind.** A dirty editor gives no warning on reload, tab close, or in-app navigation; the edit is silently discarded. | `beforeunload` guard + block in-app route changes while dirty + a visible dirty marker. | With a modified Slide Title in the field: `typeof window.onbeforeunload === 'function'` → **false**; no dirty marker in DOM (`/unsaved\|not saved/` → no match). Clicked the `Dashboard` nav item → navigated immediately, `window.confirm` interceptor recorded **0 calls**, change gone on return. **Combined with M5 this is a complete data-loss path.** | E N2 (closes D §4's "unsaved-changes guard — untested") |
| **M13** | 🟠 | Professor Quiz Suggestions tab | `Suggest Quiz` reports success but the generated question is **not persisted or displayed**. | Persist and render the suggestion, or surface the failure. | `POST /api/v1/ai/generate-quiz` → **200 in 11.3 s**, then 14 × `PATCH /rest/v1/slides` → 204. UI showed "AI is crafting a recommended quiz question…" then the card disappeared. After hard reload slide 1 shows **"No suggested quiz generated yet."** with the button again. **37 `Suggest Quiz` buttons present → 0 of 54 slides hold a suggestion** after a successful generation. Likely downstream of M4 (the 14 stale PATCHes may be clobbering it). | E N3 |
| **M14** | 🟠 | `/professor/upload/batch/:id/review` | Batch review claims more lectures than it renders. | Counts must match. | Header: **"13 lectures ready"**. Rendered cards: **12** (`Open editor` ×12, `Done reviewing` ×12). Off by one. Batch id `13ce1e17-e562-45a8-a25b-f59188d2d6aa`. | E N4 |
| **M15** | 🟠 | `/professor/upload/batch/:id/review` | Batch review **silently omits in-flight and stuck items**, so a batch looks complete when it isn't. | Show queued/failed members with their state. | Two jobs carrying the same `batch_id 13ce1e17…` stuck at `status:"extracting"`, `error: null` (lecture ids `21e0be6b…`, `c895b00d…`). They appear **only** in the header Uploads dropdown (`09-pq.pdf`, `05-boolean-functions-sboxes.pdf`); `main.innerText` on the batch review page contains neither filename. | E N5 |
| **M16** | 🟠 | Upload/ingest pipeline (student wizard + professor uploads + API) | **Uploads stick indefinitely with no timeout, no error, no retry.** Severity disagreement: E filed the API-layer half as 🔵; B and D both filed 🟠 — **taking 🟠**. | Time out, set a terminal error state on stalled jobs, surface a failure with retry, and show stuck jobs in the uploads panel. | **Student (B 8.1):** after **>90 s** (advertised "about 30 seconds per lecture") still "Luna is reading your materials…"; **38** polls of `/api/v1/upload/jobs`; no course produced (`/professor/courses` still showed the original 3). **Professor (D P2):** two of the professor's own real PDFs stuck — `09-pq.pdf` and `05-boolean-functions-sboxes.pdf` at `extracting`; badge read **2** at 23:45 and still **2** at 23:55 (**≥10 min**), no state change, no error affordance. **API (E N9):** `/api/v1/upload/jobs` returns both jobs `status:"extracting"`, **`error: null`** after **15+ minutes** (badge still 2 at 00:02) — nothing in the payload marks them failed, so no client *could* surface a failure. | B 8.1 + D P2 + E N9 |
| **M17** | 🟠 | `/professor/courses` — ownership scoping | Course manager is **not fully owner-scoped**: one course appears with full `Edit / Archive / Delete` in **two different accounts**. | Manageable only by its owner (or explicit co-owners). | `prof@admin.com` `/professor/courses` lists **"Database Systems — 10 lectures — 9 LP - 4. Semester"** with Edit/Archive/Delete. `abdul@test.com` (uid `a3261aae…`, role rendered **Student**) `/professor/courses` listed **the same course, same lecture count, same description**, also with Edit/Archive/Delete. Other courses **are** correctly scoped (student's V101 + "Intro to Linear Algebra (Student Notes)" absent for the professor; professor's Cryptography/SWT absent for the student) — which makes the shared row anomalous rather than by design. **Backend enforcement untested — no mutation issued.** | D P3 (refines B 7.2 / C 2.2.1 — see §B2) |
| **M18** | 🟠 | Client-side role gating consistency | A **Student**-role account renders the full professor toolset with no client-side role gate: `/professor/courses` (New Course + Edit/Archive/Delete per course) and `/professor/lecture/:id` (full editor — `Save Lecture`, `Add New Slide`, all 54 slides). `/admin/dashboard` **is** gated (redirects). The link is in the student top nav as "Create". | Either gate professor routes like admin, or accept it as intentional and fix the *inconsistency* with admin. | `/profile` renders role `Student`; `/professor/lecture/126bb3c8-…` renders the editor; `read_page` on `/library` lists `link [ref_9] href="/professor/courses"` in the header nav. **Repo confirms this is deliberate:** A §6 records `/professor/courses`, `/professor/courses/:id`, `/professor/upload`, `/professor/lecture/:id` and `/professor/upload/batch/:id/review` carry `allowedRoles: [professor, student]` while `/professor/dashboard`, `/archive` and `/analytics` are professor-only — *"Student access to professor upload/course routes is intentional (student course creation), but the split needs confirming as deliberate rather than drift."* So this reduces to a **UI-consistency** finding; M17 is the actual security question. | B 7.2 = C 2.2.1 (+ A §6 as the repo-side explanation) |
| **M19** | 🟠 | `/exam/:courseId` (prod) | The 404 is swallowed — pick a question count, click START EXAM, nothing happens. No toast, no inline error, no disabled state, no spinner. | Surface the failure, or don't offer the control. | 10 s post-click: `location.href` unchanged, visible text still the config screen (`QUESTIONS / 20 / 30 / 40 / START EXAM`); `window.onerror` and `unhandledrejection` listeners captured **0** page-level errors. Only trace is the console line in M9. **Same defect class as M11** (silent swallowed rejection on a primary CTA), different code path. | B 4.2 = C 2.4.2 |
| **M20** | 🟠 | `/settings` → Data & Privacy | The Art. 20 export is assembled **client-side from 4 tables** and omits other user-keyed tables. | Cover all personal data held; better, move assembly server-side so the table list can't drift from the schema. | Export read exactly `profiles`, `student_progress`, `learning_events`, `achievements`. Observed elsewhere in the same session filtered by `user_id=eq.a3261aae-41c0-4e26-890b-8906a17a33f1` and **not** exported: `notifications`, `course_visits`, `user_roles`. Also absent: My Materials, `/api/v1/upload/jobs`, friends data (`rpc/get_friend_suggestions`), quiz answers. Export builds a **42,131-byte** `application/json` blob downloaded as `learnstation-data-2026-08-17.json`. **⚠️ Tension with A** — A §1 marks GDPR §6 "Verified as OK": access/erasure/JSON export *"all three genuinely exist and are unit + integration tested (`Settings.tsx:635,665`, `backend/services/account_service.py`, `test_gdpr_erasure_cascade.py`)"*. A verified *existence*; B/C verified *completeness*. See §B3. | B 5.1 = C 2.5.1 (vs A §1 "Verified as OK") |
| **M21** | 🟠 | `/lecture/:id` — URL state (prod) | `?slide=` is inert **both ways**: advancing never updates the URL; loading `?slide=N` ignores N. The app emits these links itself from the dashboard. | Make the param authoritative, or stop emitting it. | Write: clicked `Continue`, player advanced to `SLIDE 7 / 54`, `location.href` stayed `…?slide=6`. Read: `?slide=6` → SLIDE 7/54; `?slide=20` → SLIDE 7/54; `?slide=1` → SLIDE 7/54; no param → SLIDE 1/54. Dashboard emits `/lecture/126bb3c8-6f69-4184-9ceb-9ccbfd4b3609?slide=6`. | B 3.2 = C 2.3.2 |
| **M22** | 🟠 | `/lecture/:id` — PDF fetch (prod) | First request for the lecture PDF returns **503**; retry succeeds. First slide paint takes ~18 s behind a bare spinner. | Succeed first time, or fail visibly with a retry affordance. | `storage/v1/object/sign/lecture-pdfs/lectures/126bb3c8…/01 DBS Basics.pdf` — req 1 **503**, req 2 **200**, req 3 (fresh token) **200**. At t+8 s the pane is a spinner with `img` count 0; slide rendered at t+18 s. | B 3.3 = C 2.3.3 |
| **M23** | 🟠 | `/lecture/:id` — responsive (prod) | Third comprehension-check answer is 61 % clipped and its label unreadable at ≤1054 px. | All three answers fully visible at supported widths. | Viewport 1054: `❌Confused` spans x 457→**596**; nearest clipping ancestor `div.glass-card.overflow-hidden` ends at x **511** → **85 px of 140 hidden**. `✅Got it` (310) and `🤔Unsure` (445) are inside. At 1534 px: ends 726 vs clip 751 → **0 px cut**. Responsive-only. | B 3.4 = C 2.3.4 |
| **M24** | 🟠 | Global header (prod, student shell) | `button[aria-label="Open account menu"]` is **53.7 % unclickable**; its centre navigates to `/dashboard`. | The control's own box should take its own clicks. | Button box `l=90 t=12 w=146 h=60`; `a[href="/dashboard"]` box `l=108 t=24 w=97 h=36` sits entirely inside it. 980-point hit-test grid: **46.3 % reachable, 53.7 % stolen** — 362 pts by `a[/dashboard]`, 98 by `a[/library]`, 44 by `NAV`, 16 by `HEADER`, 6 by a `DIV`. `elementFromPoint(163,42)` → span whose `closest('a')` is `/dashboard`, `hitIsSelfOrChild: false`. Encountered accidentally: a click intended for the account menu navigated Home. Header is global, so visible on every screen. **Not present in the professor shell** at 1534 px — header leaf-overlap scan returned 0 overlaps. | B 1.3 = C 2.1.3 (+ D §3 scope-limit) |
| **M25** | 🟠 | `/dashboard` — mobile (prod) | At mobile width the "3 people to meet" nudge paints over the greeting and the `h1`. | Stack, don't overlap. | Viewport 406×693. Nudge `t=80 l=130 w=244 h=54`, `position: static`, `z-index: auto`. Greeting `t=87 l=24 w=230`; `h1` `t=120 l=24 w=350 h=86`. Rect intersections: nudge×`h1` = **244×14 px**, nudge×greeting = **124×13 px**. | B 1.4 = C 2.1.4 |
| **M26** | 🟠 | Landing page (`/`) | Console warning on every load: *"Please ensure that the container has a non-static position, like 'relative', 'fixed', or 'absolute' to ensure scroll offset is calculated correctly."* — framer-motion's `useScroll` in `Landing.tsx` measures against a `position: static` container, so its scroll offsets are wrong. | Add `relative` to the scroll container passed to `useScroll`. | Console, `localhost:5173`. Note A originally called this *"the likely cause of 2.1"* — but 2.1 is retracted (§B1), so this stands on its own as a real warning with wrong scroll offsets, not as a fix for a phantom. | A §2.2 |
| **M27** | 🟠 | Landing footer | All 13 footer links are dead (`href="#"`): Features, Security, Enterprise, Documentation, API Reference, Community, Blog, About, Careers, Contact, Privacy, Twitter, GitHub. | Wire the ones that exist (Privacy → `/datenschutz`, add Impressum); **remove** the 9 that don't — Enterprise/Careers/Blog/API Reference/Community signal a bigger company than there is, and dead links read as abandonment. | DOM query of `footer a` | A §2.3 (mechanism shared with M3) |
| **M28** | 🟠 | `nginx.conf` / `vite.config.ts` | Both carry **factually inverted comments**. `nginx.conf:26` says *"Proxy /api/\* to the backend, stripping the /api prefix. e.g. GET /api/upload/slides → http://api:8000/upload/slides"*. It does **not** strip: `proxy_pass $backend` uses a *variable*, which disables nginx's URI-rewrite, so the full `/api/v1/…` path is forwarded — which is what the backend needs. Behaviour correct; comments describe the opposite. | Fix both comments. **Live trap:** anyone who "corrects" nginx to match its own comment (adding a trailing slash to `proxy_pass`) takes **all of production** down instantly. | `nginx.conf:24-29`, `vite.config.ts:18-27`, route table introspection | A §3.2 |
| **M29** | 🟠 | Config / env | **Two `.env` files disagree about what the product is.** Root `.env` sets only `FEATURE_STUDY_GUIDE=1` (reads as "exam mode and review engine off"). `backend/.env` sets `FEATURE_REVIEW_ENGINE=1`, `FEATURE_EXAM_MODE=1`, `FEATURE_STUDENT_UPLOADS=1`, `FEATURE_STUDY_GUIDE=1`. Backend loads the latter, so those features **are** live locally. A initially misdiagnosed this and had to introspect the running app to get the truth. | One source of truth; document precedence. If a human auditing the config gets the wrong answer, so will the next deploy. | `grep FEATURE backend/.env`; live `settings.feature_*` introspection. **This is almost certainly the root of M9** — see §C1. | A §4.1 |
| **M30** | 🟠 | `/onboarding` step 1 — a11y | The name input has **no `<label>` and no `aria-label`**. A screen-reader user hears only "edit text". The placeholder ("Enter your name…") is not an accessible name and disappears on input. | A real label or `aria-label`. This is the very first interaction in the product, so it's the worst place to fail a11y. | `document.querySelector('input')` → `hasLabel: false, ariaLabel: null` | A §8.2.1 |
| **M31** | 🟠 | `/onboarding` step 5 | **Step 5 is a dead step for almost everyone.** "Add extra topics" renders *"No public courses available right now."* Cause: `Onboarding.tsx:240` hard-filters the platform catalog to a single literal title — `c.title.trim().toLowerCase() === 'datenbanksysteme'`. Any other course is discarded, so unless that exact course is published the entire step is empty. | Drive it from an `is_public`/`is_ready` flag instead of a hardcoded German title. The filter silently breaks the moment that course is renamed. | Live step 5; source filter. **Cross-ref M36** — A's data layer shows 36 published courses exist, so the emptiness is purely the filter. | A §8.3.1 |
| **M32** | 🟠 | `/onboarding/start` (ActivationOnboarding) | **Stale product name, hardcoded and untranslated.** `ActivationOnboarding.tsx:110` renders the literal string **"Ascend Academy"** — the old name — as the eyebrow badge on the first post-onboarding screen. Not in any locale file, so it stays English in the German UI. | Change to Learnstation *and* move it into `onboarding.json` (EN + DE) so the i18n parity gate covers it. | Live screen; `grep -rn "Ascend Academy" src/` → **1 hit** (only occurrence left, so one-line fix) | A §8.3.2 |
| **M33** | 🟠 | Queue backpressure — copy | With no arq worker running, Redis had **159 orphaned jobs** against `ARQ_MAX_QUEUE_DEPTH=50`. Every upload was rejected — permanently — with *"The processing queue is busy right now. **Please retry in a few minutes.**"* Nothing drains, so retrying never helps. The copy asserts a transient condition for what is actually a dead-worker outage. | Distinguish the two: if depth is over the limit **and** not decreasing (or no worker heartbeat), say so honestly and alert — don't tell users to wait. | `queue_depth()` = 159 vs max 50; 0 after starting the worker (drained 159 → 0 in ~20 s, so the backpressure logic itself is fine — only the diagnosis is missing). The 429 itself was the auditor's own environment, **not** a product bug. | A §8.6.1 |
| **M34** | 🟠 | `/health/ready` | Readiness probe does not appear to reflect a non-draining queue, so this state is invisible to monitoring. In production a silently dead worker means uploads are 100 % broken while health checks stay green. | Include queue-drain health (depth trend or worker heartbeat) in the readiness probe, and alert on it. | Source review + observed behaviour. **Directly explains M16**: two professor PDFs stuck ≥15 min in prod with `error: null` and nothing alerting. | A §8.6.2 (mechanism for M16) |
| **M35** | 🟠 ✅ **FIXED 2026-08-17** (residual open) | Slide-synthesis batching (`backend/services/ai/orchestrator.py`) | The batched slide-synthesis path **failed 100 % of the time**, silently costing ~5× more. `json_mode=True` forces a top-level JSON *object*, so the model returns `{"slides":[…]}`; the code did `if isinstance(parsed, dict): parsed = [parsed]` — wrapping the **envelope**, not the items — producing a one-item list with no `page_number`, so `page_to_idx` matched nothing and the function raised. **Dead by construction** from the moment JSON mode was enabled; the fallback masked it completely. Second site with the identical bug: `_regenerate_failing_slide_quizzes` (`orchestrator.py:1729`). | ✅ New shared `as_slide_item_list()` helper unwraps known envelope keys (`slides`/`items`/`results`/`data`/`output`), falls back to a sole list-valued entry for provider drift, still treats a genuinely slide-shaped dict as one slide; applied at **both** call sites. **Still open:** a 100 %-failure optimisation should emit a metric and alert — right now the fallback is only a log line, so the next regression of this kind is equally invisible. | Worker log on a real 10-slide ingestion: *"Batch response yielded zero usable items for 8 active slides; raising for per-slide retry."* / *"Batch synthesis failed for 8 slide(s) starting at index 0 (batch_analyze_text_slides: unusable JSON response) — falling back to per-slide synthesis"*, repeated for indices 8–9. **~5× the LLM calls, latency and spend on the hottest path** — 2 intended requests became 10. Fix verified against the live model (the diagnostic that raised `ValueError: unusable JSON response` with 0 items now returns 2 items correctly mapped, `index 0 → page 1`, `index 1 → page 2`) + 15 unit tests in `backend/tests/unit/test_batch_response_envelope.py`; related suites (`test_overlapping_batches`, `test_slide_synth_service`, `test_unified_orchestrator`) still pass — 83 tests. ⚠️ A records that its **first** diagnosis was wrong (*"doesn't pass `response_format`"* — it does, `json_mode=True` at `orchestrator.py:1615`). | A §8.7 |
| **M36** | 🟠 | Data layer — course discovery | **Course discovery is 83 % noise, and it's live.** Every authenticated student sees `courses` where `status='published' AND is_archived=false`. The endpoint is implemented correctly (RLS-as-boundary, explicit filter, rate-limited) — this is a **data** problem, not a code one. | Unpublish the fixtures and empty shells before launch; de-duplicate. Longer term `status='published'` should require ≥1 lecture so an empty course cannot reach the catalog at all. | 36 published non-archived courses; **20 (56 %) have zero lectures**; **16 (44 %) are obvious dev/test fixtures**; 3 duplicated titles; **only 6 (17 %) are genuinely named *and* contain content**. Public fixtures include `testcourse`, `E2E Integration Course`, `Cache Invalidation Proof` 1 & 2, `Clean Verification Course` 1 & 2, `My Uploaded Biology 101`, `My Uploaded Database Course`, `Last Testing upload`, `Test`, and **five** copies of `My AI Generated Course` plus a truncated `My AI Gener`. `Systemsoftware und Rechnerkommunikation` appears **three times** (16 lectures, 1 lecture, 0 lectures). Query: `select … from courses where status='published' and is_archived=false` (36 rows, listed in full during the audit); filter at `backend/api/v1/courses.py:329`. **Same Supabase project prod uses (`lkiiideqjoiksnycgplc`)** → applies to prod verbatim. | A §9.1 |
| **M37** | 🟠 | Data layer — SRS review cards | **38 % of lectures with quiz questions have zero review cards** — the retention loop silently has nothing to serve. `review_cards` is keyed per *lecture* (`lecture_id`, `concept_id`, `source_type`, `source_id`, `content_hash`) with **no `user_id`** (per-user state lives in `review_schedule`), so any lecture with quiz questions should have cards regardless of enrolment. | (1) Run `backend/scripts/backfill_review_cards.py` to close the current 43; (2) reschedule instead of no-op'ing when the lock is missed; (3) add a monitored invariant *"every lecture with quiz questions has ≥1 review card"*. | 114 lectures with quiz questions; 71 have cards; **43 (38 %) have zero**. Of those 43: 9 in a course a student is enrolled in, 5 owned by a student. **Not age-related** — `Differential Cryptanalysis` created **2026-08-17** with 7 quiz questions and 0 cards. Generator code is fine: its exact query run read-only against the newest affected lecture returns **7 rows**, so `_generate_quiz_cards` (`card_factory.py:63`) would happily create cards. Contributing weakness: on a missed Redis lock `card_factory.py:115` returns `{"quiz_cards": 0}` and never reschedules, so a duplicate enqueue can consume the only attempt. **Corroborated in prod:** B and C both found `/review` with **0 cards due** on a 13-lecture account. | A §9.2 (+ prod symptom B §"/review", C §2.6) |
| **M38** | 🟡 | Course titles across surfaces | One course renders under **two different names** depending on the view; the split is **per-component, not per-page** — five surfaces, two naming schemes. Only the card list translates. | One canonical title, or translate consistently. Removing the card-list translation is the smaller change. | **English:** `/professor/courses` card headings ("Database Systems", "System Software and Computer Communication", "Advanced Topics in Cryptography", "SWT"); professor dashboard hero Course dropdown. **German (stored value):** `/professor/upload` Course dropdown ("Datenbanksysteme", "Systemsoftware und Rechnerkommunikation"); Edit-course modal `Title` field; lecture editor → Lecture tab → Course dropdown. Same account, same session, ~3 min apart — **3 of 4 surfaces show the German stored title; only the card list translates.** **Root cause of the student-side confusion** where the dashboard said "Datenbanksysteme" and the library said "Database Systems". | D P4 + E N7 |
| **M39** | 🟡 | Lecture counts across surfaces | Lecture counts for "System Software and Computer Communication" disagree across **three** surfaces. | One count. | Student Discover drawer → **16 LECTURES**; student course view → **0/0 LECTURES, "No lectures in this course yet."**; professor course manager → **1 lecture**. **⚠️ Likely explained by M36, not by an aggregation bug:** A's data-layer query found `Systemsoftware und Rechnerkommunikation` appears **three times** in `courses` with exactly **16 lectures, 1 lecture, and 0 lectures**. These are almost certainly three distinct duplicate course rows, not one course counted three ways. **Verify this before scheduling any roll-up fix.** | B 2.4 + D P5 (+ A §9.1 as the probable explanation) |
| **M40** | 🟡 | Course progress roll-up | Course aggregate progress reads 0 % while its own lecture cards report non-zero. | Roll up lectures into the course aggregate. | `/library` header for Database Systems: `NEW`, `0/10 LECTURES · 0%`. Same view, `read_page` accessible names: `button "Introduction. 2% complete."`, `button "Basics. 9% complete."`. | B 2.3 = C 2.2.4 |
| **M41** | 🟡 | Enrolled-course count | Enrolled-course count disagrees across three surfaces. | One number. | `/profile` "Enrolled courses" lists **2** (Datenbanksysteme, Intro to Linear Algebra). Dashboard course rail shows **3** (adds V101). `/library` → Discover drawer renders **20** cards, every one a disabled `Enrolled` badge (`Enroll` variants: 0). | C 2.6.1 (B carries it forward in fix-session I as "the profile 2-vs-3 enrolment count") |
| **M42** | 🟡 | Breadcrumbs (student **and** professor) | Breadcrumbs print the raw UUID with hyphens rendered as spaces. | Show the title, which the page already renders directly below. | **Student:** `Home > Course > 49344e75 ef73 41e3 939e e42965909925` while the body renders `COURSE PATHWAY / V101` — on `/course/:id`, `/exam/:courseId`, `/course/:id/study-guide` and `/course-v3/:id`. **Professor:** `Home > Lecture > 126bb3c8 6f69 4184 9ceb 9ccbfd4b3609` while the page header reads "Basics" — same on `/professor/analytics/:id` and `/advanced`. Same component. | B 2.2 = C 2.2.3 + D P6 |
| **M43** | 🟡 | `/library` → `/course/:id` | `/course/:id` works but is completely unlinked. | Course cards should link to it. | Full-DOM href scan on `/dashboard`: route hrefs are `/dashboard`, `/library`, `/ascent`, `/leaderboard`, `/friends`, `/professor/courses`, `/settings`, `/lecture/126bb3c8…?slide=6`, `/lecture/6d2b028b…?slide=2`. **Zero `/course/:id` hrefs**; only 2 UUIDs in the whole document, both lecture ids. Deep-linking `/course/49344e75-ef73-41e3-939e-e42965909925` (id from `localStorage.ascend_last_opened_course`) renders correctly. | B 2.1 = C 2.2.2 |
| **M44** | 🟡 | Global header (prod) | Two `Home` controls — a `BUTTON` and an `A` — overlap in the header. | One Home affordance. | Header leaf-node overlap scan: `BUTTON:Home` × `A:Home` overlap **24 px** on x; `BUTTON:Home` × `svg` 12 px; `svg` × `A:Home` 16 px. At 1054 px the `50 XP` label also overlaps `Home` by **30×16 px**. Same collision visible on the 404 page and everywhere else. | B 1.5 = C 2.1.5 |
| **M45** | 🟡 | `/dashboard` — ai-tutor-invite card | The `div.ai-tutor-invite` "Ready to explore? / Upload your first lecture PDF" card looks like a CTA but is not actionable — decoration shaped like a call to action. | Make it navigate to the upload flow, or render as plain copy. | On the card: `querySelectorAll('a,button')` → **0 descendants**; `cursor: "auto"`; `role: null`; `tabIndex: null`; no `__reactProps.onClick`; `closest('a,button')` on its parent → `null`; parent `cursor: auto`. **Copy is correct** — `/materials` confirms 0 student uploads, so "your first" is accurate; the defect is purely the missing click target. | B 1.6 = C 2.1.6 |
| **M46** | 🟡 | `/settings` + `/ascent` — tab switching | Some tab switches need a second click — the first highlights the tab but leaves the old pane rendered. **Seen twice.** | One click switches. | Data & Privacy: first click on `button "Data & Privacy"` highlighted the tab but the pane heading was still `Personal Information` and `General` remained active; a second click at (310,416) switched it. Mind Map (§6): ref-click didn't switch, coordinate-click did. **Security and Preferences switched on first click**, so intermittent, not universal. Suspected same click-interception family as M24. **Low confidence on mechanism** — C recommends a targeted retest before fixing. | B 5.2 = C 2.5.2 |
| **M47** | 🟡 | `/ascent` → Mind Map | Mind Map defaults to a 3D WebGL view unavailable in this browser; the fallback message names a "2D tree" but exposes no visible switch control on that pane. | In-pane 2D toggle, or auto-default to 2D when WebGL is absent. | Message: *"3D view unavailable — Your browser or device doesn't support WebGL. Switch back to the 2D tree to explore the map."* The 2D equivalent exists as the separate **Skill Tree** sub-view (SVG, renders fully), but the Mind Map pane itself offers no button to reach it. | B 6.1 |
| **M48** | 🟡 | `/professor/dashboard` hero | Hero features a lecture with **0 slides** and labels it "ACTIVE PROTOCOL", with a `View Analytics` primary CTA — analytics for a lecture with no slides. | Don't headline an empty lecture, or mark it as a draft needing content. | Hero: "Post-Quantum Cryptography · ACTIVE PROTOCOL · **SLIDES 0** · CREATED 02/08/2026", course "Advanced Topics in Cryptography". | D P7 |
| **M49** | 🟡 | Professor — Pipeline Diagnostics | Expands to a **table with only a header row** — no data, no empty state. Copy claims "Routing telemetry for the most recent parse of this PDF" for a lecture whose PDF is attached and parsed. | Render "no telemetry for this parse" or hide the panel. | Expanded panel shows `# / Route / Reason / Words / Img cov / Alpha` and zero rows; `[...table.querySelectorAll('tr')]` returns only the header. Lecture's PDF is `01 DBS Basics.pdf`. | D P8 |
| **M50** | 🟡 | Professor — destructive controls | Destructive controls sit immediately beside primary actions with no separation. | Separate destructive actions, or require confirmation. | Dashboard hero: red trash icon **adjacent** to the `View Analytics` CTA (icon row: eye / gear / trash). Slide Editor: red trash icon in the same control row as `View Original / Preview / Insert After`. **Not clicked — confirmation behaviour unverified.** Combined with M5 (click interception near the header) the blast radius is real. | D P9 |
| **M51** | 🟡 | `/professor/upload/batch/:id/review` | Three lectures in one batch carry the **identical title**, making the review cards indistinguishable. | Disambiguate by source filename, slide count, or index. | Heading-frequency scan of the batch page: `"Advanced Topics in Cryptography"` × **3**, against 11 distinct titles for 12 cards. Two of them differ only by body stats (44 slides/5 quiz questions vs 79 slides/6 quiz questions). Also confusable with a fourth, `"Advanced Topics in Cryptology"`. | E N6 |
| **M52** | 🟡 | Professor lecture editor — mobile | The editor **does not collapse on mobile** — the two-pane layout is retained and the editor pane becomes unusable. | Collapse to one pane with a slide-list drawer below `md`. | At a 390 px window (viewport 406×656): the slide sidebar keeps `SLIDES (54)` plus full-size thumbnails, leaving roughly 130 px for the editor. Screenshot: Slide Title value clipped to **"Datal"**, completeness label clipped to **"complet"**, "Slide Editor" wrapping onto three lines. `documentElement.scrollWidth` 485 vs viewport 406 (clamped by `body{overflow-x:hidden}` — the sideways-scroll half is explicitly **not** filed). | E N8 |
| **M53** | 🟡 | `/course-v3/:id` | Renders a semester-organized course browser with a large blank mid-region between the top rail and the lecture cards. | Fill or remove the dead vertical space. | Screenshot: ~400 px of empty viewport between the semester chips and "V101 · 2 LECTURES". Renders otherwise; carries the same UUID breadcrumb as M42. | B 9.1 |
| **M54** | 🟡 | API contract | **Two API path conventions coexist.** Backend mounts everything under `/api/v1`. The frontend has **44 call sites on legacy un-versioned paths** (`/api/upload/parse`, `/api/ai/generate`, `/api/auth/export-data`, `/api/assignments`, …) and only **23** on `/api/v1/…`. The legacy ones survive purely via a **307 redirect** shim. | Pick one. Every legacy call pays an extra network round-trip, and the shim is invisible load-bearing infrastructure — if anyone removes it, 44 call sites break at once. Migrate the frontend to `/api/v1`, keep the shim only for cached clients. | `curl` probes returning 307 (`/api/health` → `/api/v1/health`, verified); `grep` counts over `src/`. **67 call sites total — A explicitly says do NOT bundle this with a quick win (~3 h, medium risk).** | A §3.1 |
| **M55** | 🟡 | API docs | `/docs`, `/redoc` and `/openapi.json` all return **404** on the local dev server. | Correct and desirable for production, but confirm it's an explicit env-gated decision and that **dev** keeps docs on — otherwise every developer loses the API explorer, which is likely why M54 drifted in the first place. | `curl` → 404 on all three (local). **Corroborated in prod:** B and C both independently found `/openapi.json`, `/api/v1/openapi.json` and `/api/openapi.json` **not exposed**, which is why neither could introspect the route list and had to infer M9 from live status codes. | A §3.3 (+ prod confirmation B §4, C §intro) |
| **M56** | 🟡 | Feature flags — global search | `VITE_FEATURE_GLOBAL_SEARCH` is absent from both `.env` and `.env.example`, so it defaults off — silently disabling a *fully built* feature: the top-bar search button, the ⌘K / `/` hotkeys, the whole `CommandPalette` component, and the in-course search UI. Backend `FEATURE_GLOBAL_SEARCH` is also off (`/api/v1/search` → **not mounted**, verified). | Decide: ship it (add `VITE_FEATURE_GLOBAL_SEARCH=1` + `FEATURE_GLOBAL_SEARCH=1` to `.env` *and* `.env.example`, both halves) or delete the feature. | `featureFlags.ts:9`; live route table shows `search` NOT MOUNTED. **Confirmed in prod:** B and C both list "No ⌘K palette" under *explicitly NOT defects* — *"Expected — `FEATURE_GLOBAL_SEARCH` off, already logged as 4.2 in the prior report."* | A §4.2 (+ B §10, C §2.7 confirming prod parity) |
| **M57** | 🟡 | Dead code | `src/components/AppSidebar.tsx` is **imported nowhere**. Worse, its nav list is stale (student items: dashboard/ascent/leaderboard/settings — missing library, materials, friends), so it actively misleads anyone reading it to understand navigation. | Delete. | Import search across `src/` | A §5.1 |
| **M58** | 🟡 | Dead routes | `/insights` and `/achievements` are pure `<Navigate>` redirects to `/ascent`, but live code still links to the **legacy** path: `StudentDashboard.tsx:506,510` and `NudgeBanner.tsx:27`. `src/pages/Insights.tsx` still exists but is no longer routed. | Point those three links at `/ascent`; delete `Insights.tsx`; keep the redirects only for external bookmarks. | Route map | A §5.2 |
| **M59** | 🟡 | Repo root hygiene | ~15 loose one-off scripts at repo root (`fix_lectures.py`, `apply_policies.py`, `revert_policies.py`, `get_policies.py`, `check_schema.py`, `restore_courses.py`, `test_debug.py`, `fix_cache_and_rebuild.ps1`, `start_manual.ps1`, …) plus `policies.txt` and `test_rls.sql`. | Move to `scripts/` or delete. Root-level `fix_*.py` / `revert_*.py` scripts that touch DB policies are a footgun sitting in the open. | `ls` | A §5.4 |
| **M60** | 🟡 | `/onboarding` step 1 | **No `maxLength`** on the name field (`maxLength: -1`). A user can paste an arbitrarily long string as their display name, which then flows into the leaderboard, friends list and profile chip. | Cap it (e.g. 60 chars) client-side **and** validate server-side — client-only limits are trivially bypassed. Also check the DB column is bounded. | DOM property read | A §8.2.2 |
| **M61** | 🟡 | `/onboarding` — persistence | **No draft persistence.** All five steps live in `useState` with nothing written until the final submit, so any reload mid-onboarding drops the user back to the cold-open having lost name, avatar, university, department, programme and course selections. | Persist per-step to `localStorage`, or write incrementally. Five steps of academic setup is far too much to re-enter. | Observed twice live — the auditor lost a fully filled step 3 to an unrelated page reload | A §8.3.3 |
| **M62** | 🟡 | `/onboarding` step 3 — perf | **443 university options mounted at once** in the picker — no virtualization. Heaviest DOM on the flow, on the critical path for every new user. | Virtualize the list, or cap rendered results until the user types. | `document.querySelectorAll('[role=option]').length === 443` | A §8.3.4 |
| **M63** | 🟡 | Test suite | **Flaky test.** `Onboarding > completes the full 5-step flow for a user with catalog` failed once out of 5 runs while the machine was loaded (4393 ms vs its usual ~2000 ms), then passed 3/3 on re-run. Pre-existing — unrelated to the M10 fix. | Find the unawaited assertion and give it an explicit `waitFor`. A test that fails under load is worse than no test: it trains the team to re-run CI instead of reading it. | 5 runs of the suite, one intermittent failure | A §8.2.5 |
| **M64** | 🟡 | Typecheck gate | **`tsc -p tsconfig.app.json --noEmit` is already red — it cannot gate anything.** 18 pre-existing errors across 11 files on a clean tree; most are the same framer-motion `Variants` shape (`{ transition: { type: string … } }` not assignable — `type` widens to `string` instead of the literal `"spring"`) in `Onboarding.tsx` ×3, `BentoGrid.tsx` and others; the rest in `src/__tests__/pixi/*` and `NudgeBanner.test.tsx`. | Add a **session S0** ahead of everything: fix the 18 (most are one `as const` on the transition objects) so typecheck goes green and can be enforced in CI. Until then "does it typecheck?" means "diff the error list before and after", which nobody does reliably. | Clean-tree run. ⚠️ Compounding traps A records separately: **`tsc -p tsconfig.json` checks nothing** — you must use `tsconfig.app.json`; and CI (`.github/workflows/ci.yml`) triggers on `pull_request` and `push: branches: [main]` **only**, so pushing a feature branch runs **nothing**. | A §7.3 |
| **M65** | 🟡 | Upload size limits | **Edge and app size limits disagree.** `nginx.conf:54` sets `client_max_body_size 100M`, but the app rejects anything over `MAX_UPLOAD_MB` (default **50**) in `validate_pdf_content`. So a 60–100 MB upload is accepted by nginx, streamed all the way to the backend, buffered, and *then* rejected. | Set nginx to just above the app limit (~51M) so oversized files are refused at the edge. This repo has already had a Supabase egress overage; paying full ingress for a request you're going to reject is the same class of waste. | `nginx.conf:54` vs `backend/core/config.py:87` | A §8.4.1 |
| **M66** | 🟡 | `/datenschutz` | Says *"Last updated: March 2026"* — 5 months stale, and it predates the LiteLLM migration that invalidated §4 (M1). | Bump on every substantive change; make the date the real thing that gates review. | Live page text | A §1.4 |
| **M67** | 🔵 | `/onboarding` step 1 | The single input on the step is **not autofocused**. | Autofocus it. On a one-field step it's free UX. | `document.activeElement !== input` | A §8.2.3 |
| **M68** | 🔵 | `/onboarding` — journey map | Journey map ("You → Avatar → Studies → Courses → Explore") is horizontally off-centre — spans x 717→1249 in a 1476 px viewport, centred ~983 rather than ~738, leaving a visibly empty left third. | Centre the map, or make the two-column split intentional and balanced. | Screenshot measurement | A §8.2.4 |
| **M69** | 🔵 | `/onboarding` step 3 | The university picker's popover opens **upward over the journey map and the "Your studies" heading**, hiding the user's progress context while they choose. | Constrain placement to below the trigger. | Screenshot | A §8.3.5 |
| **M70** | 🔵 | `/onboarding` — reveal montage | Two tiles both read **"3 courses"** — one "Semester 1 set up", one "Picked for you". Given step 5 surfaced *no* public courses (M31), the "picked for you" count looks like it's re-counting the curriculum courses. | Verify the recommendation count is a distinct number; if it isn't, drop the tile rather than showing the same 3 twice. | Screenshot of montage | A §8.3.6 |
| **M71** | 🔵 | Greeting copy | Greeting uses the first token of the display name — "Test" from "Test Student". Fine for `Firstname Lastname`, but mononyms and names with particles will read oddly. | Low priority; note only. | **Weak evidence — A's evidence column reads only "Live".** | A §8.3.7 |
| **M72** | 🔵 | Branding consistency | Three different brand marks across three pages: landing header uses a cyan/blue layers glyph, `/auth` uses the layers glyph in a **purple** circle, `/impressum` uses a **graduation-cap** glyph. The EN/DE toggle is also styled differently on `/impressum`. | One logo component, one toggle component. | Screenshots of `/`, `/auth`, `/impressum` | A §2.4 |
| **M73** | 🔵 | `/auth` | Password field's placeholder is `••••••••`, which renders as though the field is already filled. | Empty placeholder, or a real hint. | Screenshot of `/auth` | A §2.5 |
| **M74** | 🔵 | Professor shell — gamification | The professor shell renders student gamification: `Lvl 1 · 50 XP` next to the "Professor" identity, on every professor route. | Hide XP/level for professor accounts, or explain what it means for them. | Header on every professor route: "Professor / Lvl 1 · 50 XP". (This coincidentally matched the student account's own "Lvl 1 · 50 XP", which is what caused D's withdrawn misreading — see §B2.) | D P10 |
| **M75** | 🔵 | Student upload wizard | The wizard does **not** dedupe identical files client-side — the same PDF added twice produced two separate "Queued" rows. The backend is safe (content-hash dedupe returns the existing lecture without consuming quota), so this is cosmetic/confusing rather than harmful. | Dedupe by `(name, size, lastModified)` when building the queue. | Observed two identical rows live | A §8.6.3 |
| **M76** | 🔵 | `/onboarding/upload` wizard (prod) | A **single** dropped file appeared as **two** rows in the queue/process list. | One row per file. | Both rows read `AUDIT-TEST-ignore.pdf`. **Low confidence — B explicitly flags this as possibly an artifact of the synthetic drop** (dragenter/dragover/drop dispatched on a bubbling container); *"flagged for confirmation with a real drag-drop, not filed as certain."* Distinct from M75 (which is two *files* added with no dedupe); confirm with a real drag before treating as real. | B 8.2 |
| **M77** | 🔵 | File validation | **Magic-byte check is permissive**: `if b"%PDF" not in content[:1024]` — a substring search, so any file with `%PDF` anywhere in its first 1 KB passes. Real PDFs begin with `%PDF-` at byte 0. | `content.startswith(b"%PDF-")`, keeping a small tolerance for BOM/whitespace if you've actually seen such files. Defence-in-depth, not a live hole — the extension gate (`.pdf`/`.pptx`) runs first. | `backend/core/file_validation.py:23` | A §8.4.2 |
| **M78** | 🔵 | CORS config | Startup log: `CORS allowed origins: ['https://learnstation.duckdns.org', 'https://195-201-221-137.sslip.io']` — no localhost. | Harmless today because Vite proxies same-origin, so no cross-origin request is ever made. But any future direct-to-`:8000` call from the browser will fail CORS with a confusing error. Add localhost in dev only. | Backend startup log | A §3.4 |
| **M79** | 🔵 | Config | `VITE_AUTH_URL="http://localhost:4000"` is in `.env`, but **nothing listens on port 4000** and the variable is referenced **nowhere** in `src/` or `backend/`. | **Remove.** Dead config that implies a separate auth service exists. | `grep -rn VITE_AUTH_URL src/ backend/` → no hits; `lsof :4000` → nothing | A §4.3 |
| **M80** | 🔵 | Build toolchain | Vite warns on every start: *"browsers data (caniuse-lite) is 14 months old"* — autoprefixing decisions are being made against a stale browser matrix. | `npx update-browserslist-db@latest` | Dev server log | A §4.4 |
| **M81** | 🔵 | `/datenschutz` §4 | Hedges: Supabase data *"is stored on EU servers (depending on project configuration)"*. "Depending on configuration" is not a lawful disclosure — the user cannot tell what applies to them. | State the actual region of project `lkiiideqjoiksnycgplc` definitively. | Live page text | A §1.5 |

### Explicitly NOT findings

Recorded so nobody re-audits them.

| Claim | Why rejected | Source |
|---|---|---|
| `/pixi-lab` and `/professor/pipeline-test` are orphaned routes | Intentional dev-only unlinked labs (`import.meta.env.DEV`), self-documented. | A §5.3 |
| 124 px of horizontal overflow at mobile | `documentElement.scrollWidth` 530 vs `innerWidth` 406, but `body{overflow-x:hidden}` clamps it. `window.scrollTo(300, y)` leaves `scrollX` at **0**. Carousel children extend to x=1968 but sit inside an `overflow-x: auto` scroller. No unclipped overflowing element exists (`count: 0`). | B §10, C §2.7 |
| "Back to Dashboard" on `/course/:id` stuck at opacity 0 for 16 s | **Did not reproduce.** 3/3 clean loads read `opacity: 1` at t+8 s with `scrollY 0`. The 16-s reading came from a `setInterval` probe injected immediately after `navigate`, racing the entrance animation. | B §10, C §2.7 |
| Main content at effective opacity 0 on `/materials`, `/ascent`, `/leaderboard` (a systemic M7) | **Measurement artifact.** The app animates opacity on the compositor, so `getComputedStyle().opacity` returns the *base* value, not what is painted. Proof: the `Feedback` button reported `opacity: 0` while plainly visible in the same screenshot; `html`/`body`/`#root` all `opacity: 1`. Screenshots show both pages fully rendered. **Do not trust computed opacity in this codebase.** | B §10, C §2.7 |
| All 20 Discover courses show a disabled `Enrolled` badge | Cannot be called wrong without a second account to compare against. (But see M36 — the catalog is mostly fixtures.) | B §10, C §2.7 |
| Dashboard hero `Continue` "does nothing" when clicked | Button was healthy on re-inspection (`hasReactClick: true`, `hitIsSelf: true`, `pointerEvents: auto`, not disabled); the earlier failure is explained by a stale element ref plus the constant re-rendering from M6. | B §10, C §2.7 |
| No ⌘K palette | Expected — `FEATURE_GLOBAL_SEARCH` off (M56). | B §10, C §2.7 |
| Professor "Quiz Suggestions" empty states contradict the student's "0/16" quiz count | Not a contradiction — "suggested quiz" is a *draft* concept distinct from the published quizzes the student player counts. | D §3 |
| `/admin/dashboard` is ungated | **Correctly gated** — navigating there as a non-admin redirects to `/dashboard`. Verified twice. | B 7.1, D §3 |
| Professor editor `scrollWidth` 485 vs viewport 406 is a horizontal-overflow bug | Clamped by `body{overflow-x:hidden}`; no sideways scroll. Explicitly not filed separately (the *layout* half is M52). | E N8 |
| `quiz_cards: 0` in the worker log proves card generation failed | **No** — `_insert_card` dedupes on `content_hash`, so 0 is the correct idempotent answer for an already-carded lecture. | A §9.2 |
| `useSound` can throw and abort an onboarding handler | **No** — it wraps every AudioContext call in try/catch, so `play()` cannot throw. | A §8.1b, §8.3 |
| "Double-clicking Next wedges the onboarding wizard" | **Wrong.** A single-click control run wedged identically. The variable was tab visibility (rAF throttling), not click count. | A §8.1b |
| 1000+ repeated `fetchProfile error` console entries are a separate defect | **No** — a symptom of M6 running while an access token was expired. Fixed with M6; 0 console errors on clean reload afterwards, where 6020 had accumulated. | this session |

---

## Part 3 — Contradictions between the source documents

### B1. 🔴 The retracted "invisible feature cards" finding — status: **no doc re-asserts it, but one carries a same-shaped claim**

A §2.1 retracts, in full:

> "I originally reported '2 of 6 feature cards are invisible': 'Secure Vault' and 'Universal Access' measured `opacity: 0` / `0.068` while fully in the viewport, and a screenshot showed a blank scroll-screen. **That measurement is not trustworthy.** Later in the audit I probed `requestAnimationFrame` in the same browser context and got **0 frames in 15 seconds** — rAF was fully throttled because the driving tab was backgrounded (in fact eventually closed). framer-motion drives reveal animations with rAF, so *any* reveal-animated element measures `opacity: 0` in that state, and a screenshot captures the same pre-animation paint. … **Reproduced independently 2026-08-18** in a second session against a different tab (`localhost:5173/dashboard`, `visibilityState: "hidden"`): the same 800 ms rAF probe never returned at all — CDP `Runtime.evaluate` timed out after **45 s** — while `computer screenshot` on that same frozen tab still painted a full, correct-looking page. **Two independent observations of the artifact; zero of the bug.**"

**No other doc asserts this landing-page finding.** It appears in none of B, C, D, E. ✅ The retraction stands unchallenged.

**However**, **M7** (B 1.2 = C 2.1.2, dashboard hero at `opacity: 0`) is the *same shape* of claim on a different surface, and it is filed 🔴 in both. This is a **tension, not a contradiction**, and both docs pre-empt it themselves. B §10 and C §2.7:

> "Main content invisible on `/materials`, `/ascent`, `/leaderboard` (a 'systemic 1.2') — **Measurement artifact.** This app animates opacity on the compositor, so `getComputedStyle().opacity` returns the base value, not what's painted — the `Feedback` button read `opacity:0` while plainly visible. Screenshots show those pages fully rendered. **Finding 1.2 survives only because it has independent visual + behavioural proof.** *Do not trust computed opacity in this codebase.*"

**Verdict.** M7's evidence is *not* the same as the retracted 2.1's. It has (a) a screenshot showing an empty hero region while `innerText` contains the text, (b) a behavioural fix (scroll down 3 + up 5 → `opacity 1`), (c) 4/4 reproduction on full reloads, (d) a settled state (`animationName:"none"`, `transform:"none"`, i.e. not mid-animation), and (e) a negative control — the professor shell hero renders visible (D §3). That clears the bar A's retraction sets.

**But the retraction's *rule* still binds.** Before anyone works on M7, run A §8.1b's mandatory pre-flight — `document.visibilityState === 'visible'`, `document.hasFocus() === true`, and an rAF probe returning **>20 frames per 800 ms**:

```js
(() => { window.__p={f:0,t:performance.now()};
  const l=()=>{window.__p.f++; if(performance.now()-window.__p.t<800) requestAnimationFrame(l);};
  requestAnimationFrame(l);
  return {vis:document.visibilityState, focus:document.hasFocus()}; })()
// ...wait ~1s, then: window.__p.f
```

A is explicit that **screenshots do not protect you** — a throttled tab paints its pre-animation state, so a screenshot of "missing" content looks exactly like a genuine rendering bug. And A §7.2 S2 gives the same instruction from the other direction: *"Verify — do not trust the screenshot."* Re-confirm visually in a genuinely foreground tab, never by `getComputedStyle`.

**Frequency disagreement between B and C on this same finding.** C 2.1.2 says the hero *"renders fully transparent **and stays that way**"* (4/4). B 1.2 softens it to *"**can** render fully transparent… **Intermittent but reproducible**… **Not universal** — it rendered *visible* on the initial load and when `/dashboard` was reached via redirect, so the trigger is a race in the scroll-reveal observer, not every load… Mechanism is confirmed; frequency is 'often on direct reload,' not 'always.'"* **B supersedes C; take B's characterisation.**

**One further update, post-M6 fix.** B's own fix plan predicted session A (the refetch storm) would *"likely also cure the 1.2 race and the stale-ref flakiness."* M6 is now fixed and verified, so **M7 must be re-measured against the fixed build before any code is written for it** — it may already be gone.

### B2. 🔴 Professor-persona-for-students — asserted in B, **withdrawn and contradicted** in D

**B 7.2** states: *"A **Student**-role account renders the full professor toolset with no client-side role gate: `/professor/courses` … and `/professor/lecture/:id` (the full editor — `Save Lecture`, `Add New Slide`, all 54 slides). Not redirected, unlike admin."* And, crucially: *"**Crucially unresolved:** every professor surface reachable was this account's **own** content (its 3 courses), and the account clearly authored those (via upload). So this may be by-design 'any user authors their own courses.'"*

**D's opening correction** withdraws the framing:

> "During the earlier student-session audit I observed a 'Professor' header while believing I was still on the student account, and inferred the app renders a professor persona for Students. **That inference is withdrawn** — you had already signed in as `prof@admin.com` at that point. What still stands from student finding 7.2 is narrower and was verified against a header reading 'Abdulah': the **student** session did load `/professor/courses` and the `/professor/lecture/:id` editor."

**And D P3 directly contradicts B 7.2's "own content only" clause:**

> "`abdul@test.com` (uid `a3261aae…`, role rendered **Student**) `/professor/courses` listed **the same course** [Database Systems], **same lecture count, same description**, also with Edit/Archive/Delete. The other courses **are** correctly scoped — the student's V101 and 'Intro to Linear Algebra (Student Notes)' do not appear for the professor, and the professor's Cryptography/SWT do not appear for the student — which makes the shared row anomalous rather than by design."

**Resolution.** D wins on both counts — later session, dual-account evidence, and an explicit self-correction. **B 7.2's reassuring "it was all their own content" is false**: one course was shared across two accounts. I have therefore split the thread into two findings:
- **M18** — client-side role-gating inconsistency (admin gated, professor not). **Benign per A §6**, which records the repo-side truth: those routes carry `allowedRoles: [professor, student]` deliberately, for student course creation. This is a UI-consistency issue.
- **M17** — one course manageable from two accounts. **This is the actual security question**, and it remains open because no mutation was ever issued (see §D2 of the main report).

**Note also M74 explains D's original misreading:** the professor shell renders `Lvl 1 · 50 XP`, identical to the student account's own `Lvl 1 · 50 XP`, which made the two sessions visually indistinguishable in the header. D says so itself: *"This coincidentally matched the student account's own 'Lvl 1 · 50 XP', which is what led me to misread the session earlier."*

### B3. 🟡 GDPR export: "verified OK" (A) vs "materially incomplete" (B/C)

**A §1**, closing note:

> "**Verified as OK (no action):** §6 promises data access, erasure and JSON export 'in the settings' — all three genuinely exist and are unit + integration tested (`Settings.tsx:635,665`, `backend/services/account_service.py`, `test_gdpr_erasure_cascade.py`). Good."

**B 5.1 / C 2.5.1:**

> "The Art. 20 export is assembled client-side from **4 tables** and omits other tables the app itself queries keyed to this user's `user_id`… During export the client read exactly: `profiles`, `student_progress`, `learning_events`, `achievements`. Observed elsewhere in the same session, filtered by `user_id=eq.a3261aae-41c0-4e26-890b-8906a17a33f1` and **not** in the export: `notifications`, `course_visits`, `user_roles`. Also absent: My Materials, `/api/v1/upload/jobs`, friends/friendship data (`rpc/get_friend_suggestions`), quiz answers."

**Resolution.** Not strictly incompatible — A verified *existence and test coverage*; B/C verified *completeness of the payload*, which A never checked. But **A's "no action / Good" is materially over-stated for a compliance-facing claim** and should be downgraded. Filed as **M20**, severity 🟠 per B/C.

Both sides do agree on one thing: **the deletion path is unverified end to end.** A cites `test_gdpr_erasure_cascade.py` as coverage; B and C both confirm the `Delete My Account` control exists with correct warning copy (*"Permanently delete your account and all associated data. This action cannot be undone."*) and both **deliberately did not click it** — *"the promised deletion path is still unverified… Recommend verifying on a throwaway account."*

### B4. 🟡 Severity disagreement on stalled uploads (🔵 vs 🟠)

E files **N9** — *"P2 confirmed at the API layer, not just the UI… `/api/v1/upload/jobs` returns both stuck jobs with `status:"extracting"` and `error: null` after 15+ minutes"* — as **🔵**.

B files the same underlying defect (**8.1**) as **🟠**, and D files it (**P2**) as **🟠**.

**Resolution.** Per the higher-severity rule, **M16 takes 🟠**. E's 🔵 appears to reflect "this is only a confirmation of an already-filed finding" rather than a genuine severity judgement about the defect — and E's own evidence (nothing in the payload marks the jobs failed, *"so no client could surface a failure even if it wanted to"*) argues for higher, not lower, severity: it establishes the bug is server-side and unfixable from the client.

### B5. 🟡 A's own recorded self-corrections — preserved so they are not re-litigated

Not cross-doc contradictions, but A explicitly records three of its own wrong conclusions. All three are worth preserving because each would otherwise be plausibly re-derived by the next reader:

1. **§8.7 — wrong root cause for the batch-synthesis failure.** *"⚠️ My first diagnosis was wrong and is recorded here deliberately. I reported the cause as '`batch_analyze_text_slides` doesn't pass `response_format`'. It does — `json_mode=True` is passed at `orchestrator.py:1615`; my grep had only covered lines 1477–1560 and missed the call. Reading before editing caught it. **Never accept a root cause for an LLM-output bug without looking at the actual response.**"* The true cause was the opposite of the guess — see M35.
2. **§4.1 — wrong diagnosis of the env split.** *"I initially misdiagnosed this as a frontend/backend flag mismatch and had to introspect the running app to get the truth."*
3. **§8.1b — two phantom blockers.** The background-tab wedge (*"step advances… but the DOM keeps the previous step's markup"*, caused by rAF throttling + `<AnimatePresence mode="wait">` at `Onboarding.tsx:717`; *"it self-heals the instant the tab becomes visible"*), and *"'Double-clicking Next wedges the wizard.' I formed this from the symptom above and it was wrong — a single-click control run wedged identically. The variable was tab visibility, not click count."* The rule A draws from this: **always run a single-variable control before filing an interaction bug.**

A is explicit that **M10 is unaffected** by any of this: *"it was found with real clicks in a visible tab, and its proof is a deterministic jsdom test that fails/passes on the one-line change with no rAF or visibility involved."*

### B6. ✅ Fixed-on-main vs still-broken-in-prod — the audits disagree with the *current* codebase, not with each other

Four findings carry fixes that landed after the prod-based audits were written. **None of B, C, D or E verified any of them**, because prod may be running an older build. All four are now **committed on `docs/f8-bounded`** — no longer uncommitted working-tree changes.

| Finding | Status | Commit | Prod status |
|---|---|---|---|
| **M6** `/profiles` refetch storm | ✅ **FIXED & verified** | `24dc9a2` | Was 🔴 open in B/C. Root-caused in the repo (unmemoized `refreshProfile` + unmemoized context value at `auth.tsx:287`, consumed as an effect dep at `useStudentDashboard.ts:26` and `StudentCourseLibrary.tsx:150`), reproduced on localhost at **60 req/s**, fixed, **0 req in 5 s** after, 452/452 tests pass, regression test verified to fail against the un-memoized version. **Prod still runs the old build until deployed.** |
| **M10** onboarding dead-end | ✅ **FIXED & verified** | `f682bde` | **Unverified in prod.** B reached `/onboarding` and `/onboarding/upload` but never ran the Back→continue repro. Assume still broken in prod until re-tested. |
| **M11** upload CTA silent failure | ✅ **FIXED & verified** | `cd426cf` | **Unverified in prod.** B's M16 (infinite spinner) is a *different* stage — the submit succeeded (`POST` → 200) and processing hung. The submit-failure path was never exercised against prod. |
| **M35** batch slide synthesis | ✅ **FIXED** (residual: no metric/alert) | 2026-08-17 | **Almost certainly still broken in prod** (older build) → prod is still paying ~5× the LLM calls per upload. The residual monitoring gap is open everywhere. |
| **M20** GDPR export | ❌ not fixed | — | Confirmed incomplete in prod. |

**One consequence worth flagging.** The M6 fix retires a claim that some docs recorded as evidence of a *different* problem: the **1000+ repeated `fetchProfile error` console entries** were this loop running while an access token was expired — a **symptom of M6, not a separate defect**. Post-fix, a clean reload produces **zero** console errors where **6020** had accumulated. Do not file those entries as an auth bug.

**Standing caveat from A §7.3, still live:** *"You run several Claude sessions against this same working tree. Re-check `git status` immediately before each commit — another session may have staged something you didn't intend to ship."* Verify all four commits are on the intended branch and reachable before treating any of these as landed for deployment purposes.
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
# Milestone-4 audit reconciliation — Sections C, D & E

**Source labels used throughout:**

| Label | Doc | Environment |
|---|---|---|
| **A** | `APP_AUDIT_REPORT.md` | localhost:5173 + repo + backend introspection + DB |
| **B** | `LEARNSTATION_FULL_APP_AUDIT.md` | prod, browser-only, student acct `abdul@test.com` |
| **C** | `PART_2_STUDENT_AUDIT.md` | prod, browser-only, same acct (**superseded by B**) |
| **D** | `PROFESSOR_ACCOUNT_AUDIT.md` | prod, browser-only, `prof@admin.com` |
| **E** | `AUDIT_ADDENDUM_previously_uncovered.md` | prod, authorized write-testing, `prof@admin.com` |

Finding IDs `M1`–`M81` refer to the deduplicated table in `_reconciled_A_B.md`.

---

## Part 5 — Prod-vs-local divergence

### C1. Exam feature: **live locally, dead in prod** — and M29 is the likely cause

The single clearest divergence. A §4.1 (repo/local): `backend/.env` sets `FEATURE_EXAM_MODE=1`, and A confirmed via live `settings.feature_*` introspection that the feature **is live**. B 4.1 / C 2.4.1 (prod): `POST /api/v1/exams/course/{id}/generate` → **404**, with same-session proof that five other v1 routers answer 200, and the explicit inference *"A 404 (rather than 403/501) is consistent with a feature flag gating router registration."*

**Reconciliation:** M9 is very probably not a code bug at all — it is M29 (two `.env` files disagreeing) manifesting in production. The prod deploy is likely reading a root-level `.env` that carries only `FEATURE_STUDY_GUIDE=1`. **Check the deployed env before writing any code for M9.** This also means M29 is understated at 🟠 — it has already silently killed a whole shipped feature in production.

Same class, unresolved: `FEATURE_REVIEW_ENGINE`, `FEATURE_STUDENT_UPLOADS` and `FEATURE_STUDY_GUIDE` are on locally; prod status was never checked. `/materials` renders in prod, so `FEATURE_STUDENT_UPLOADS` is on there. `/review` renders in prod (empty state), so `FEATURE_REVIEW_ENGINE` is on. `/course/:id/study-guide` returned "may not be enabled for this course yet" — ambiguous between flag and data. Only exam is confirmed divergent.

### C2. Prod-only — observed on `learnstation.duckdns.org`, never reproduced from the repo

None of these were seen or looked for on localhost. All are candidates for "already fixed on main but still deployed," and **each needs a localhost re-check before any code is written**:

| Finding | Why it may be prod-only |
|---|---|
| **M7** dashboard hero opacity 0 | Never measured on localhost. A's only opacity claim on localhost was retracted. **Still requires the rAF pre-flight** (`visibilityState === 'visible'`, `hasFocus() === true`, >20 frames/800 ms) before any measurement is trusted — see §B1 of `_reconciled_A_B.md`. |
| **M8** lecture Back strands player | `/lecture/:id` never opened on localhost. |
| **M21–M23** `?slide=` inert, PDF 503, comprehension clipping | Lecture surface unvisited locally. |
| **M24, M44, M46** header hit-stealing, duplicate Home, two-click tabs | Global header never hit-tested locally. |
| **M4, M5, M12, M13** professor editor write-amplification, Save unclickable, no dirty guard, quiz suggestion not persisted | Professor shell entirely unaudited on localhost (A §10 Part 3). |
| **M14, M15, M51** batch review defects | A §10 lists `/professor/upload/batch/:id/review` as unaudited; B/D couldn't reach it; only E did, via a recovered `batch_id`. |
| **M17** shared course across two accounts | Needs two accounts; A had one local session. |

**⚠️ M6 has been removed from this table.** It is no longer prod-only-unreproduced. The `/profiles` refetch storm was **reproduced on localhost, root-caused in the repo, fixed and verified today** (commit `24dc9a2` on `docs/f8-bounded`). The root cause was an unmemoized `refreshProfile` closure plus the unmemoized context value object at `src/lib/auth.tsx:287`, consumed as an effect dependency at `useStudentDashboard.ts:26` and `StudentCourseLibrary.tsx:150`. Localhost measured **300 requests to `/rest/v1/profiles` in 5 s = 60/s** on an idle `/dashboard` (isolated by navigating away: `/friends` = 0.8/s, a 75× drop); after the fix, **0 requests in 5 s**, 452/452 frontend tests pass, regression test verified to fail against the un-memoized version. So the defect was never a prod-vs-local divergence at all — it was simply never profiled locally until now. **Prod still runs the old build until this is deployed.**

The **M22 503** deserves a specific note: it is a Supabase Storage signed-URL fetch, so it is infrastructure-dependent and may be genuinely unreproducible locally. B's fix plan already scopes it as a **spike** (session N), not a fix.

### C3. Local/repo-only — invisible to any browser-only audit

Everything in A §3, §4, §5, §9 and the config/legal findings is unreachable from a browser session: **M1–M3, M26–M29, M31, M32, M35, M54–M59, M63–M65, M77–M81**. B and C both state this plainly — *"`tsc -p tsconfig.app.json`, CI trigger check, `backend/.env` vs `.env` reconciliation — **No repo access this session**."* No divergence claim can be made about them; they simply were not testable from prod.

### C4. Same database, so **A's data-layer findings apply to prod verbatim**

A §9 notes: *"this is the same Supabase project production uses (`lkiiideqjoiksnycgplc`)."* So **M36** (36 published courses, 83 % noise) and **M37** (43 lectures with quiz questions and zero review cards) are *not* local-only — they are live production data problems. Two prod observations corroborate them independently:
- **M37 ↔ prod:** B and C both found `/review` showing **0 cards due** on an account with 13 lectures.
- **M36 ↔ prod:** C found the Discover drawer rendering **20 cards, every one a disabled `Enrolled` badge**, and B/C both declined to file that as a defect for want of a second account. A's query explains it: the catalog is mostly fixtures.
- **M39 ↔ M36:** the 16/1/0 lecture-count disagreement is almost certainly three duplicate course rows, which A's query found directly.

### C5. Divergences that resolve as *agreement*, not conflict

- **`/openapi.json` 404** — A found it locally, B/C found it absent in prod. Same behaviour both sides (M55). A's recommendation ("confirm dev keeps docs on") is unaffected.
- **Global search off** — A found the flag missing locally; B/C confirmed no ⌘K in prod and correctly cited A's own finding number. Consistent (M56).
- **Admin gating** — B 7.1 and D §3 both confirm `/admin/dashboard` redirects for non-admins in prod; A §6 documents the route as admin-only in the repo. Consistent.

---

## Part 6 — Coverage gaps: what nobody has tested

Nothing below has been exercised by **any** of the five documents.

### D1. Blocked by a defect

| Gap | Blocked by | Sources |
|---|---|---|
| `/exam/take/:examId`, `/exam/report/:examId` — the entire take-and-report half of Exam Mode | M9 (generate 404) | A §10, B §11, C §2.8, E §4 |
| Review-session **grading** (answering cards, scheduling maths) | 0 cards due on every account tested; none could be forced due without DB write | B §11, C §2.8, E §4 |
| Upload wizard **Review / Quiz / Done** steps | M16 — processing never completed for the test file | B §11 |
| `Generate Summary`, `Auto-Generate All Quizzes`, `Generate cross-slide quiz`, `Generate with AI` | **Deliberately stopped after discovering M4** — each fires 14+ slide writes from a cached copy, so every click risked overwriting real slides with stale data | E §3, E §4, D §4 |

### D2. The decisive security test — **never run**

**Cross-tenant mutation (M17/M18).** All four prod docs flag it; none ran it.

- C: *"Backend enforcement was NOT tested — no destructive call was issued."*
- B: *"The decisive test — can it mutate a course it does **not** own — could not be run: the clean method (authenticated REST query for a foreign course id) was correctly blocked by the safety layer, and the UI exposes no foreign lecture ids. **No mutation was issued.**"*
- D P3: *"Backend enforcement untested (no mutation issued)."*
- E §4: **"Ready to run — needs you to sign back in as the student."** Plan: as `abdul@test.com`, attempt a reversible change (course colour) on "Database Systems" and record whether the API accepts or rejects.

**This is the highest-value uncovered item in the entire audit.** It is the one test that converts M17 from "UI exposes destructive controls to two accounts" into a definite yes/no on backend enforcement, and it is already scoped, reversible, and one login away.

### D3. Destructive / persistent actions never exercised

| Action | Sources |
|---|---|
| Account **deletion** end-to-end (control present, correct warning copy, never clicked) | B §11, C §2.5, E §4 — all three say: verify on a throwaway account |
| `Archive`, `Delete`, `New Course`, per-slide delete, `Replace PDF` | D §4, E §4 — E notes the throwaway-course route remains the safe way to cover these |
| `Done reviewing` / `Done reviewing all` on batch review | E §4 |
| `Save Lecture` **while covered by the header** (the M5 failure in situ) | D §4 — deliberately not attempted; those clicks land on `Sign out` |
| Confirmation-dialog behaviour on the adjacent trash icons (M50) | D P9 |

### D4. Whole surfaces never audited by anyone

| Surface | Sources |
|---|---|
| **Admin panel itself.** Only its *gating* was tested (redirect for non-admins). **No admin-role account has ever been signed into.** `/admin/dashboard` — which A §6 notes is *"the entire admin nav; an admin sees no other tab"* — has zero *functional* coverage. **Qualification (new):** the admin surface has since received a **source-level (repo) audit** — see `Milestone-4/_source_audit.md`, findings `R1`–`R54`. The gap is therefore now **runtime coverage, not total ignorance**: the code has been read, but no admin session has ever driven it. Those R findings are deliberately **not merged** into the M1–M81 tables. | A §10 (Part 3), B §7, D §3 (+ `_source_audit.md` R1–R54) |
| **Auth screens** — login, signup, password reset, email verification, session expiry. B: *"auth screens not re-tested (already signed in)."* A inspected `/auth` visually only (M73). | B route table, A §2 |
| **Onboarding on prod.** A audited it thoroughly on localhost; B only ran `/onboarding/upload`. The M10 repro was never re-run against prod. | B route table |
| **Foreign `/profile/:userId`** (someone else's profile) | B §11 |
| **Notifications panel** (badge read "2 unread" throughout; never opened) | B §11 |
| **Leaderboard All-Time** tab; institution/faculty/semester/verified filters | B §11, C §2.6 |
| **Friends: accept/reject/send** a real request — only empty states and the 50-suggestion list were seen | B §9, C §2.6 |
| `/course/:id/study-guide` **against a course that advertises one** — only V101 tested, which failed gracefully. C: *"Not retested against Datenbanksysteme, which does advertise a study guide on the dashboard — do that before closing this out."* | C §2.6 |
| Exam config at **30 and 40** questions | B §11 |

### D5. Depth gaps on surfaces that *were* visited

| Gap | Sources |
|---|---|
| **Quizzes on the lecture surface, in depth.** C: *"Only the inline `QUICK CHECK` and comprehension-check rows were inspected; **no quiz was completed**."* Given M37 (38 % of lectures have no review cards) and M13 (suggestions don't persist), the quiz path is thinly covered end-to-end. | C §2.8 |
| **N+1 / query profiling beyond `/dashboard`.** Only `/dashboard` was profiled (M6). C flags `/api/v1/upload/jobs` polled **9×** in one dashboard session with the interval uncharacterised. | C §2.8 |
| **Mobile beyond three screens.** Student: only `/dashboard` at 390 px. Lecture player and exam never tested at mobile. Professor: only the lecture editor at 390 px (M52) — D notes *"P1 is likely worse at narrow widths"* and was never checked. E: *"Window kept snapping back to 942 px with the side panel open."* | C §2.8, D §4, E §4 |
| **Professor shell has never been driven on localhost.** Every professor finding (M4, M5, M12–M15, M17, M38, M48–M52, M74) comes from prod browser sessions only — no repo-side runtime reproduction exists for any of them. **Qualification (new):** the professor shell has since received a **source-level (repo) audit** — see `Milestone-4/_source_audit.md`, findings `R1`–`R54`. The gap is therefore now **partial**: the code has been read, and a **localhost browser drive of the professor dashboard was performed on 2026-08-18** (see `_source_audit.md` §4.8) which confirmed R41 live and produced four new findings — R51 (`total_slides` desynchronised: 2/32 lectures show 0 while holding 32 and 127 slides), R52 (the two stalled `extracting` jobs had already written their slides and hung before finalisation — reframes M16), R53 (the jobs endpoint returns no timestamps) and R54 (greeting logic). **What remains uncovered on this surface is anything visual**: the Part 1 rAF pre-flight never passed during that session, so no opacity, layout or animation claim was made or can be made from it. M5 and M52 in particular still have no localhost reproduction. Those R findings are deliberately **not merged** into the M1–M81 tables. | A §10 (Part 3), D, E (+ `_source_audit.md` R1–R54) |
| **`/professor/courses/:id` as a standalone page.** B marked it ⚠ not individually loaded; D resolved it renders as a modal over `/professor/courses` — so the route is covered, but only via the modal path. | B route table, D §1 |
| **Unsaved-changes guard** — D listed it as untested; **E closed it** (M12). Now covered. | D §4 → E N2 |

### D6. Cross-cutting, never systematically exercised

From A §10's cross-cutting row, plus what B/C/D/E did *not* do:

- **Dark mode** — no document tested it on any screen.
- **Keyboard navigation / a11y per screen.** A checked exactly two things (M30 unlabelled input; Select type-ahead works). No tab-order, focus-trap, or screen-reader pass on any authenticated screen. Note M24 and M5 (hit-target theft) strongly imply focus-order problems that were never measured.
- **RLS behaviour** — A verified `/courses/browse` uses the RLS-enforcing per-user client; no adversarial RLS testing anywhere. Compounds D2.
- **Empty / loading / error states** as a systematic sweep — sampled ad hoc (some praised: `/professor/archive`, `/review`, `/materials`; some missing: M49 Pipeline Diagnostics, M16 no failure state).
- **Console errors + failed network requests per screen** — done for `/dashboard` (clean) and `/exam` (M9), not as a sweep.
- **i18n coverage in German** end-to-end. Only M32 (one hardcoded English string) and M38 (title translation split) surfaced. A German-locale walkthrough was never done, and A §1 stresses the DE text is the legally operative version.

### D7. Housekeeping left behind by the audits

- **`AUDIT-TEST-ignore.pdf`** was submitted to prod by B. No course/lecture was created (verified via `/professor/courses`), but *"a server-side upload job may still be queued — worth a glance at your uploads/jobs so it doesn't linger."* Given M16, it may still be sitting in `extracting` forever.
- **Two genuinely stuck professor jobs** (`09-pq.pdf`, `05-boolean-functions-sboxes.pdf`, lecture ids `21e0be6b…`, `c895b00d…`) are real user content, stuck since at least 23:45, and nothing will time them out. These need manual intervention regardless of when M16 is fixed.
- E's data-integrity statement is clean: four authorized writes to lecture `126bb3c8…`, all reverted, hard-reload verified (title exact, content 44 chars, AI summary 599 chars, `[AUDIT]` 0 occurrences, 54 slides) — with one extra round-trip because M4 resurrected the marker after the first revert.

---

## Part 7 — Merge hazards and consolidated delivery order

Four separate fix plans exist (A §7, B §12, C §7-ext, D §5, E §5) with **overlapping and inconsistent session letters**. B/C use `A–N` / `S-A–S-L` for the *same* sessions; D adds `O–T`; E adds `U–Y`; and A's own `S1–S4` read confusingly alongside B's `A/B/C/D`. Renaming before scheduling is worth ten minutes.

### E1. The one collision no single doc could see

**A's S3 (config consolidation) ↔ B/C's session D (exam router).** A §7.2 S3 collapses `.env` + `backend/.env` into one file and warns: *"Env consolidation can silently flip a feature flag in production… Merge this one alone, never bundled."* B/C's session D requires *"register the `exams` router / flip the flag on the deployed backend."* Per §C1, **M9 is probably caused by M29** — so these are not two sessions, they are one investigation. **Do A-S3 first and re-check whether the exam 404 disappears before writing any exam code.**

Second cross-doc collision: **A's §8.5/§8.6 (upload submit error handling, queue health) ↔ B's H ↔ D's R ↔ E's X.** All four touch the upload/job-state model. A's M11 fix already modified `src/hooks/useBatchUpload.ts` and `src/features/student/components/StudentUploadWizard.tsx` (now committed as `cd426cf`), so B's H will conflict with that work if it is branched from an older base. Rebase onto the M11 fix before starting H/R/X.

### E2. Hard-serialize sets (never run in parallel)

| Set | Shared files/code | Rule |
|---|---|---|
| **A-S1 (legal) ↔ A-S2 (landing reveal)** | `src/pages/Landing.tsx` | A §7.2: *"S1 and S2 **both edit `src/pages/Landing.tsx`**. Run them sequentially on the same branch, or land S1 first and rebase S2 — do not run them as parallel branches."* |
| **A ↔ B ↔ I** (dashboard refetch, scroll-reveal, aggregates) | `useStudentDashboard` / `studentService` / `homeFeed` | B §12 + C: *"all likely touch… sequence, don't parallelize."* Also: **A must land first — it re-baselines every other measurement** and likely cures the 1.2 race and the stale-ref flakiness. |
| **E ↔ F** (lecture Back state machine, `?slide=` authority) | lecture-player mount + history logic | B §12: *"hard serialize."* C: *"**Do not run in parallel with S-E.**"* F waits for E, never alongside. |
| **U ↔ W** (save write-set / stale replay, quiz-suggestion persistence) | slide-save path | E §5: *"same session or strictly sequential, never parallel."* W **depends on** U — *"the 14 stale PATCHes may be what's clobbering the suggestion, so fix U first and re-test before writing new code."* |
| **Q ↔ I** (canonical course titles ↔ aggregate/count roll-up) | course-aggregate + title-resolution selectors | D §5: *"**collision, serialize**"* and *"one session, not two."* ⚠️ Also fold in **M39's caveat** — verify the 16/1/0 counts aren't three duplicate DB rows (M36) before writing selector code. |
| **T ↔ L** (professor polish ↔ student cosmetic) | the breadcrumb component (M42) | D §5: *"both touch breadcrumbs — **collision, serialize**."* Same component serves both shells. |
| **X ↔ R** (batch-review truthfulness ↔ upload timeouts) | job-state model | E §5: *"share the job-state model."* D §5: *"do them together… do not split."* Both need a real terminal-state model for jobs — one design, one session. |
| **O ↔ V** (editor action bar vs sticky header ↔ unsaved-changes guard) | editor shell | E §5: *"**V** touches the editor shell that **O** also touches — sequence O then V."* |
| **C ↔ L** and **C ↔ G** (header shell ↔ breadcrumb shell ↔ settings pane) | header/breadcrumb shell; settings Data&Privacy | B §12: *"land C first (L is cosmetic)."* And: *"small overlap with C if 5.2's retest folds into C"* — M46's retest naturally belongs in C, which then touches G's pane. |

### E3. Isolated — safe to parallelize

`D` (isolated to `MockExam` + one backend router registration — **but see E1**), `J`/`S-I` (responsive CSS: M23 + M25), `K` (Ascent Mind Map, M47), `Y` (professor editor responsive collapse, M52), `O` (editor layout, M5), `A-S4` (dead-code sweep: M57–M59 — A notes it's disjoint from S1/S2), `H` in isolation (onboarding wizard + job polling — **but see E1 and X↔R**).

### E4. Consolidated merge order across all five plans

Reconciling A §7.3, B §12, C, D §5 and E §5 (E's revised order is the most recent and takes precedence where they conflict):

1. **A-S0 — typecheck green (M64).** 18 errors, mostly one `as const`. Until this lands, no session can be gated on `tsc`, and A's stated fallback — *"no new errors in the files I touched"* — will not be applied reliably.
2. **A-S1 — legal unblock (M1–M3, M27, M66, M81).** A: *"The single best hour you can spend."* Two launch blockers, zero runtime code, cannot regress anything. **Blocked on you** for real legal name/address/contact; ideally lawyer-reviewed. Note `npm run lint` enforces EN/DE i18n parity, so both locales must be edited together.
3. **U(b) — kill the stale AI replay (M4, corruption half).** E: *"stop the corruption"* first. This is the only finding actively destroying user data.
4. **O — editor action bar below the header (M5).** Makes Save reachable. Acceptance: hit-test grid ≥99 % reachable **at maximum scroll**, not just `scrollTop 0`.
5. **V — unsaved-changes guard (M12).** With O, closes the scroll → Sign out → silent-loss path.
6. ~~**A (dashboard refetch, M6).** Re-baselines every later perf and flakiness measurement — nothing downstream should be measured before this lands.~~ ✅ **DONE — commit `24dc9a2` on `docs/f8-bounded`.** Memoized `fetchProfile`, `fetchRole`, `signUp`, `signIn`, `signOut`, `refreshProfile` and the context value in `src/lib/auth.tsx`; localhost went from **60 req/s to 0 requests in 5 s**; 452/452 frontend tests pass; regression test verified to fail against the un-memoized version. **Consequence for scheduling: every downstream item that was gated on this is now unblocked** — specifically item 9 (**B**, scroll-reveal M7), item 11 (**E**, lecture Back M8) and any perf or flakiness measurement in items 14–15. Re-baseline before measuring: the pre-fix numbers in B/C were taken against a page issuing 2.5–60 requests per second, so any timing, race or "intermittent" characterisation recorded there is now suspect and should be re-observed rather than trusted. Note B predicted this fix would *"likely also cure the 1.2 race and the stale-ref flakiness"* — **re-test M7 and the rejected "Continue does nothing" claim against the fixed build before writing code for either.**
7. **U(a) — de-amplify the save write-set (M4, 20-writes half).** Acceptance: edit one field → exactly one `PATCH`; generate a quiz → zero unrelated slide writes.
8. **C — header hit-targets (M24, M44; retest M46).** Independent of 6. Acceptance: 980-point hit-test grid ≥99 % reachable.
9. **B — scroll-reveal for in-viewport content (M7).** After 6 (**now unblocked**). **Verify visually, never via `getComputedStyle`** — and run A §8.1b's rAF pre-flight first.
10. **A-S3 — config consolidation (M28, M29, M55, M56, M79, M80) → then D — exam router + error surfacing (M9, M19).** Per E1, S3 may resolve M9 outright. Ship D's error-surfacing half regardless — *"a silent dead button is worse than a disabled one."* ⚠️ A: S3 is the only session touching deploy-time config; bring up `docker-compose.prod.yml` locally and smoke-test `/api/v1/health` plus one real endpoint before merging; **merge alone, never bundled.**
11. **E — lecture Back state machine (M8).** After 6 (**now unblocked**). Highest regression risk, own PR, full player regression pass.
12. **F — `?slide=` authoritative (M21).** **After E, never alongside.** Cheap alternative if effort is tight: stop emitting the param from the dashboard.
13. **W — quiz-suggestion persistence (M13).** After U; re-test before writing code.
14. **R + X together — upload timeouts + batch-review truthfulness (M16, M14, M15, M51)**, plus A's queue-health findings (M33, M34) which supply the server-side half. One job-state model.
15. **G, H-remainder, I+Q, J, K, L+T, Y, A-S4** — parallel-safe with each other within the constraints of E2. (G = GDPR export M20; I+Q = aggregates/titles M38–M41; J = responsive M23/M25; K = M47; L+T = M42, M43, M45, M48–M50, M74; Y = M52; A-S4 = M57–M59.)
16. **Spikes, any time — they produce decisions, not diffs:** **M/P** = the cross-tenant mutation test (M17) — *ready to run, needs a student login*; **N** = the slide-PDF 503 (M22) — Supabase storage vs signed-URL timing.

### E5. Process traps that apply to every session

- **CI runs nothing on feature branches.** A §7.3: `.github/workflows/ci.yml` triggers on `pull_request` and `push: branches: [main]` **only**. *"A green-looking branch is not a tested branch — you only get signal once a PR is open."*
- **`tsc -p tsconfig.json` checks nothing** — always `tsconfig.app.json`.
- **Concurrent sessions on one working tree.** A §7.3: *"You run several Claude sessions against this same working tree. Re-check `git status` immediately before each commit."*
- **Branch from `main`, not from the current `docs/f8-bounded`.**
- **Squash-merge each session as one commit** so any single fix can be reverted independently — A singles out S3 as the one where this matters most.
- **Never trust `getComputedStyle().opacity` in this codebase** (B §10, C §2.7) and **never trust any visual measurement without the rAF/visibility pre-flight** (A §8.1b). Between them these two rules account for one retracted finding and two phantom blockers across the audits.
- **Always run a single-variable control before filing an interaction bug** (A §8.1b) — the "double-click wedges the wizard" claim died to exactly this.
---

## Part 8 — Milestone-consolidation findings (F1–F9)

Source **F**. These did not come from a browser drive; they came out of the 2026-08 branch
consolidation, from reading `main` and probing the **live production database** directly. So there
is nothing visual here, and nothing that depends on animation state — every claim is a code
reference or a query result.

Full context in [`docs/MILESTONE_2026_08.md`](../docs/MILESTONE_2026_08.md), tagged
`milestone/2026-08-consolidation`. IDs match that document exactly, so a finding can be traced
either way.

### F8 🔴 A new student cannot enroll in any course — CONFIRMED

Every catalog entry renders disabled and labelled "Enrolled". Reproduced against the live app with
an account holding **zero** `course_enrollments` rows: 20 catalog buttons `disabled: true`, 24+
courses in the rail.

The chain, each link verified independently:

1. `src/services/studentService.ts:61` — `fetchStudentCourses` selects from `courses` with **no
   enrollment filter and no user filter at all**.
2. RLS does not scope it either. `courses` SELECT policies are **permissive**, so they **OR**
   together, and `"Authenticated users browse published courses"` is
   `USING (status = 'published' AND is_archived = false)` with no caller condition. It alone grants
   every published course to any authenticated user; the two enrollment-scoped policies beside it
   add access and restrict nothing.
3. `src/pages/StudentCourseLibrary.tsx:222` pre-seeds from that result under the comment
   *"Pre-seed courseMeta with explicitly enrolled courses"* — **the comment is false.**
4. `:324` wraps it as `enrolledCourseIds`; `CourseCatalogSheet.tsx:168/:207` disable the enroll
   control on membership in that set.

**This is the `list_courses` leak's twin.** Identical mechanism — a permissive browse policy ORing
away the enrollment scope — fixed on the backend endpoint by `7c3af43` and still live on the client
path. `7c3af43` cannot have fixed it: that patched `backend/api/v1/courses.py`, and
`fetchStudentCourses` is a direct PostgREST select that never reaches the `list_courses` endpoint.

**Blast radius is closed, not open.** Two sweeps: exactly two client-side reads of `courses` exist
outside tests — this one and `AdminDashboard.tsx:115`, which is legitimate and gated behind
`<ProtectedRoute allowedRoles={['admin']}>` (`App.tsx:540`). And across all of `public`, `courses`
is the **only** table with the OR-away shape:

```sql
WITH sel AS (
  SELECT tablename, COALESCE(qual,'') AS q, permissive
  FROM pg_policies WHERE schemaname='public' AND cmd='SELECT'
)
SELECT tablename,
       count(*) FILTER (WHERE q !~* 'auth\.uid|has_role|current_setting') AS unscoped,
       count(*) FILTER (WHERE q  ~* 'auth\.uid|has_role|current_setting') AS scoped
FROM sel WHERE permissive='PERMISSIVE'
GROUP BY tablename
HAVING count(*) FILTER (WHERE q !~* 'auth\.uid|has_role|current_setting') > 0
   AND count(*) FILTER (WHERE q  ~* 'auth\.uid|has_role|current_setting') > 0;
```

Returns one row: `courses | unscoped=1 | scoped=2`. Keep this query — it proves the negative in one
statement and fires the moment a second unscoped permissive policy lands anywhere.

**The fix is not a filter tweak.** There is **no client-side enrolled-course accessor at all** —
zero `course_enrollments` reads under `src/services/`, `src/features/` or `src/pages/`. One has to
be written, and `StudentCourseLibrary` has to start distinguishing "courses I can see" from
"courses I'm enrolled in". They are currently the same variable.

⚠️ A unit test against `fake_supabase` **cannot** catch this class — it has no RLS machinery, so it
cannot model permissive policies ORing. Use the real-Postgres harness or Playwright. See F4.

### F1 🔴 Live Supabase service JWTs committed in git history

`184e574:.env` and `8a34f6a:backend/.env` contain real `eyJhbG…` service keys. `1fcc2bd` untracked
them from HEAD but **not from history**.

This is why the nightly `secret-scan` fails: it runs `fetch-depth: 0` with no `.gitleaksignore`
anywhere. **It passes on PRs and fails nightly**, because PR runs are shallow — which is exactly why
it read as scanner noise for weeks. The `.dockerignore` fix in `785bcb3` addresses a different
problem (keys entering images) and cannot help here.

Rotation is an outward-facing action on the live project and belongs to the account owner. Then
either scrub history or add a documented allowlist recording the rotation date.

### F2 🟠 GDPR erasure can destroy data while reporting success

`backend/api/v1/auth.py` swallows storage-cleanup failures and then deletes `auth.users` anyway,
returning `200 "Account deleted."` `lectures` cascades away on that delete and was the only
`uid → pdf_hash` map, so the orphaned blobs become **unrecoverable by any retry**.

The reverse order fails too: embeddings (`account_service.py:222`) and blobs are deleted *before*
the auth delete, so a failure there leaves a live account with no PDFs and no search index —
`SettingsGdpr.test.tsx` currently asserts that state as correct.

`_remove_blob` (`:238`) and `_remove_worksheets` (`:266`) swallow errors but still increment the
success counters returned in the erasure receipt. Two buckets are never touched: **`avatars` — a
public bucket, so photos stay fetchable after erasure** — and `lecture-pdfs`, where the current
upload path writes.

### F3 🟠 GDPR export omits 14 tables holding personal data

`EXPORT_TABLES` (`account_service.py:78-99`) misses `tutor_messages` (AI chat transcripts),
`courses`, `assignments`, `llm_calls`, `notification_preferences`, `concept_mastery`,
`onboarding_progress`, `parse_runs`, `practice_sheets`, `course_blueprints`, `material_sources`,
`assignment_enrollments`, `learning_events_daily_rollup`, `learning_events_legacy_20260721`.
`friend_requests` is exported by `requester_id` only — half the social graph.

It has already drifted once (`notification_preferences` landed after the list was written). Needs a
test asserting coverage of every user-scoped column, or it drifts again.

### F4 🟠 No test composes the real endpoint with real RLS

`fake_supabase.py` has no RLS machinery, and `conftest.py` binds `get_auth_client` to the same
service-role fake, discarding the token. The real-Postgres test re-implements `list_courses`'s
filter in raw SQL rather than calling it. Both halves are covered; they are never composed — which
is precisely why F8 survived a fix aimed at the same mechanism.

### F5 🔵 Dead index on a 100%-NULL column

`slides_embedding_ivfflat`, 1208 kB, **0 scans in 252 days**, on `slides.embedding` — NULL across
all 5,456 rows and superseded by the `slide_embeddings` table. No non-test code references it.

### F6 🔵 `types.ts` detects drift in one direction only

`src/integrations/supabase/types.ts` is generated **from production**, so it cannot reveal a
migration production never applied. That is exactly how `eval_runs` and `activation_funnel_daily`
stayed invisible until `pg_catalog` was probed directly. Generate with `--db-url`; the
`--project-id` path needs a `supabase login` token.

### F7 🔵 Two unreliable tests — do not conflate them

`test_check_duplicate.py::test_force_reparse_skips_cache` fails locally with a 429 from rate-limiter
state leaking between tests and **passes in CI** — environment-dependent in both directions.

`Settings page (smoke) > lets a user opt out of future lifecycle reminders` is **genuinely
nondeterministic, roughly a coin flip — not order-dependent.** Measured alone in a clean worktree:
4 passed / 1 failed / 1 failed / then 3 clean. An earlier "fails 4/4 in isolation" reading was a
small sample plus luck. The wrong label sends the next person hunting for test pollution that does
not exist.

### F9 🔵 ~113 MB of duplicate objects in `lecture-pdfs`

Relevant to the same egress budget the WebP poster work addressed from the other direction.

### Production database state

**Never run `supabase db push`.** `supabase_migrations.schema_migrations` holds **2 rows against
115 migration files**, so a push would attempt to replay 113 migrations against a live database.
`pg_catalog` is ground truth. Five migrations remain deliberately unapplied, including
`learning_events` partitioning, which rewrites a live table — give that one its own pass.

Closed during the consolidation, contrary to older notes: `reset_all_analytics`,
`restore_analytics` and `increment_upload_quota` are locked down (`anon=false`).

---

## Appendix — provenance and how to maintain this document

### What was merged, and what that changed

Five audits produced ~90 raw finding rows. Reconciliation reduced them to 81 (`M1`–`M81`); a
source-level pass added 50 more (`R1`–`R50`).

The dedup was not clerical. Three merges changed what the findings *mean*:

- **M16** — one stalled-upload defect had been reported three separate times, at three different layers, by three documents. It is one bug.
- **M39 / M36** — a browser-observed lecture-count discrepancy (16 / 1 / 0) looked like an aggregation bug. A database query from a repo-enabled session explains it as **duplicate course rows**. Writing selector code against the browser symptom would have fixed nothing.
- **M6** — a prod audit observed a `/profiles` refetch storm and could not explain it. A repo session found the cause (an unmemoized callback used as an effect dependency), fixed it, and measured the result. Symptom and cause were filed as separate findings until they were merged.

The pattern: **a browser-observed symptom and its source-level cause are one finding, not two.**
Keep it that way as this document is updated.

### Evidence standards used here

- Every `R` finding cites `file:line` and quotes the code. None are inferred.
- Every performance claim states the measurement, the window, and the control.
- Findings that could not be verified are marked as such rather than hedged into the table.
- One finding is **retracted** (§2.1 of doc A, the "invisible feature cards" claim). Retractions are kept visible rather than deleted, so they are not re-discovered and re-filed. This has already paid for itself: the same artifact recurred three times during compilation.

### Known gaps in this document

- Prod-vs-repo drift is **inferred, not measured**. Nobody has diffed the deployed build against `main`. Until someone does, treat every prod-only finding as "may already be fixed" and every repo-only finding as "may not be deployed."
- The `R` findings are **static-analysis findings**. They are precise about what the code does and silent about how often each path is actually hit in practice.
- Severity is harmonized across five authors with different scales. Where two documents disagreed the higher severity was kept and the disagreement noted (see B4). Treat severity as a starting point for triage, not a verdict.

### Maintaining this file

1. New findings get the next free `M` or `R` id. **Never renumber** — the ids are cited across five source documents, four fix plans and this file's own cross-references.
2. When a finding is fixed, mark it `✅ FIXED — commit <sha>` in place. Do not delete the row; the fixed rows are how the merge order stays readable.
3. When a finding is disproved, mark it **RETRACTED** with the reason. Do not delete it.
4. Re-run the Part 1 rAF pre-flight before recording any visual finding. Every time.

### Source documents

Preserved in this folder as primary evidence. This file supersedes them for action, but they carry
detail — DOM measurements, network traces, hit-test grids, data-integrity statements — that was
compressed here.

| File | What it is |
|---|---|
| `APP_AUDIT_REPORT.md` (this file) | The consolidated, actionable audit |
| `LEARNSTATION_FULL_APP_AUDIT.md` | Prod browser drive, ~30 routes, student + professor + admin gating |
| `PART_2_STUDENT_AUDIT.md` | Prod student pass — superseded by the above, retained for its evidence |
| `PROFESSOR_ACCOUNT_AUDIT.md` | Prod professor pass, hit-test grids, `prof@admin.com` |
| `AUDIT_ADDENDUM_previously_uncovered.md` | Prod write-testing with authorized reversible edits; includes the data-integrity statement |
| `_reconciled_A_B.md`, `_reconciled_C_D_E.md`, `_source_audit.md`, `_header.md`, `_footer.md` | Build inputs for this file. Safe to delete once you're happy with the assembled result. |
| `learnstation-data-2026-08-17.json` | Data export captured during the prod sessions |

---

*Compiled 2026-08-18. Findings verified against a running app or actual source; none inferred from
documentation. Where a claim could not be verified, the row says so.*
