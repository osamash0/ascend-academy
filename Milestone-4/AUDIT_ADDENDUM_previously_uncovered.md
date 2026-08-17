# Audit Addendum — closing the "Not covered" items

**Session:** authorized write-testing on `prof@admin.com` (uid `97be3636…`), live build at `learnstation.duckdns.org`.
**Authorization used:** "AI generation + Save, with revert" and "P3 reversible write" (the latter still pending an account switch — §4).
**Data integrity:** all test edits were reverted and **verified restored by hard reload** — see §3.

> **Route coverage is now complete.** The last unreachable route was reached by recovering a `batch_id` from the app's own jobs poll: `13ce1e17-e562-45a8-a25b-f59188d2d6aa`. **All ~30 declared client routes have now been exercised.**

---

## 1. New findings

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| **N1** | 🔴 | **Save writes every slide, and a later AI action re-writes them from stale client state — silently resurrecting values that were already changed and saved.** Editing one field triggers a fan-out of un-transacted writes; a subsequent AI generation replays a stale in-memory copy over the database. | Write only what changed, in one transaction; never replay a cached slide set. | **Write amplification:** changing *one* slide's title → **20 writes**: `PATCH /rest/v1/lectures` ×1, `PATCH /rest/v1/slides` ×**15**, `PATCH /rest/v1/quiz_questions` ×**4** (I never touched a quiz), all 204, **19.4 s cumulative**, slowest single write 2088 ms. **Resurrection:** I set the title to `…Basics [AUDIT]`, saved (204s), then reverted to `Database Systems Basics`, saved (3 writes, 204s), and **verified by hard reload** — `titleExactlyOriginal: true`, `auditMarkerGone: true`. I then clicked *Suggest Quiz* on that slide, which fired `POST /api/v1/ai/generate-quiz` + **14 × `PATCH /rest/v1/slides`**. After reload the title read **`Database Systems Basics [AUDIT]` again** in both the Slide Editor field and the Quiz Suggestions list. The reverted-and-saved value was overwritten by the stale copy. **Restored again and re-verified clean** (§3). |
| **N2** | 🟠 | **No unsaved-changes protection of any kind.** A dirty editor gives no warning on reload, tab close, or in-app navigation; the edit is silently discarded. | Register a `beforeunload` guard and block in-app route changes while dirty. | With a modified Slide Title in the field: `typeof window.onbeforeunload === 'function'` → **false**; no dirty marker anywhere in the DOM (`/unsaved|not saved/` → no match). Clicked the `Dashboard` nav item → navigated away immediately, `window.confirm` interceptor recorded **0 calls**, and the change was gone on return. **Combined with P1** (Save is 0 % clickable when scrolled, with clicks landing on `Sign out`) this is a complete data-loss path: scroll → aim for Save → hit Sign out → edits gone, no warning. |
| **N3** | 🟠 | `Suggest Quiz` reports success but the generated question is **not persisted or displayed**. | Persist and render the suggestion, or surface the failure. | `POST /api/v1/ai/generate-quiz` → **200 in 11.3 s**, followed by 14 × `PATCH /rest/v1/slides` → 204. UI showed "AI is crafting a recommended quiz question…" and the card then disappeared from the list. After a hard reload, slide 1 shows **"No suggested quiz generated yet."** with the `Suggest Quiz` button again — same state as before. 37 `Suggest Quiz` buttons present across the tab, i.e. **0 of 54 slides hold a suggestion** after a successful generation. |
| **N4** | 🟠 | Batch review claims more lectures than it renders. | Counts must match. | `/professor/upload/batch/13ce1e17…/review` header: **"13 lectures ready"**. Rendered cards: **12** (`Open editor` ×12, `Done reviewing` ×12). Off by one. |
| **N5** | 🟠 | Batch review **silently omits in-flight and stuck items**, so a batch looks complete when it isn't. | Show queued/failed members of the batch with their state. | Two jobs carrying the **same `batch_id` `13ce1e17…`** are stuck `status:"extracting"` with **`error: null`** (lecture ids `21e0be6b…`, `c895b00d…`). They appear **only** in the header Uploads dropdown (`09-pq.pdf`, `05-boolean-functions-sboxes.pdf`); `main.innerText` on the batch review page contains neither filename. A professor reading that page would conclude the batch finished. |
| **N6** | 🟡 | Three lectures in one batch carry the **identical title**, making the review cards indistinguishable. | Disambiguate (source filename, slide count, index). | Heading-frequency scan of the batch page: `"Advanced Topics in Cryptography"` × **3**, against 11 distinct titles for 12 cards. Two of them differ only by body stats (44 slides/5 quiz questions vs 79 slides/6 quiz questions). Also confusable with a fourth, `"Advanced Topics in Cryptology"`. |
| **N7** | 🟡 | **Extends P4.** The English/German split is per-component, not per-page — five surfaces, two naming schemes. | One canonical title. | **English:** `/professor/courses` card headings; professor dashboard hero Course dropdown ("Advanced Topics in Cryptography / System Software and Computer Communication / SWT / Database Systems"). **German (stored value):** `/professor/upload` Course dropdown; Edit-course modal `Title` field; lecture editor → Lecture tab → Course dropdown ("Datenbanksysteme / Systemsoftware und Rechnerkommunikation"). |
| **N8** | 🟡 | The professor **lecture editor does not collapse on mobile** — the two-pane layout is retained and the editor pane becomes unusable. | Collapse to one pane with a slide-list drawer below `md`. | At a 390 px window (viewport 406×656): the slide sidebar keeps `SLIDES (54)` plus full-size thumbnails, leaving roughly 130 px for the editor. Screenshot shows the Slide Title value clipped to **"Datal"**, the completeness label clipped to **"complet"**, and "Slide Editor" wrapping onto three lines. `documentElement.scrollWidth` 485 vs viewport 406, though `body{overflow-x:hidden}` clamps it so there is no sideways scroll (same non-issue as the student side — not filed separately). |
| **N9** | 🔵 | **P2 confirmed at the API layer**, not just the UI. | Set an error and a terminal state on stalled jobs. | `/api/v1/upload/jobs` returns both stuck jobs with `status:"extracting"` and **`error: null`** after **15+ minutes** (badge read 2 at 23:45 and still 2 at 00:02). Nothing in the payload marks them as failed, so no client could surface a failure even if it wanted to. |

