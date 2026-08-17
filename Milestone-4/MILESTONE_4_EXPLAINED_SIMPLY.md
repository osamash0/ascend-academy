# Learnstation — Milestone 4 Audit Report (Complete Summary)

> **Sources:** 5 audit documents + 1 GDPR export JSON, all from `/Milestone-4/`  
> **Audit date:** August 17–18, 2026  
> **Targets tested:** Live production build (`learnstation.duckdns.org`), local dev (`localhost:5173`), backend (`localhost:8000`), Supabase database  
> **Accounts used:** Student (`abdul@test.com`), Professor (`prof@admin.com`)  
> **Coverage:** ~26 of ~30 client routes exercised

---

## Dashboard Overview

| # | Area | What's Wrong | Severity | Who's Affected |
|---|---|---|---|---|
| 1 | **Legal / GDPR** | Privacy policy falsely claims AI runs locally; Impressum is blank placeholder text; legal pages unreachable from footer | 🔴 Blocker | Everyone |
| 2 | **Professor Editor — Save Button** | Scrolling makes "Save Lecture" unclickable; 100% of clicks land on "Sign Out" or "Settings" instead | 🔴 Blocker | Professors |
| 3 | **Professor Editor — AI Overwrites** | Using "Suggest Quiz" after saving a slide silently writes old text back over the new text | 🔴 Blocker | Professors |
| 4 | **Professor Editor — No Unsaved Warning** | Closing the tab or navigating away silently discards all edits with no confirmation prompt | 🟠 High | Professors |
| 5 | **Student Dashboard — Infinite Loop** | Profile data is refetched ~2.5 times/second forever (182 requests in 63 seconds) | 🔴 Blocker | Students |
| 6 | **Student Dashboard — Invisible Hero** | The main "Continue Lecture" card sometimes loads fully transparent; scroll down and back up to see it | 🔴 Blocker | Students |
| 7 | **Exam System** | "START EXAM" silently fails (backend returns 404); no error shown to user | 🔴 Blocker | Students |
| 8 | **Lecture Player — Back Button** | Browser Back strips all slide controls from the page; requires a full refresh to recover | 🔴 Blocker | Students |
| 9 | **Lecture Player — Slide URL Ignored** | `?slide=N` in the URL is ignored on load and never updated when advancing slides | 🟠 High | Students |
| 10 | **Lecture Player — PDF 503** | First fetch of the lecture PDF returns 503; retry succeeds after ~18s of blank spinner | 🟠 High | Students |
| 11 | **Upload Pipeline — Silent Failures** | Upload errors (429, 500, network) show no toast or message; button just resets to idle | 🔴 Blocker | Students |
| 12 | **Upload Pipeline — Stuck Jobs** | Uploads hang in "extracting" for 15+ minutes with no timeout, error, or retry option | 🟠 High | Everyone |
| 13 | **AI Batch Processing — 5× Cost** | Batch slide synthesis fails 100% of the time due to a JSON envelope mismatch; falls back to per-slide calls, costing ~5× more in API fees and time | 🟠 High | Backend / Cost |
| 14 | **Header Button Collision** | Account menu button is 53.7% unclickable; clicks land on a hidden Home link underneath | 🟠 High | Everyone |
| 15 | **Onboarding — Hardcoded Filter** | Step 5 filters courses to a single German title (`datenbanksysteme`); shows "No courses" for everyone else | 🟠 High | New Students |
| 16 | **Onboarding — Old Product Name** | Post-onboarding screen still says "Ascend Academy" (hardcoded, untranslated) | 🟡 Medium | New Students |
| 17 | **Onboarding — No Draft Persistence** | Refreshing mid-onboarding loses all 5 steps of input (name, avatar, university, department, courses) | 🟡 Medium | New Students |
| 18 | **Course Catalog — 83% Noise** | 30 of 36 published courses are empty shells or dev fixtures (`testcourse`, `E2E Integration Course`) | 🟠 High | Students |
| 19 | **Review Flashcards — 38% Missing** | 43 of 114 lectures with quizzes have zero review cards; students see an empty queue | 🟠 High | Students |
| 20 | **GDPR Export Incomplete** | Export downloads only 4 tables (profile, progress, events, achievements); misses notifications, uploads, friends, quiz answers, materials | 🟠 High | Compliance |
| 21 | **Cross-Account Course Visibility** | "Database Systems" appears with Edit/Archive/Delete controls in both Student and Professor accounts | 🟠 High (unconfirmed) | Security |
| 22 | **Two `.env` Files Disagree** | Root `.env` and `backend/.env` have conflicting feature flags; easy to deploy with wrong settings | 🟠 High | Developers |
| 23 | **Misleading Nginx Comments** | Comments say the proxy strips `/api/` prefix; it does not. "Fixing" to match the comment would break all API routes | 🟠 High | Developers |
| 24 | **Hidden ⌘K Search** | A fully built global search + command palette is shipped but turned off (missing feature flag) | 🟡 Medium | Everyone |
| 25 | **Mobile Clipping** | Comprehension button 61% clipped at ≤1054px; nudge badge overlaps hero text at 390px; professor editor unusable on phones | 🟡 Medium | Mobile Users |
| 26 | **Course Title Inconsistency** | Same course shows as "Datenbanksysteme" on 3 surfaces and "Database Systems" on 1 surface | 🟡 Medium | Everyone |
| 27 | **Breadcrumbs Show UUIDs** | Breadcrumbs display raw course/lecture IDs instead of names | 🟡 Medium | Everyone |
| 28 | **18 TypeScript Errors** | `tsc` fails with 18 pre-existing type errors across 11 files; typecheck cannot gate CI | 🟡 Medium | Developers |
| 29 | **~15 Loose Root Scripts** | One-off scripts like `fix_lectures.py` and `revert_policies.py` sit in the repo root touching DB policies | 🔵 Low | Developers |

