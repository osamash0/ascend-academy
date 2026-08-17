# Learnstation — Professor Account Audit

**Target:** `https://learnstation.duckdns.org` (live deployed build)
**Account:** `prof@admin.com` — uid `97be3636-98bc-4cbe-9928-cc400556172e`, created 2026-05-26. Header renders identity as **"Professor"**.
**Data:** 4 courses (Advanced Topics in Cryptography 12 lectures, System Software and Computer Communication 1, SWT 6, Database Systems 10), 0 archived items, 2 uploads in flight.
**Viewport:** 1534×835. **Date:** 2026-08-17.
**Method:** live browser drive, DOM measurement, hit-test grids, network/console capture. **No mutations performed** — see §4.

> **Correction to the prior report.** During the earlier student-session audit I observed a "Professor" header while believing I was still on the student account, and inferred the app renders a professor persona for Students. That inference is **withdrawn** — you had already signed in as `prof@admin.com` at that point. What still stands from student finding 7.2 is narrower and was verified against a header reading "Abdulah": the **student** session did load `/professor/courses` and the `/professor/lecture/:id` editor. See P3 below, which now has much stronger evidence.

---

## 1. Professor route map

The professor shell has its own routes, **four of which were missing from the earlier bundle scan** (`/professor/dashboard`, `/professor/archive`, `/professor/analytics`, `/professor/upload`). Corrected map:

| Route | Reached | Notes |
|---|---|---|
| `/professor/dashboard` | ✅ | Hero + lecture rail + Create Lecture |
| `/professor/courses` | ✅ | Course manager, Edit/Archive/Delete per course |
| `/professor/courses/:courseId` | ✅ | Renders as an **Edit course modal** over `/professor/courses`, not a separate page |
| `/professor/archive` | ✅ | Archived courses/lectures |
| `/professor/analytics` | ✅ | Course → lecture → insights drill-down |
| `/professor/analytics/:lectureId` | ✅ | "What needs your attention" insights |
| `/professor/analytics/:lectureId/advanced` | ✅ | Lecture analytics dashboard + Ask Your Data |
| `/professor/lecture/:lectureId` | ✅ | Full slide editor, 3 tabs |
| `/professor/upload` | ✅ | Create Lecture form |
| `/professor/upload/batch/:batchId/review` | ⛔ | **Not reached** — no batch id is exposed anywhere in the UI, including the uploads panel (`a[href*=batch]` → 0 matches) |

---