---

## 2. Verified working (previously untested)

- **`Save Lecture` genuinely persists.** `PATCH /rest/v1/lectures` → 204 and `PATCH /rest/v1/slides` → 204; the change survived a hard reload. This matters: it confirms **P1 is purely click-interception**, not a broken save. (I did **not** click Save while it was covered — the hit-test showed those clicks land on `Sign out`, so doing it would have ended the session.)
- **`/professor/upload/batch/:batchId/review` renders well** — per-lecture cards with slide counts, quiz-question counts, `N flagged` badges (3 / 1 / 2 flagged), `Open editor`, `Done reviewing`, and a `Done reviewing all` action.
- **`POST /api/v1/ai/generate-quiz` is live and responds 200** — the AI pipeline is reachable; the defect is in persistence/display (N3), not availability.
- **Edit-course modal `Cancel` is clean** — re-verified, no write emitted.
- **Professor `/profile` reports role "Professor"** (contrast with the student account's "Student").
- **Analytics remain PII-free** — re-checked, 0 emails and 0 student names in the DOM.

---

## 3. Data-integrity statement

I made **four** authorized writes to lecture `126bb3c8…` ("Basics", slide 1 title) and reverted all of them. Final verified state, after a hard reload:

| Field | Expected | Actual |
|---|---|---|
| Slide 1 title | `Database Systems Basics` | ✅ exact match |
| Slide 1 content length | 44 chars | ✅ 44 |
| AI summary length | 599 chars | ✅ 599 |
| `[AUDIT]` anywhere in page | absent | ✅ 0 occurrences |
| Slide count | 54 | ✅ 54 |

**Note the extra round-trip:** the first revert was verified clean, then N1's stale-write resurrected `[AUDIT]`; I re-reverted and re-verified. Nothing else in your content was modified.

**I deliberately stopped further AI-generation testing after discovering N1.** Each generation fires 14+ slide writes from a cached copy, so every additional click carried a real risk of overwriting more of your slides with stale data. `Generate Summary`, `Auto-Generate All Quizzes`, `Generate cross-slide quiz`, and `Generate with AI` therefore remain untested — that is a deliberate stop, not an oversight. `Generate Summary` was also skipped because it would overwrite a 599-char summary I could only restore by retyping.

---

## 4. Still not covered

| Item | Status |
|---|---|
| **P3 cross-tenant write test** | **Ready to run — needs you to sign back in as the student.** Plan: as `abdul@test.com`, attempt a reversible change (course colour) on "Database Systems" and record whether the API accepts or rejects. This is the one test that converts P3 from "UI exposes destructive controls to two accounts" into a definite yes/no on backend enforcement. |
| `Generate Summary`, `Auto-Generate All Quizzes`, `Generate cross-slide quiz`, `Generate with AI` | Deliberately stopped — see §3. Re-test after N1 is fixed. |
| `Archive`, `Delete`, `New Course`, per-slide delete, `Replace PDF` | Not authorized this round (you chose real-lecture testing over the throwaway-course option). The throwaway-course route remains the safe way to cover these. |
| `Done reviewing` / `Done reviewing all` | State mutations on your batch — not authorized, not clicked. |
| Account deletion end-to-end | Still requires a disposable account. |
| `/exam/take`, `/exam/report` | Still blocked by the 404 (main-plan 4.1). |
| Review-session grading | Still 0 cards due. |
| Professor mobile beyond the editor | Window kept snapping back to 942 px with the side panel open; only the editor was captured at 390 px. |

---

## 5. Fix-plan updates

| Session | Fixes | Value | Effort | Risk | Notes |
|---|---|---|---|---|---|
| **U — Scope the save write-set + kill stale replay** | **N1** | ★★★★★ | M | **High** | **New highest-priority professor fix — this one loses data.** Two parts: (a) diff before writing so a one-field edit emits one write, not 20; (b) make AI actions re-read current slide state instead of replaying a cached array. Part (b) is the data-corruption half — do it first even if (a) waits. Acceptance: edit one field → exactly one `PATCH`; generate a quiz → zero unrelated slide writes. |
| **V — Unsaved-changes guard** | N2 | ★★★★☆ | S | Low | `beforeunload` + a router block while dirty, plus a visible dirty marker. Pairs naturally with **O** (the P1 header fix) — together they close the scroll→Sign out→silent-loss path. |
| **W — Quiz suggestion persistence** | N3 | ★★★★☆ | M | Med | Generation returns 200 but nothing is stored or shown. Depends on **U** — the 14 stale PATCHes may be what's clobbering the suggestion, so fix U first and re-test before writing new code. |
| **X — Batch review truthfulness** | N4, N5, N6 | ★★★★☆ | S–M | Low | Reconcile the count with the rendered list; include queued/stuck batch members with state; disambiguate duplicate titles. Ships with **R** (upload timeouts) since both need a real job-state model. |
| **Y — Editor responsive collapse** | N8 | ★★★☆☆ | M | Low | Collapse the two-pane editor below `md`. Independent CSS/layout; no collisions. |

### Merge order (revised)
**U(b) → O → V → U(a) → W → R+X → Y**, with the earlier main-plan order otherwise unchanged. Rationale: stop the corruption, then make Save reachable, then stop silent discards, then de-amplify, then fix suggestions, then batch/upload truthfulness, then layout.

**Collisions:** **U** and **W** touch the same slide-save path — same session or strictly sequential, never parallel. **X** and **R** share the job-state model. **V** touches the editor shell that **O** also touches — sequence O then V. **Y** is isolated.