---

## Detailed Explanations

### 1. Legal & GDPR (Cannot Launch Without Fixing)

The privacy policy at `/datenschutz` states in both English and German that AI processing happens locally using Ollama and that *"no data is sent to external AI services."* This is false. The backend configuration (`litellm/config.yaml`) routes all AI tasks to **Cerebras, Groq, and Google Gemini** — three US-based cloud services. Ollama only appears in requirements and test files; it is not on the AI processing path.

The Impressum page (`/impressum`) contains literal placeholder brackets: `[First and last name / Company name]`, `[Street and number]`, `[Postal code and city]`. German law (§5 TMG/DDG) requires a complete Impressum; an incomplete one is independently actionable.

Neither page is reachable from the website. All 13 footer links on the landing page are set to `href="#"` (dead links). German law requires legal pages to be reachable within 2 clicks from any page.

---

### 2. Professor Experience — Data Loss Risks

**The Save/Sign-Out Trap:** The lecture editor has a sticky action bar with the "Save Lecture" button. When a professor scrolls down, this bar slides under the global sticky header (76px tall, `z-index: 40`). A hit-test of 1,122 points over the Save button found that at maximum scroll, **0% of clicks reach Save** — 225 points hit "Sign Out", 225 hit "Settings", 304 hit the header itself. A professor trying to save their work gets logged out instead.

**Stale AI Overwrites:** Editing a single slide title and clicking Save triggers **20 separate database writes** (1 lecture PATCH, 15 slide PATCHes, 4 quiz question PATCHes — including slides and quizzes the professor never touched). Worse: after saving, clicking "Suggest Quiz" causes the AI to re-read a stale in-memory copy of all slides and write it back to the database, resurrecting text the professor had already deleted and saved over. This was verified live — the old `[AUDIT]` marker reappeared after being removed and saved.

**No Unsaved Changes Guard:** `window.onbeforeunload` is not registered. Navigating away, refreshing, or closing the tab discards all edits silently. No "you have unsaved changes" prompt exists.

**Quiz Suggestions Don't Persist:** "Suggest Quiz" returns HTTP 200 after ~11 seconds of processing, but the generated question is neither stored nor displayed. After reload, the slide still shows "No suggested quiz generated yet."

---

### 3. Student Experience — Performance & Broken Flows

**Infinite Profile Refetch:** The student dashboard refetches `/rest/v1/profiles` with an identical query in a tight loop. In 63 seconds, **182 requests** were recorded (rate: 2.48/s, median gap: 439ms). This single URL accounted for 182 of 213 total page resources. Root cause is likely a non-memoized dependency or unstable query key in the profile hook.

**Invisible Dashboard Hero:** On 4 out of 4 clean page loads, the main hero block (greeting, lecture stats, and the "Continue" button) rendered at `opacity: 0` with `animationName: "none"`. It's still clickable while invisible. Any scroll gesture fixes it. The framer-motion `useScroll` hook is measuring against a `position: static` container, which produces wrong scroll offsets.

**Broken Exam System:** The exam configuration page renders and lets students pick a question count and click "START EXAM". The button fires `POST /api/v1/exams/course/{id}/generate`, which returns **404 Not Found** because the exams router is not mounted on the deployed backend. The error is silently swallowed — no toast, no alert, no disabled state. The button just does nothing.

