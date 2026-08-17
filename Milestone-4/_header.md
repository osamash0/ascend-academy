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

### 0.2 The twelve open blockers — 8 reconciled + 4 source-level

Ordered by what I would fix first, not by discovery order. M1–M3 share a row: they are one legal workstream.

| ID | Blocker | Why it ranks here |
|---|---|---|
| **M4** | Professor save writes every slide, and a later AI action re-writes them from stale client state — silently resurrecting values already changed and saved | **The only finding actively destroying user data.** Fix before anything else. |
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
