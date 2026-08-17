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