**Lecture Back-Button Crash:** Pressing the browser's Back button into a `/lecture/:id?slide=N` history entry strips the entire left pane (slide navigation, slide image, Previous/Continue buttons, comprehension checks) from the DOM. Only the right-side Notes/Chat pane survives. The user is stranded and must manually reload. Reproduced 2 out of 2 attempts.

**Slide URL Parameter Ignored:** The dashboard links to lectures with `?slide=6`, but the player ignores this parameter completely. Loading `?slide=1`, `?slide=6`, or `?slide=20` all land on the same slide (whichever was last viewed). Advancing slides also never updates the URL.

---

### 4. Onboarding (First-Run Experience for New Users)

**Step 5 is Useless for Most Users:** Onboarding Step 5 ("Add extra topics") filters the entire course catalog down to a single hardcoded German title: `c.title.trim().toLowerCase() === 'datenbanksysteme'`. Unless that exact course is published, the step shows "No public courses available right now." This is the last impression before a student enters the app.

**Old Product Name:** The activation screen after onboarding displays a badge reading **"Ascend Academy"** — the old product name. It's hardcoded in English at `ActivationOnboarding.tsx:110`, not in any locale file, so it also stays English when the app is set to German.

**No Draft Persistence:** All 5 onboarding steps (name, avatar, university, department, programme, semester, courses) live in React `useState` with nothing written until the final submit. A page refresh at Step 4 drops the user back to the beginning with everything lost.

**443 Universities in DOM:** The university picker mounts all 443 `[role=option]` elements at once with no virtualization.

**Onboarding Dead-End (Fixed):** Pressing Back on Step 1 and then clicking "Continue" again used to leave the user on a permanently blank screen (no controls, no text). This was found, fixed with a one-line change (`setStep(1)` in `beginJourney`), and verified with a regression test during the audit.

---

### 5. Upload Pipeline & AI Processing

**Silent Upload Failures:** The upload wizard's primary CTA ("Organize my material") has no `catch` block. When the server returns 429 (queue full), 401 (expired session), 500, or a network error, the promise rejects as an unhandled rejection. The `finally` block clears the spinner, so the button looks idle and ready — as if the click never happened. No toast, no error text, no state change.

**Stuck Jobs:** With the background worker stopped, Redis accumulated 159 orphaned jobs (against a max queue depth of 50). Every upload was permanently rejected with *"The processing queue is busy right now. Please retry in a few minutes"* — but nothing was draining, so retrying never helps. The `/health/ready` endpoint does not reflect this state, so monitoring stays green while uploads are 100% broken.

**Batch Synthesis Fails 100% of the Time:** The backend has an optimization to process slides in batches. The AI model returns data wrapped in an envelope (`{ "slides": [...] }`), but the code wraps the entire envelope in a list (`[{"slides": [...]}]`) instead of extracting the items. This means `page_to_idx` matches nothing, every batch raises an error, and all slides fall back to individual processing. A 10-slide lecture sends 10 API calls instead of 2, multiplying cost and latency by ~5×. The same bug existed in quiz regeneration. Both were **fixed during the audit** with a new `as_slide_item_list()` helper.

---

### 6. Security & Permissions (Open Questions)

**Cross-Account Course Visibility:** The course "Database Systems" appears with full Edit/Archive/Delete controls in both the Student's and the Professor's course manager. Other courses are correctly scoped (the Student's V101 doesn't appear for the Professor, and vice versa). Whether the **backend API** would actually accept a Student's delete request was deliberately not tested — no destructive call was issued. This needs a spike test on a throwaway account to determine if it's a UI-only leak or a real authorization hole.

**GDPR Data Export is Incomplete:** The Article 20 "Export My Data" button downloads a 42 KB JSON file containing exactly **4 tables**: `profile`, `progress`, `learning_events`, `achievements`. Tables that the app itself queries for this user but are **not included** in the export: `notifications`, `course_visits`, `user_roles`, materials/uploads, friends/friendships, quiz answers. A GDPR data-portability export should cover all personal data held.

**Account Deletion Unverified:** The "Delete My Account" button exists with correct warning copy, but was deliberately not clicked to protect the live test account. The actual cascade behavior remains untested.

---

### 7. Configuration & Developer Pitfalls

**Two `.env` Files Contradict Each Other:** The root `.env` sets only `FEATURE_STUDY_GUIDE=1`, which reads as "exam mode and review engine are off." The `backend/.env` file sets `FEATURE_REVIEW_ENGINE=1`, `FEATURE_EXAM_MODE=1`, `FEATURE_STUDENT_UPLOADS=1`, `FEATURE_STUDY_GUIDE=1`. The backend loads `backend/.env`, so those features are actually live — but a developer reading the root `.env` would get the wrong answer about the app's current state.