## 2. Findings

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| **P1** | 🔴 | In the lecture editor, scrolling makes **"Save Lecture" completely unclickable** — it slides under the sticky global header. The clicks land on **Sign out** and **Settings** instead. A professor who edits slides, scrolls, and clicks Save can sign themselves out and lose the work. | The editor action bar must stay below the header, or the header must yield. | 1122-point hit-test grid over the Save button. **At `documentElement.scrollTop = 0`:** button at `top:135`, **99.1 % reachable**. **At `scrollTop = 121` (the page's maximum scroll):** button at `top:14`, **0 % reachable — 0/1122 points**. Interceptors: `HEADER` 304 pts, `a[/settings]` 225, `btn:"Sign out"` 225, `DIV` 216, `btn:"Notifications (2 unread)"` 152. Global header is `position:sticky; top:0; height:76; z-index:40`; the editor bar sits at `top:14`. Visually confirmed — screenshot shows "82% complete / Exit / Preview / Save Lecture" faded behind the nav icons. |
| **P2** | 🟠 | Uploads stick in `extracting` indefinitely with no timeout, no error, and no retry. Two of the professor's **own real PDFs** are currently stuck. | Time out, surface a failure, offer retry. | Uploads panel shows `09-pq.pdf — extracting` and `05-boolean-functions-sboxes.pdf — extracting`. The uploads badge read **2** at 23:45 and still **2** at 23:55 — **≥10 minutes** with no state change and no error affordance. Independently corroborates the student-side finding (test PDF spun >90 s / 38 job polls, advertised "~30 seconds"), now reproduced on real professor content. |
| **P3** | 🟠 | The course manager is **not fully owner-scoped**: one course appears with full `Edit / Archive / Delete` in **two different accounts**. | A course should be manageable only by its owner (or explicit co-owners). | `prof@admin.com` `/professor/courses` lists **"Database Systems — 10 lectures — 9 LP - 4. Semester"** with Edit/Archive/Delete. `abdul@test.com` (uid `a3261aae…`, role rendered **Student**) `/professor/courses` listed **the same course, same lecture count, same description**, also with Edit/Archive/Delete. The other courses **are** correctly scoped — the student's V101 and "Intro to Linear Algebra (Student Notes)" do not appear for the professor, and the professor's Cryptography/SWT do not appear for the student — which makes the shared row anomalous rather than by design. **Backend enforcement untested** (no mutation issued), so this is scoped as "UI grants both accounts destructive controls over one course"; whether the API would honour a student's DELETE is the open question. |
| **P4** | 🟡 | One course renders under **two different names** depending on the view. The courses-list card translates the title; every other surface shows the stored value. | One canonical title, or translate consistently. | Same account, same session, within ~3 minutes: `/professor/courses` card heading → **"Database Systems"** and **"System Software and Computer Communication"**. `/professor/upload` Course dropdown → **"Datenbanksysteme"** and **"Systemsoftware und Rechnerkommunikation"**. Edit-course modal `Title` field (the stored value) → **"Datenbanksysteme"**. Lecture editor → Lecture tab → Course dropdown → **"Datenbanksysteme"**. So **3 of 4 surfaces show the German stored title; only the card list translates.** This is the root cause of the student-side confusion where the dashboard said "Datenbanksysteme" and the library said "Database Systems". |
| **P5** | 🟡 | Lecture counts for one course disagree across three surfaces. | One count. | "System Software and Computer Communication": student Discover drawer → **16 LECTURES**; student course view → **0/0 LECTURES, "No lectures in this course yet."**; professor course manager → **1 lecture**. |
| **P6** | 🟡 | Professor breadcrumbs print the raw lecture/course UUID with hyphens as spaces. | Show the title, which the page renders correctly right below. | `Home > Lecture > 126bb3c8 6f69 4184 9ceb 9ccbfd4b3609` while the page header reads "Basics". Same on `/professor/analytics/:id` and `/advanced`. Same defect class as the student-side breadcrumbs. |
| **P7** | 🟡 | The professor dashboard hero features a lecture with **0 slides** and labels it "ACTIVE PROTOCOL". | Don't headline an empty lecture, or mark it as a draft needing content. | Hero: "Post-Quantum Cryptography · ACTIVE PROTOCOL · **SLIDES 0** · CREATED 02/08/2026", course "Advanced Topics in Cryptography", with a `View Analytics` primary CTA — analytics for a lecture with no slides. |
| **P8** | 🟡 | `Pipeline Diagnostics` expands to a **table with only a header row** — no data, no empty state. | Render "no telemetry for this parse" or hide the panel. | Expanded panel shows `# / Route / Reason / Words / Img cov / Alpha` and zero rows; `[...table.querySelectorAll('tr')]` returns only the header. Copy claims "Routing telemetry for the most recent parse of this PDF" for a lecture whose PDF (`01 DBS Basics.pdf`) is attached and parsed. |
| **P9** | 🟡 | Destructive controls sit immediately beside primary actions with no separation. | Separate destructive actions, or require confirmation. | Dashboard hero: a red trash icon **adjacent** to the `View Analytics` CTA (icon row: eye / gear / trash). Slide Editor: a red trash icon in the same control row as `View Original / Preview / Insert After`. Not clicked — confirmation behaviour unverified. Combined with P1 (click interception near the header) the blast radius is real. |
| **P10** | 🔵 | The professor shell renders student gamification: `Lvl 1 · 50 XP` next to the "Professor" identity. | Hide XP/level for professor accounts, or explain what it means for them. | Header on every professor route: "Professor / Lvl 1 · 50 XP". (This coincidentally matched the student account's own "Lvl 1 · 50 XP", which is what led me to misread the session earlier.) |

---

## 3. Verified working

Deliberately recorded so nobody re-audits it.

**The three worst student-side defects do NOT affect the professor shell:**

| Student finding | Professor result |
|---|---|
| 1.1 🔴 `/profiles` infinite refetch (182 calls/63 s) | **Not present.** `/professor/dashboard`: **1** profiles call in 23 s. Only repeat is `/api/v1/upload/jobs` ×3 (legitimate job polling). |
| 1.2 🔴 Hero renders at opacity 0 until scroll | **Not reproducing.** Hero rendered visible on load (greeting, title, stats, CTA). |
| 1.3 🟠 Header steals 53.7 % of the account-menu button | **Not present** in the professor shell at 1534 px — header leaf-overlap scan returned **0 overlaps**. (The editor action bar is a separate, worse case — P1.) |

**Professor features that work well:**

- **`/professor/analytics` drill-down** — Course → Lecture → Insights, with actionable framing: "100 % of students dropped off right after slide 7", "4 students are disengaging — low progress and not asking for help", median-time-per-slide flags. Cross-checked for privacy: **aggregate only — 0 email addresses and 0 student names in the DOM**; the only UUID present was the lecture's.
- **Advanced lecture analytics** — Engaged Students 6, Global Score Avg 0 %, Total Events 5, Total Interactions 1, plus a Benchmarks section.
- **"Ask Your Data"** — natural-language analytics. Asked "Which slide had the highest drop-off rate?" → returned a summary ("Slide #8 — 'Historical Use Cases of Database Systems' has the highest drop-off rate at 100%"), an `INTENT: TOP DROPOFF SLIDES` label, a ranked 5-row table, and a bar chart. Consistent with the basic view's "dropped off right after slide 7" (slide 7 → slide 8). Carries an honest caveat: "AI answers can be off; spot-check important numbers against the dashboards."
- **`/professor/archive`** — best empty state in the app: `COURSES (0)` / `LECTURES (0)`, plus an explanation that archived items stay intact and how to archive.
- **Lecture editor** — 54 slides with thumbnails and per-slide completeness (75 %/100 %), an 82 % overall indicator, three working tabs (Slide Editor / Quiz Suggestions / Lecture), per-slide Title + Content with live character count, AI Assistant (Generate Summary / Generate Quiz), AI Summary marked `AI Generated`, and per-slide View Original / Preview / Insert After.
- **Quiz Suggestions tab** — per-slide cards with correct "No suggested quiz generated yet." empty states, per-slide `Suggest Quiz`, and `Auto-Generate All Quizzes`. Note: "suggested quiz" is a *draft* concept distinct from the published quizzes the student player counts ("0/16"), so the empty state here is **not** a contradiction — not filed.
- **Lecture tab** — Course assignment, Worksheets (0) with upload, Practice Sheets (auto-generate from quiz questions / manual authoring), Replace PDF Slides showing "Current PDF: 01 DBS Basics.pdf", Cross-slide quiz generation.
- **`/professor/upload`** — rich form: Lecture Title, Description, Course, **6 extraction engines** (Auto / LlamaParse / MinerU / OpenDataLoader / MarkItDown for PPTX / PyMuPDF fallback), PDF parsing mode (AI parsing / Skip AI), Single file / Multiple files.
- **Edit-course modal** — Title, Description with `Generate with AI`, 8-colour picker, Cancel/Save. **Cancel verified clean** — modal closed, nothing persisted.
- **`/admin/dashboard` is properly gated** — redirects to `/dashboard` for a non-admin. Worth contrasting with P3: admin gating exists, course-ownership scoping is where the gap is.

---

## 4. Not covered / deliberately not exercised

| Item | Why |
|---|---|
| `/professor/upload/batch/:batchId/review` | No batch id exposed in the UI or the uploads panel. |
| `Save Lecture`, `Delete`, `Archive`, `New Course`, per-slide delete, `Replace PDF` | **Destructive or persistent mutations on live content — not clicked.** P1's severity rests on hit-testing, not on attempting a save. |
| `Generate Course Insights`, `Auto-Generate All Quizzes`, `Suggest Quiz`, `Generate cross-slide quiz`, `Generate from quiz questions`, `Generate with AI` | AI generation actions that write to the professor's real courses. Not triggered. |
| Unsaved-changes navigation guard | Would require editing real slide content to test. `window.onbeforeunload` was unset in the clean state. **Untested — recommend checking, given P1 makes losing an edit easy.** |
| Cross-tenant *mutation* (the decisive P3 test) | Would require issuing a write as the student against the professor's course. Not done. |
| Professor mobile layout | Not tested — P1 is likely worse at narrow widths. |
| Professor `/settings`, `/profile` | Shares the student shell; audited there. |
| `Ask Your Data` → "Show me students whose quiz accuracy is below 40%" | Skipped deliberately — would surface individual student records. |

---

## 5. Fix plan additions

Extends the numbering in `LEARNSTATION_FULL_APP_AUDIT.md` §12.

| Session | Fixes | Value | Effort | Risk | Notes |
|---|---|---|---|---|---|
| **O — Editor action bar vs sticky header** | P1 | ★★★★★ | S | Low | Highest-value professor fix. Give the editor bar a `top` offset below the 76 px header, or raise its z-index above 40 and add `pointer-events` isolation. **Acceptance: hit-test grid ≥99 % reachable at maximum scroll**, not just at scrollTop 0. Note the failure mode is data-loss-adjacent (clicks hit Sign out), so treat as urgent. |
| **P — Course ownership scoping** | P3 | ★★★★★ *if confirmed* | ? | ? | **Spike first**, same spike as M in the main plan. Determine why one course row is visible to two accounts — orphaned `user_id`, seeded data, or missing owner filter. Then decide gating. Security-sensitive. |
| **Q — Canonical course titles** | P4, P5 | ★★★★☆ | M | Low | Pick one source of truth. Currently 3 of 4 surfaces show the stored German title and the card list translates — so removing the card-list translation is the smaller change. Fixing this also cleans up the student-side name mismatch and probably the count discrepancies. Merge with main-plan session **I**. |
| **R — Upload pipeline timeouts (professor + student)** | P2 | ★★★★☆ | M | Low | Same root cause as main-plan **H** — do them together. Two real professor PDFs are stuck right now, so there is live impact. Add timeout, failure state, retry, and surface the stuck jobs in the uploads panel. |
| **S — Destructive-action separation** | P9 | ★★★☆☆ | S | Low | Move trash icons out of primary control rows and require confirmation. Do **after O**, since O reduces the mis-click surface. |
| **T — Professor polish** | P6, P7, P8, P10 | ★★☆☆☆ | S | Low | Breadcrumb titles (shared fix with main-plan **L**), don't headline a 0-slide lecture, empty state for Pipeline Diagnostics, hide XP/level for professors. |

### Merge order and collisions
1. **O** first — isolated to the editor layout, unblocks safe professor use.
2. **R** with main-plan **H** (same upload pipeline code — do not split).
3. **Q** with main-plan **I** (same aggregate/naming selectors — **collision, serialize**).
4. **S** after O.
5. **T** with main-plan **L** (both touch breadcrumbs — **collision, serialize**).
6. **P** spike any time; produces a decision, not a diff.

**File-collision flags:** P4/P5 (Q) and main-plan 2.3/2.4/2.6.1 (I) touch the same course-aggregate and title-resolution code — one session, not two. P6 (T) and main-plan 2.2 (L) are the same breadcrumb component. P2 (R) and main-plan 8.1 (H) are the same pipeline. O is isolated. P is a spike.