**Misleading Nginx Comments:** `nginx.conf` line 26 says: *"Proxy /api/* to the backend, **stripping the /api prefix**."* It does **not** strip the prefix — `proxy_pass $backend` uses a variable, which disables nginx's URI-rewrite. The actual behavior is correct (the backend expects `/api/v1/...`). If anyone "fixed" nginx to match its own comment by adding a trailing slash to `proxy_pass`, every API route in production would break instantly.

**Hidden Global Search:** A complete ⌘K command palette and global search bar are fully built in the codebase. They are disabled because `VITE_FEATURE_GLOBAL_SEARCH` is absent from both `.env` and `.env.example`, so the flag defaults to off. The backend route `/api/v1/search` is also not mounted.

**Dead Environment Variable:** `VITE_AUTH_URL="http://localhost:4000"` exists in `.env` but nothing listens on port 4000 and the variable is referenced nowhere in the codebase.

**18 Pre-Existing TypeScript Errors:** Running `tsc -p tsconfig.app.json --noEmit` produces 18 errors across 11 files. Most are framer-motion `Variants` type mismatches (`type` widening to `string` instead of literal `"spring"`). This means the typecheck cannot be used as a CI gate until these are fixed.

---

### 8. Mobile & Responsive Issues

**Comprehension Button Clipped:** At viewport widths ≤1054px, the third comprehension-check answer button (`❌ Confused`) is 61% hidden by its parent's `overflow: hidden`. At 1534px it's fully visible.

**Mobile Hero Overlap:** At 406px (phone), the "3 people to meet" nudge badge paints directly on top of the greeting text and h1 heading, overlapping by 244×14px and 124×13px respectively.

**Professor Editor on Mobile:** At 390px, the two-pane editor layout does not collapse. The slide sidebar keeps its full-size thumbnails, leaving ~130px for the editor. The slide title value clips to "Datal" and completeness label clips to "complet".

---

### 9. Codebase Housekeeping

**Dead Components:** `AppSidebar.tsx` is imported nowhere and has a stale navigation list. `Insights.tsx` exists but is no longer routed (replaced by `/ascent`). Three live code locations still link to the old `/insights` path.

**Loose Root Scripts:** The repo root contains ~15 one-off scripts (`fix_lectures.py`, `apply_policies.py`, `revert_policies.py`, `get_policies.py`, `check_schema.py`, `restore_courses.py`, `test_debug.py`, etc.) plus `policies.txt` and `test_rls.sql`. Scripts that touch database policies sitting in the open repo root are a footgun.

**Inconsistent Brand:** Three different logo glyphs appear across the landing page (cyan layers), auth page (purple circle layers), and impressum page (graduation cap). The language toggle is also styled differently on `/impressum`.

---

### 10. What Works Well (Credit Where Due)

**AI Tutor:** Answers are accurate, grounded in slide content, and explicitly flag when a question goes beyond the lecture scope.

**Gamification / Ascent System:** Level progression, XP, streaks, trophies, and the full interactive skill-tree constellation are all functional and polished.

**Professor Analytics:** Course → Lecture → Insights drill-down with actionable framing ("100% of students dropped off after slide 7", "4 students are disengaging"). Verified **zero student names or emails** in the DOM — aggregate only.

**"Ask Your Data" (Natural Language Analytics):** A professor asked "Which slide had the highest drop-off rate?" and got a correct ranked table with a bar chart, consistent with the basic analytics view. Includes an honest caveat: "AI answers can be off; spot-check important numbers."

**Document Processing Pipeline:** A single 10-slide PDF (487 KB) produced a complete lecture with accurate title, description, 10 slides, 8 quiz questions, and 8 review cards. The content-hash deduplication, atomic quota claim, and file validation (extension + magic-byte + size) are all solidly built.

**GDPR Erasure Implementation:** Data access, erasure, and JSON export features exist in Settings and are unit + integration tested (`test_gdpr_erasure_cascade.py`). The export mechanism works end-to-end — it just needs more tables included.

**Review Card Idempotency:** Card generation deduplicates on `content_hash` and uses a Redis lock to prevent concurrent duplicate runs. The generation logic itself is correct — the 38% gap is a job-scheduling issue, not a logic bug.

**Professor Archive:** Best empty state in the app — clear counts, an explanation of what archiving does, and how to archive.
