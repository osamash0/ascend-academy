# Learnstation — Full App Audit Report

**Audit date:** 2026-08-17
**Branch:** `fix/s6-continuous-security-ci`
**Method:** live browser walkthrough (Chrome, `localhost:5173`) + backend introspection (`localhost:8000`) + static analysis
**Status:** 🟡 **Part 1 of 3 complete** — public/marketing surface + config + API contract. Authenticated app (student, professor, admin) pending login.

Severity key: 🔴 Blocker · 🟠 High · 🟡 Medium · 🔵 Low / polish

---

## 0. Executive summary

| # | Area | Verdict |
|---|---|---|
| 1 | Legal / GDPR compliance | 🔴 **Not launchable.** Privacy policy contains a materially false statement about AI processing; Impressum is unfilled placeholder text and unreachable. |
| 2 | Marketing site (`/`) | 🟠 Renders well, but 2 of 6 feature cards never become visible, and every footer link is dead (`href="#"`). |
| 3 | API contract | 🟡 Works, but two path conventions coexist (44 legacy vs 23 versioned call sites) held together by a 307 redirect shim. |
| 4 | Config hygiene | 🟠 Two competing `.env` files with contradictory feature flags; a dead env var; API docs disabled. |
| 5 | Built-but-dark features | 🟡 Global search / ⌘K command palette is fully built but shipped off. |

**Everything above is fixable in four sessions, ~4 hours, with no product-logic changes — see [§7 Delivery plan](#7-delivery-plan--quick-win-sessions).** The highest-severity findings here happen to also be the cheapest to fix; start with S1.

---

## 1. 🔴 Legal & GDPR — launch blockers

The single most serious finding in this audit is #1.1. This is genuine legal exposure for a German-market product, not a nitpick.

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 1.1 | 🔴 | **Privacy policy states a falsehood — in both languages.** [`/datenschutz`](src/pages/Datenschutz.tsx) §4 Processors says: *"Ollama (local) — AI summaries and quiz questions are processed locally on the server. **No data is sent to external AI services.**"* The German text in [`de/legal.json`](src/i18n/locales/de/legal.json) repeats it — *"Es werden keine Daten an externe KI-Dienste gesendet."* — and **that** is the legally operative version for a DACH market. In reality [`litellm/config.yaml`](litellm/config.yaml) routes every LLM stage (`stage-text`, `stage-vision`, `stage-outline`, `stage-deck`) to **Cerebras, Groq and Google Gemini** — three external, US-based providers. Ollama appears only in `requirements.txt` and OCR fallback tests; it is **not** on the LLM path. | List Cerebras, Groq and Google as processors, with a DPA reference and an Art. 44–46 international-transfer basis for each. Remove the Ollama claim. Fix EN **and** DE together. Then have a lawyer review. | Verified: `litellm/config.yaml` model list; `grep -rli ollama backend src` → only requirements + tests; `grep -i ollama de/legal.json` |
| 1.2 | 🔴 | **Impressum is unfilled boilerplate, in both locales.** [`/impressum`](src/pages/Impressum.tsx) renders literal placeholders — EN: `[First and last name / Company name]`, `[Street and number]`, `[Postal code and city]`; DE: `[Vor- und Nachname / Firmenname]`, `[Straße und Hausnummer]`, `[PLZ und Ort]` — and the same again under §55(2) RStV. | Real name, address, contact. §5 TMG/DDG requires a *complete* Impressum; an incomplete one is independently `abmahnbar` in Germany. | Screenshot of live page; `grep -oE "\[[^]]+\]"` on both `legal.json` files |
| 1.3 | 🔴 | **Both legal pages are unreachable.** `/impressum` has **zero** inbound links — every footer link on the landing page is `href="#"` (13 of them, incl. the one labelled "Privacy"). `/datenschutz` is linked only from a consent line inside [`Auth.tsx:428`](src/pages/Auth.tsx:428). | Impressum + Datenschutz must be reachable from every page footer. German law requires them to be "easily recognisable and directly reachable" (max ~2 clicks). | `document.querySelectorAll('footer a')` → all 13 hrefs are `#` |
| 1.4 | 🟡 | Datenschutz says *"Last updated: March 2026"* — 5 months stale, and it predates the LiteLLM migration that invalidated §4. | Bump on every substantive change; make the date the real thing that gates review. | Live page text |
| 1.5 | 🔵 | §4 hedges: Supabase data *"is stored on EU servers (depending on project configuration)"*. "Depending on configuration" is not a lawful disclosure — the user cannot tell what applies to them. | State the actual region of project `lkiiideqjoiksnycgplc` definitively. | Live page text |

**Verified as OK (no action):** §6 promises data access, erasure and JSON export "in the settings" — all three genuinely exist and are unit + integration tested (`Settings.tsx:635,665`, `backend/services/account_service.py`, `test_gdpr_erasure_cascade.py`). Good.

---

## 2. 🟠 Marketing site (`/`)

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 2.1 | ⚠️ **RETRACTED — unverified, probably an artifact** | I originally reported "2 of 6 feature cards are invisible": "Secure Vault" and "Universal Access" measured `opacity: 0` / `0.068` while fully in the viewport, and a screenshot showed a blank scroll-screen. **That measurement is not trustworthy.** Later in the audit I probed `requestAnimationFrame` in the same browser context and got **0 frames in 15 seconds** — rAF was fully throttled because the driving tab was backgrounded (in fact eventually closed). framer-motion drives reveal animations with rAF, so *any* reveal-animated element measures `opacity: 0` in that state, and a screenshot captures the same pre-animation paint. The blank region I photographed is consistent with the artifact, not evidence of a bug. | **Re-measure in a genuinely foreground tab** (`document.visibilityState === 'visible'` and a rAF probe returning >20 frames/800 ms) before doing any work on this. Do not "fix" it until reproduced under those conditions. | rAF probe: 0 frames/15 s; `document.hidden === true` |
| 2.2 | 🟠 | Console warning on every load: *"Please ensure that the container has a non-static position, like 'relative', 'fixed', or 'absolute' to ensure scroll offset is calculated correctly."* — framer-motion's `useScroll` in [`Landing.tsx`](src/pages/Landing.tsx) is measuring against a `position: static` container, so its scroll offsets are wrong. | Add `relative` to the scroll container passed to `useScroll`. This is the likely cause of 2.1. | Console, `localhost:5173` |
| 2.3 | 🟠 | **All 13 footer links are dead** (`href="#"`): Features, Security, Enterprise, Documentation, API Reference, Community, Blog, About, Careers, Contact, Privacy, Twitter, GitHub. | Wire the ones that exist (Privacy → `/datenschutz`, + add Impressum). **Remove** the ones that don't exist rather than shipping dead links — Enterprise/Careers/Blog/API Reference/Community signal a bigger company than there is, and dead links read as abandonment. | DOM query of `footer a` |
| 2.4 | 🔵 | Three different brand marks across three pages: landing header uses a cyan/blue layers glyph, `/auth` uses the layers glyph in a **purple** circle, `/impressum` uses a **graduation-cap** glyph. The EN/DE toggle is also styled differently on `/impressum`. | One logo component, one toggle component. | Screenshots of `/`, `/auth`, `/impressum` |
| 2.5 | 🔵 | `/auth` password field's placeholder is `••••••••`, which renders as though the field is already filled. | Empty placeholder, or a real hint. | Screenshot of `/auth` |

---

## 3. 🟡 API contract & backend

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 3.1 | 🟡 | **Two API path conventions coexist.** Backend mounts everything under `/api/v1`. The frontend has **44 call sites on legacy un-versioned paths** (`/api/upload/parse`, `/api/ai/generate`, `/api/auth/export-data`, `/api/assignments`, …) and only **23** on `/api/v1/…`. The legacy ones survive purely via a **307 redirect** shim (`/api/health` → `/api/v1/health`, verified). | Pick one. Every legacy call currently pays an extra network round-trip, and the shim is invisible load-bearing infrastructure — if anyone removes it, 44 call sites break at once. Migrate the frontend to `/api/v1` and keep the shim only for cached clients. | `curl` probes returning 307; `grep` counts over `src/` |
| 3.2 | 🟠 | **`nginx.conf` and `vite.config.ts` both carry comments that are factually wrong** — and dangerously so. nginx:26 says *"Proxy /api/\* to the backend, **stripping the /api prefix**. e.g. GET /api/upload/slides → http://api:8000/upload/slides"*. It does **not** strip: `proxy_pass $backend` uses a *variable*, which disables nginx's URI-rewrite, so the full `/api/v1/…` path is forwarded — which is what the backend actually needs. Behaviour is correct; the comments describe the opposite. | Fix both comments. This is a live trap: anyone who "corrects" nginx to match its own comment (by adding a trailing slash to `proxy_pass`) takes **all of production** down instantly. | `nginx.conf:24-29`, `vite.config.ts:18-27`, route table introspection |
| 3.3 | 🟡 | `/docs`, `/redoc` and `/openapi.json` all return **404** on the local dev server. | Correct and desirable for production. But confirm it's an explicit env-gated decision and that **dev** keeps docs on — otherwise every developer loses the API explorer, which is likely why 3.1 drifted in the first place. | `curl` → 404 on all three |
| 3.4 | 🔵 | Startup log: `CORS allowed origins: ['https://learnstation.duckdns.org', 'https://195-201-221-137.sslip.io']` — no localhost. | Harmless today because Vite proxies same-origin, so no cross-origin request is ever made. Worth knowing: any future direct-to-`:8000` call from the browser will fail CORS with a confusing error. Add localhost in dev only. | Backend startup log |

---

## 4. 🟠 Configuration & feature flags

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 4.1 | 🟠 | **Two `.env` files disagree about what the product is.** Root `.env` sets only `FEATURE_STUDY_GUIDE=1`, which reads as "exam mode and review engine are off". `backend/.env` — a second file — sets `FEATURE_REVIEW_ENGINE=1`, `FEATURE_EXAM_MODE=1`, `FEATURE_STUDENT_UPLOADS=1`, `FEATURE_STUDY_GUIDE=1`. The backend loads the latter, so those features **are** live. I initially misdiagnosed this as a frontend/backend flag mismatch and had to introspect the running app to get the truth. | One source of truth. If a human auditing the config gets the wrong answer, so will the next deploy. Consolidate to a single `.env`, and document precedence. | `grep FEATURE backend/.env`; live `settings.feature_*` introspection |
| 4.2 | 🟡 | **`VITE_FEATURE_GLOBAL_SEARCH` is absent from both `.env` and `.env.example`**, so it defaults off — which silently disables a *fully built* feature: the top-bar search button, the ⌘K / `/` hotkeys, the whole `CommandPalette` component, and the in-course search UI. Backend `FEATURE_GLOBAL_SEARCH` is also off (`/api/v1/search` → **not mounted**, verified). | Decide: ship it (add to `.env` + `.env.example`, both halves) or delete it. Right now you're carrying and maintaining a search feature that no user can reach. | `featureFlags.ts:9`; live route table shows `search` NOT MOUNTED |
| 4.3 | 🟡 | `VITE_AUTH_URL="http://localhost:4000"` is in `.env`, but **nothing listens on port 4000** and the variable is referenced **nowhere** in `src/` or `backend/`. | **Remove.** Dead config that implies a separate auth service exists. | `grep -rn VITE_AUTH_URL src/ backend/` → no hits; `lsof :4000` → nothing |
| 4.4 | 🔵 | Vite warns on every start: *"browsers data (caniuse-lite) is 14 months old"*. | `npx update-browserslist-db@latest`. 14-month-old target data means autoprefixing decisions are being made against a stale browser matrix. | Dev server log |

---

## 5. 🔵 Dead code & orphaned routes

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 5.1 | 🟡 | [`src/components/AppSidebar.tsx`](src/components/AppSidebar.tsx) is **imported nowhere** — dead code. Worse, its nav list is stale (student items: dashboard/ascent/leaderboard/settings — missing library, materials, friends), so it actively misleads anyone reading it to understand navigation. | **Delete.** | Import search across `src/` |
| 5.2 | 🟡 | `/insights` and `/achievements` are pure `<Navigate>` redirects to `/ascent`, but live code still links to the **legacy** path: [`StudentDashboard.tsx:506,510`](src/pages/StudentDashboard.tsx:506) and [`NudgeBanner.tsx:27`](src/components/NudgeBanner.tsx:27). `src/pages/Insights.tsx` still exists but is no longer routed. | Point those three links at `/ascent`; delete `Insights.tsx`; keep the redirects only for external bookmarks. | Route map |
| 5.3 | 🔵 | `/pixi-lab` and `/professor/pipeline-test` are dev-only unlinked labs (`import.meta.env.DEV`). | Fine as-is — intentional and self-documented. Noted so they aren't mistaken for orphans. | Route map |
| 5.4 | 🟡 | Repo root holds ~15 loose one-off scripts (`fix_lectures.py`, `apply_policies.py`, `revert_policies.py`, `get_policies.py`, `check_schema.py`, `restore_courses.py`, `test_debug.py`, `fix_cache_and_rebuild.ps1`, `start_manual.ps1`, …) plus `policies.txt` and `test_rls.sql`. | Move to `scripts/` or delete. Root-level `fix_*.py` / `revert_*.py` scripts that touch DB policies are a footgun sitting in the open. | `ls` |

---

## 6. Route & permission map (reference)

Single router, [`src/App.tsx`](src/App.tsx); path constants in [`src/lib/routes.ts`](src/lib/routes.ts). Nav chrome is [`ConsoleTopBar.tsx`](src/components/console/ConsoleTopBar.tsx) only — no sidebar, no bottom nav.

**Nav by role**
- **Student:** Home `/dashboard` · Library `/library` · My Materials `/materials` *(flag)* · Ascent `/ascent` · Ranking `/leaderboard` · Friends `/friends`
- **Professor:** Dashboard · Courses · Archive · Analytics · Upload (all `/professor/*`)
- **Admin:** Admin Panel `/admin/dashboard` — **this is the entire admin nav**; an admin sees no other tab.

**⚠️ To verify once logged in:** `/professor/courses`, `/professor/courses/:id`, `/professor/upload`, `/professor/lecture/:id` and `/professor/upload/batch/:id/review` allow **`allowedRoles: [professor, student]`** — while `/professor/dashboard`, `/professor/archive` and `/professor/analytics` are professor-only. Student access to professor upload/course routes is intentional (student course creation), but the split needs confirming as deliberate rather than drift.

---

## 7. Delivery plan — quick-win sessions

### 7.1 How to read this

Everything in Part 1 is fixable in **four sessions, ~4 hours total**, and none of it requires touching product logic. That is unusual and worth exploiting: the highest-severity findings in this audit are also the cheapest to fix. Do them before Parts 2 & 3 land more work on top.

Scoring: **Value** = user/legal impact · **Effort** = focused working time · **Risk** = chance of breaking something that works today.

| Session | Scope | Value | Effort | Risk | Fixes |
|---|---|---|---|---|---|
| **S1** | Legal unblock | 🔴 Critical | ~90 min | **None** (static copy) | 1.1–1.5, 2.3 |
| **S2** | Landing reveal bug | 🟠 High | ~45 min | Low | 2.1, 2.2 |
| **S3** | Config consolidation | 🟠 High | ~60 min | **Medium** (touches deploy) | 3.2, 3.3, 4.1–4.4 |
| **S4** | Dead code sweep | 🟡 Medium | ~45 min | Low | 5.1, 5.2, 5.4 |
| S5+ | Deferred: API path unification (3.1) | 🟡 | ~3 h | Medium | 3.1 — 67 call sites, do **not** bundle with a quick win |

**The single best hour you can spend** is S1. It removes two launch blockers, needs zero runtime code, and can't regress anything.

---

### 7.2 Session detail

#### S1 — Legal unblock 🔴
**Branch:** `fix/legal-compliance` (from `main`)

1. `src/i18n/locales/{en,de}/legal.json` — fill controller + Impressum identity; **rewrite §4 Processors** to name Cerebras, Groq, Google; add the Art. 44–46 transfer basis; bump "Last updated"; replace the *"depending on project configuration"* hedge with the real Supabase region.
2. `src/pages/Landing.tsx` footer — point Privacy → `/datenschutz`, add an Impressum link, and **delete** the 9 links to pages that don't exist (Enterprise, Careers, Blog, API Reference, Community, Docs, About, Contact, Security).

**Needs from you:** real legal name, address, contact email — I can't invent these. Ideally a lawyer reviews the new §4 before merge.
**Verify:** load `/impressum` and `/datenschutz` in EN **and** DE; click every remaining footer link.
**Note:** `npm run lint` runs an i18n parity gate (`scripts/check-i18n-parity.cjs`), so EN and DE must be edited together — the gate will catch you if you forget. It passes cleanly today, so any failure is yours.

#### S2 — Landing reveal bug 🟠
**Branch:** `fix/landing-scroll-reveal`

Add `position: relative` to the container that framer-motion's `useScroll` measures in `src/pages/Landing.tsx`, killing the console warning (2.2) — then re-measure whether all six cards reveal (2.1).

**Verify — do not trust the screenshot.** Scroll to the feature grid and re-run the opacity sweep; all six cards must read `opacity: 1`:
```js
[...document.querySelectorAll('[class*="rounded-2xl"]')]
  .filter(el => el.textContent.match(/Secure Vault|Universal Access|AI Tutor|Live Analytics|Adaptive Quizzes|For Instructors/))
  .map(el => ({ card: el.textContent.slice(0,20), opacity: getComputedStyle(el).opacity }))
```
**⚠️ Ordering:** S1 and S2 **both edit `src/pages/Landing.tsx`**. Run them sequentially on the same branch, or land S1 first and rebase S2 — do not run them as parallel branches.

#### S3 — Config consolidation 🟠 (medium risk — treat with care)
**Branch:** `chore/config-consolidation`

1. Collapse `.env` + `backend/.env` into one source of truth; document precedence in `SETUP_GUIDE.md`.
2. Delete `VITE_AUTH_URL` (4.3).
3. **Decide global search** (4.2): ship it (add `VITE_FEATURE_GLOBAL_SEARCH=1` + `FEATURE_GLOBAL_SEARCH=1` to `.env` *and* `.env.example`) or delete the feature. Don't leave it half-alive.
4. Correct the inverted comments in `nginx.conf:24-26` and `vite.config.ts:18-21` (3.2).
5. `npx update-browserslist-db@latest` (4.4).
6. Confirm `/docs` being 404 is intentional and dev keeps it on (3.3).

**Why medium risk:** this is the only session that touches deploy-time config. Env consolidation can silently flip a feature flag in production. Bring up `docker-compose.prod.yml` locally and smoke-test `/api/v1/health` plus one real endpoint **before** merging. Merge this one alone, never bundled.

#### S4 — Dead code sweep 🟡
**Branch:** `chore/dead-code-sweep`

Delete `src/components/AppSidebar.tsx` and `src/pages/Insights.tsx`; retarget the three live `/insights` links (`StudentDashboard.tsx:506,510`, `NudgeBanner.tsx:27`) to `/ascent`; move the ~15 loose root scripts into `scripts/`.

**Verify:** `npx tsc -p tsconfig.app.json --noEmit` catches any import you missed. Grep for `AppSidebar|Insights` after deleting. Check nothing in `docker-compose*.yml`, `Makefile`, `dev.sh` or CI references a moved script by its old root path — that's the one way this low-risk session bites.

---

### 7.3 How to deliver & merge

**CI reality — this is the trap.** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) triggers on `pull_request` and `push: branches: [main]` **only**. Pushing a feature branch runs **nothing**. A green-looking branch is not a tested branch — you only get signal once a PR is open.

**Local pre-flight, before every PR:**
```bash
npx tsc -p tsconfig.app.json --noEmit   # NOT tsconfig.json — that config checks nothing
npm run lint                            # includes the EN/DE i18n parity gate
npm run test                            # vitest
.venv/bin/python -m pytest backend/tests -q   # backend, if the session touched it
```

**⚠️ Typecheck is already red — it cannot gate anything yet.** `tsc -p tsconfig.app.json --noEmit` reports **18 pre-existing errors across 11 files** on a clean tree. Most are the same framer-motion `Variants` shape (`{ transition: { type: string … } }` not assignable — `type` widens to `string` instead of the literal `"spring"`), in `Onboarding.tsx` ×3, `BentoGrid.tsx`, and others; the rest are in `src/__tests__/pixi/*` and `NudgeBanner.test.tsx`. So "does it typecheck?" currently means "diff the error list before and after", which nobody will do reliably.

Add a **session S0** ahead of everything else: fix those 18 errors (most are one `as const` on the transition objects) so typecheck goes green and can then be enforced in CI. Until that lands, treat the command above as "no *new* errors in the files I touched" — that's how the two fixes in §8.5 and §8.7 were verified.

**Per session:**
```bash
git switch main && git pull
git switch -c <branch>
# ... work, then pre-flight above ...
git push -u origin <branch>
gh pr create --title "<type>: <what>" --body "Closes audit finding(s) N.N …"
# wait for CI green, then:
gh pr merge --squash
```

**Merge order and parallelism:**

| Order | Session | Can run in parallel with | Why not others |
|---|---|---|---|
| 1st | **S1** legal | S4 | Shares `Landing.tsx` with S2 |
| 2nd | **S2** landing | S4 | Rebase onto S1 first |
| any | **S4** dead code | S1, S2 | Disjoint files |
| **last, alone** | **S3** config | — | Deploy-time blast radius; wants a clean main to smoke-test against |

Squash-merge each session as one commit so any single fix can be reverted independently — worth it for S3 especially.

**Two housekeeping notes specific to this repo:**
- You're currently on `fix/s6-continuous-security-ci` with an untracked `.agents/skills/senior-prompt-engineer/`. Branch these sessions from `main`, not from here, so the PRs stay reviewable.
- You run several Claude sessions against this same working tree. Re-check `git status` immediately before each commit — another session may have staged something you didn't intend to ship.

---

## 8. Part 2 — Student flow (in progress)

Walked on a **fresh student account**, so this is the true first-run experience.

### 8.1 🔴 BLOCKER — onboarding dead-ends into a blank screen — ✅ **FIXED 2026-08-17**

> **Status: fixed and verified.** One-line fix in [`src/pages/Onboarding.tsx:220`](src/pages/Onboarding.tsx:220) (`setStep(1)` added to `beginJourney`) plus a regression test in [`src/__tests__/pages/Onboarding.test.tsx`](src/__tests__/pages/Onboarding.test.tsx). Verified three ways: (1) live browser — the exact repro below now ends `input=true btns=[Back,Next]`; (2) survives 3 consecutive Back→continue cycles; (3) the new test **fails** with the fix reverted and passes with it, while both pre-existing tests pass either way — proving the old suite could not have caught this. Full suite 3/3 green across 3 runs; `npm run lint` 0 errors.
>
> Fixed in `beginJourney` rather than by removing `setStep(0)` from `handleBack`, so the intro keeps its intended "no active node" state on the journey map and form entry is self-healing however `step` was left.

**Repro (100% reproducible, clean page load, no HMR involved):**

| Step | Action | DOM result |
|---|---|---|
| 1 | Load `/onboarding`, click "Click to continue" | `input=true btns=[Back,Next]` ✓ |
| 2 | Click **Back** | returns to cold-open ✓ |
| 3 | Click "Click to continue" again | `input=false btns=[] bodyTextLen=0` ← **blank** |

The user is left on a permanently empty screen with no controls. **The only escape is a manual browser reload.** A new user who taps Back even once on the very first step cannot create their profile — this kills activation for anyone who explores before committing.

**Root cause — one line.** In [`src/pages/Onboarding.tsx:337`](src/pages/Onboarding.tsx:337):
```js
const handleBack = () => {
  if (step === 1) {
    setStage('intro');
    setStep(0);        // ← sets step to a value nothing renders
  }
```
Step content is rendered by discrete guards `{step === 1 && …}` through `{step === 5 && …}` (lines 712, 742, 844, 1010, 1134). **There is no branch for `step === 0`.** The intro→form transition at line 224 sets `setStage('form')` but never restores `step`, so the form stage mounts with `step === 0` and every branch evaluates false — an empty container.

**Fix:** either drop the `setStep(0)` (leave it at 1), or add `setStep(1)` alongside `setStage('form')` at line 224. Prefer the latter — it makes the intro→form entry self-healing regardless of how `step` was left.

**Regression test to add:** intro → step 1 → Back → intro → continue asserts the name input is present. This class of bug (a state value with no matching render branch) is invisible to typecheck and to any test that only walks forward.

### 8.1b ⚠️ Methodology trap — two phantom "blockers" this flow will hand you

Not product bugs. Recorded because both looked exactly like real blockers and would have been filed as such.

1. **Background-tab wedge.** Driving onboarding with synthetic `element.click()` while the Chrome tab is `document.visibilityState === 'hidden'` makes the wizard look permanently stuck: `step` advances (the PIXI journey map moves on) but the DOM keeps the *previous* step's markup and the new step never mounts. Cause: Chrome throttles `requestAnimationFrame` to ~zero in hidden tabs, framer-motion drives its animations with rAF, and the step wrapper uses `<AnimatePresence mode="wait">` ([`Onboarding.tsx:717`](src/pages/Onboarding.tsx:717)) — so the exit animation never completes and the enter never starts. **It self-heals the instant the tab becomes visible.** Verified: wedged at `radios: 0`; one real click later `visibility: visible` → `radios: 5`.
2. **"Double-clicking Next wedges the wizard."** I formed this from the symptom above and it was wrong — a single-click control run wedged identically. The variable was tab visibility, not click count.

**Rules this implies for the rest of the audit:** drive the app with real clicks via the `computer` tool, keep the tab foregrounded, and **always run a single-variable control before filing an interaction bug**.

**Mandatory pre-flight — run this before trusting ANY visual or opacity measurement.** A backgrounded tab silently invalidates all of it, and it cost this audit one retracted finding (2.1) plus two phantom blockers:

```js
// Must print visible / true / >20 frames. Anything less → measurements are worthless.
(() => { window.__p={f:0,t:performance.now()};
  const l=()=>{window.__p.f++; if(performance.now()-window.__p.t<800) requestAnimationFrame(l);};
  requestAnimationFrame(l);
  return {vis:document.visibilityState, focus:document.hasFocus()}; })()
// ...wait ~1s, then:
window.__p.f
```

Note that **screenshots do not protect you**: a throttled tab paints its pre-animation state, so a screenshot of "missing" content looks exactly like a genuine rendering bug. Neither `osascript ... activate` nor clicking inside the page reliably fixes it — the Chrome window itself has to be visible and the tab selected. Also note `useSound` is *not* a suspect — it wraps every AudioContext call in try/catch, so `play()` cannot throw and abort a handler.

Why 8.1 is unaffected: it was found with real clicks in a visible tab, and its proof is a deterministic jsdom test that fails/passes on the one-line change with no rAF or visibility involved.

### 8.2 Onboarding step 1 — smaller findings

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 8.2.1 | 🟠 | The name input has **no `<label>` and no `aria-label`** — it is an unlabelled text field. A screen-reader user hears only "edit text". The placeholder ("Enter your name…") is not an accessible name and disappears on input. | Add a real label or `aria-label`. This is the very first interaction in the product, so it's the worst place to fail a11y. | `document.querySelector('input')` → `hasLabel: false, ariaLabel: null` |
| 8.2.2 | 🟡 | **No `maxLength`** on the name field (`maxLength: -1`). A user can paste an arbitrarily long string as their display name, which then flows into the leaderboard, friends list and profile chip. | Cap it (e.g. 60 chars) client-side **and** validate server-side — client-only limits are trivially bypassed. Needs a check that the DB column is bounded too. | DOM property read |
| 8.2.3 | 🔵 | The single input on the step is **not autofocused** (`document.activeElement !== input`). | Autofocus it. On a one-field step it's free UX. | DOM property read |
| 8.2.4 | 🔵 | Journey map ("You → Avatar → Studies → Courses → Explore") is horizontally off-centre — it spans x 717→1249 in a 1476px viewport, centred ~983 rather than ~738, leaving a visibly empty left third. | Centre the map, or make the two-column split intentional and balanced. | Screenshot measurement |

| 8.2.5 | 🟡 | **Flaky test.** `Onboarding > completes the full 5-step flow for a user with catalog` failed once out of 5 runs while the machine was loaded (4393 ms vs its usual ~2000 ms), then passed 3/3 on re-run. Pre-existing — unrelated to the 8.1 fix. | Find the unawaited assertion and give it an explicit `waitFor`. A test that fails under load is worse than no test: it trains the team to re-run CI instead of reading it. | 5 runs of the suite, one intermittent failure |

**Verified as OK:** "Next" is properly `disabled` (real `disabled` attribute, `opacity: 0.5`, `cursor: default`) when the name is empty — correct, not a fake-disabled div. "Back" from step 1 correctly returns to the cold-open. Sound toggle is present and discoverable.

### 8.3 Onboarding steps 2–5 + activation screen

Walked end to end to completion (real Marburg CS profile, 3 courses, reveal montage, landed on `/onboarding/start`).

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 8.3.1 | 🟠 | **Step 5 is a dead step for almost everyone.** "Add extra topics" renders *"No public courses available right now."* Cause: [`Onboarding.tsx:240`](src/pages/Onboarding.tsx:240) hard-filters the platform catalog to a single literal title — `c.title.trim().toLowerCase() === 'datenbanksysteme'`. Any other course is discarded, so unless that exact course is published the entire step is empty. | Drive it from a `is_public`/`is_ready` flag instead of a hardcoded German title. As-is, a whole onboarding step invites users to "explore courses" and offers nothing — and the filter silently breaks the moment that course is renamed. | Live step 5; source filter |
| 8.3.2 | 🟠 | **Stale product name, hardcoded and untranslated.** [`ActivationOnboarding.tsx:110`](src/pages/ActivationOnboarding.tsx:110) renders the literal string **"Ascend Academy"** — the old name — as the eyebrow badge on the first screen a student sees post-onboarding. It's not in any locale file, so it also stays English in the German UI. | Change to Learnstation *and* move it into `onboarding.json` (EN + DE) so the i18n parity gate covers it. Only occurrence left in `src/`, so this is a one-line fix. | Live screen; `grep -rn "Ascend Academy" src/` → 1 hit |
| 8.3.3 | 🟡 | **No draft persistence.** All five steps live in `useState` with nothing written until the final submit, so any reload mid-onboarding drops the user back to the cold-open having lost name, avatar, university, department, programme and course selections. I lost a fully filled step 3 to an unrelated page reload during this audit. | Persist per-step to `localStorage` (or write incrementally). Five steps of academic setup is far too much to re-enter, and reloads happen — tab restore, crash, accidental refresh. | Observed twice live |
| 8.3.4 | 🟡 | **443 university options mounted at once** in the picker — no virtualization (`document.querySelectorAll('[role=option]').length === 443`). | Virtualize the list, or cap rendered results until the user types. It's the heaviest DOM on the flow and it's on the critical path for every new user. | DOM count, live |
| 8.3.5 | 🔵 | The university picker's popover opens **upward over the journey map and the "Your studies" heading**, hiding the user's progress context while they choose. | Constrain placement to below the trigger. | Screenshot |
| 8.3.6 | 🔵 | Reveal montage shows two tiles both reading **"3 courses"** — one "Semester 1 set up", one "Picked for you". Given step 5 surfaced *no* public courses, the "picked for you" count looks like it's re-counting the curriculum courses. | Verify the recommendation count is a distinct number; if it isn't, drop the tile rather than showing the same 3 twice. | Screenshot of montage |
| 8.3.7 | 🔵 | Greeting uses the first token of the display name — "Test" from "Test Student". Fine for `Firstname Lastname`, but mononyms and names with particles will read oddly. | Low priority; note only. | Live |

**Verified working (don't re-audit):**
- **Academic cascade** university → department → field of study → semester all load real data and cascade correctly. Marburg returns 16 real faculties with FB codes; FB12 returns 6 real programmes.
- **Step 4 curriculum quality is genuinely good** — real Marburg CS modules (CS-TI Digital Systems & Computer Architecture, CS-GP Foundations of Programming, CS-LA Linear Algebra, CS-ADS Algorithms & Data Structures), grouped by semester, each with Completed / Taking now / Planned toggles, and the CTA carries the live count ("3 selected · Next").
- **Keyboard a11y on the Select components** — type-ahead + Enter selects correctly.
- **Luna theme picker** live-previews onto the avatar; proper `role="radio"` + `aria-checked`.
- **Email verification field is domain-aware** (`you@students.uni-marburg.de` after choosing Marburg).
- **Empty state on step 5 is a real message**, not a blank region.
- **`useSound`** guards every AudioContext call in try/catch — cannot throw into a handler.
- **Reveal montage + gamification**: rank (Newcomer, 500 XP to Learner) and first badge ("Identity Set") both fire.

### 8.5 🔴 BLOCKER — the upload wizard's primary CTA fails silently — ✅ **FIXED 2026-08-17**

> **Fixed and verified.** `catch` added to `submitBatch` in [`useBatchUpload.ts`](src/hooks/useBatchUpload.ts): it now extracts the server's `detail` prose via a new `toUserMessage()` helper, exposes `submitError`, and marks the queued rows `failed` so the existing per-file error UI and `retryFile()` can act. The wizard renders it in a `role="alert"` banner above the CTA ([`StudentUploadWizard.tsx`](src/features/student/components/StudentUploadWizard.tsx)). `submitBatch` now returns `null` on failure so the caller can't advance the wizard.
>
> Proof: 3 new tests in [`src/__tests__/hooks/useBatchUpload.test.tsx`](src/__tests__/hooks/useBatchUpload.test.tsx) cover the real 429 body, a non-JSON 502 (falls back to generic copy), and error-clearing on a later success. **All 3 fail with the fix reverted** and pass with it.

Found live. "Organize my material" is the single most important button in the product's core loop, and **every failure mode of it is invisible to the user.**

**What I observed:** clicked "Organize my material" with one valid PDF queued. Nothing happened — no toast, no error, no state change. The file kept saying "Queued"; the button returned to idle. Measured: `toastNodes=0`, and no error text anywhere in `document.body.innerText`. The only trace was in the console:

```
Upload /api/v1/upload/batch → 429:
{"detail":"The processing queue is busy right now. Please retry in a few minutes."}
  at Object.upload (src/lib/apiClient.ts)
  at async Object.submitBatch (src/hooks/useBatchUpload.ts)
  at async onClick (src/features/student/components/StudentUploadWizard.tsx)
```

**Root cause — no error handling on either side of the call.** [`useBatchUpload.ts`](src/hooks/useBatchUpload.ts) wraps the request in `try { … } finally { setIsSubmitting(false); }` — **there is no `catch`**, so the rejection propagates out. The call site ([`StudentUploadWizard.tsx:333`](src/features/student/components/StudentUploadWizard.tsx:333)) is an `async` `onClick` that also has no `try`/`catch`:

```js
onClick={async () => {
  const res = await batchUpload.submitBatch();   // rejects → unhandled rejection
  if (res?.batchId) { … setStep(2); }            // simply never runs
}}
```

The rejected promise becomes an unhandled rejection that only React logs. `finally` still clears the spinner, so the UI looks *idle and ready*, as though the click never registered.

**This is not 429-specific.** 401 (expired session), 500, and network loss all take the same path. A student on a flaky connection gets a button that does nothing, forever, with no explanation.

| Sev | What it should be |
|---|---|
| 🔴 | `catch` in `submitBatch` that (a) surfaces the server's `detail` message via the `useToast` already used elsewhere in this codebase, and (b) marks the queued rows `failed` with the error text — the `BatchFileEntry` type already has an `error` field and `retryFile()` already exists, so the UI can support this without new plumbing. Add a regression test that stubs a rejecting `apiClient.upload` and asserts an error is rendered. |

### 8.6 Queue backpressure is correct, but its failure mode is misleading

Investigating the 429 above surfaced a separate operational issue. The 429 itself was **my** environment (I'd started `backend-api` but not `backend-worker`), so it is *not* a product bug — but how it presents is.

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 8.6.1 | 🟠 | With no arq worker running, Redis had **159 orphaned jobs** against `ARQ_MAX_QUEUE_DEPTH=50`. Every upload was therefore rejected — permanently — with the message *"The processing queue is busy right now. **Please retry in a few minutes.**"* Nothing drains, so retrying never helps. The copy asserts a transient condition for what is actually a dead-worker outage. | Distinguish the two. If depth is over the limit **and** not decreasing (or no worker heartbeat), say so honestly and alert — don't tell users to wait. Starting the worker drained 159 → 0 in ~20 s, so the backpressure logic itself is fine; only the diagnosis is missing. | `queue_depth()` = 159 vs max 50; 0 after starting the worker |
| 8.6.2 | 🟠 | `/health/ready` does not appear to reflect a non-draining queue, so this state is invisible to monitoring. In production a silently dead worker means uploads are 100% broken while health checks stay green — and combined with 8.5, the user sees *nothing at all*. | Include queue-drain health (depth trend or worker heartbeat) in the readiness probe, and alert on it. Consistent with the still-open alerting gap noted in the roadmap. | Source review + observed behaviour |
| 8.6.3 | 🔵 | The wizard does **not** dedupe identical files client-side — the same PDF added twice produced two separate "Queued" rows. The backend is safe (content-hash dedupe returns the existing lecture without consuming quota), so this is cosmetic/confusing rather than harmful. | Dedupe by `(name, size, lastModified)` when building the queue. | Observed two identical rows live |

### 8.7 🟠 The batched slide-synthesis path fails 100% of the time and silently costs ~5× more

Observed in the worker log during a real single-PDF ingestion (10 slides):

```
Batch response yielded zero usable items for 8 active slides; raising for per-slide retry.
Batch synthesis failed for 8 slide(s) starting at index 0
  (batch_analyze_text_slides: unusable JSON response) — falling back to per-slide synthesis
Batch response yielded zero usable items for 2 active slides; raising for per-slide retry.
Batch synthesis failed for 2 slide(s) starting at index 8
  (batch_analyze_text_slides: unusable JSON response) — falling back to per-slide synthesis
```

**Both batches failed — a 100% failure rate**, so all 10 slides were synthesised individually. The batching optimisation is entirely non-functional, and because the fallback succeeds, the user-visible result is correct and nobody notices.

**⚠️ My first diagnosis was wrong** and is recorded here deliberately. I reported the cause as "`batch_analyze_text_slides` doesn't pass `response_format`". It does — `json_mode=True` is passed at [`orchestrator.py:1615`](backend/services/ai/orchestrator.py:1615); my grep had only covered lines 1477–1560 and missed the call. Reading before editing caught it. **Never accept a root cause for an LLM-output bug without looking at the actual response.**

**Actual root cause — the opposite of what I guessed.** I captured the raw model output with a throwaway diagnostic that spied on `parse_json_response`. The model returns *correct, complete data* in an envelope:

```json
{ "slides": [ { "page_number": 1, "title": …, "summary": …, "questions": [ … ] } ] }
```

The code then did:

```python
parsed = parse_json_response(raw)
if isinstance(parsed, dict):
    parsed = [parsed]        # wraps the ENVELOPE, not the items
```

…producing `[{"slides": [...]}]` — a one-item list whose only member has no `page_number`. `page_to_idx` therefore matched nothing, `results` was empty, and the function raised.

**It could never have worked.** `json_mode=True` requires the response to be a top-level JSON *object*, so the model physically cannot return the bare array the prompt asks for — it must wrap it. The batch path was dead by construction from the moment JSON mode was enabled, and the fallback masked it completely.

**Second site with the identical bug:** `_regenerate_failing_slide_quizzes` ([`orchestrator.py:1729`](backend/services/ai/orchestrator.py:1729)) also calls with `json_mode=True` and had the same `parsed = [parsed]`, so quiz regeneration was silently broken the same way.

| Sev | Impact | Status |
|---|---|---|
| 🟠 | **~5× the LLM calls, latency and spend on the hottest path in the product** — 2 intended requests became 10, scaling with every slide of every upload. Invisible except for a warning line in the worker log. | ✅ **FIXED 2026-08-17** |

> **Fix:** new shared `as_slide_item_list()` helper in [`orchestrator.py`](backend/services/ai/orchestrator.py) unwraps known envelope keys (`slides`/`items`/`results`/`data`/`output`), falls back to a sole list-valued entry for provider drift, and still treats a genuinely slide-shaped dict as one slide. Applied at **both** call sites.
>
> **Verified against the live model:** the same diagnostic that raised `ValueError: unusable JSON response` with 0 items now returns 2 items correctly mapped (`index 0 → page 1`, `index 1 → page 2`) with full content, summaries and questions. Plus 15 model-free unit tests in [`backend/tests/unit/test_batch_response_envelope.py`](backend/tests/unit/test_batch_response_envelope.py), including guards that a slide carrying `questions: [...]` isn't mistaken for the envelope and that an ambiguous multi-list envelope isn't silently guessed. Related suites (`test_overlapping_batches`, `test_slide_synth_service`, `test_unified_orchestrator`) still pass — 83 tests.

**Still open (not fixed):** the fallback is only a log line. A 100%-failure optimisation should emit a metric and alert — otherwise the next regression of this kind is equally invisible. Worth doing before the next pipeline change.

**Note for the cost picture:** this compounds LLM spend and is separate from the Supabase egress issue already on record.

### 8.8 Ingestion pipeline output quality — verified good

Credit where due. One real lecture PDF (`DB Intro.pdf`, 487 KB, 10 slides) through the full wizard produced:

- **Course description**, unprompted and accurate: *"Introduction to Databases examines data storage structures, DBMS fundamentals, and application-level use. Students will be able to design, query, and integrate relational databases with tools such as MySQL and Oracle."*
- **Sensible lecture title** ("Introduction to Databases" from a file named `DB Intro.pdf`), tagged `Lecture` + `Review suggested`
- Editable course name with a **"Suggest again"** affordance, collapsible description editor, drag-to-reorder
- Good async framing on the processing step — *"You can leave while this runs, your materials will be ready to review when processing finishes"* — plus a "Continue to my courses" escape hatch

End-to-end wall time was roughly 2 minutes for one 10-slide PDF, *including* the 5× per-slide fallback penalty from 8.7.

### 8.4 Student upload API (`POST /api/v1/materials/upload`) — source audit

The browser walkthrough of the wizard is blocked (the audit harness only permits uploading files the user has explicitly attached to the session), so this is a source-level audit of the endpoint the wizard calls.

| # | Sev | What it is now | What it should be | Evidence |
|---|---|---|---|---|
| 8.4.1 | 🟡 | **Edge and app size limits disagree.** `nginx.conf:54` sets `client_max_body_size 100M`, but the app rejects anything over `MAX_UPLOAD_MB` (default **50**) in `validate_pdf_content`. So a 60–100 MB upload is accepted by nginx, streamed all the way to the backend, buffered, and *then* rejected. | Set nginx to just above the app limit (~51M) so oversized files are refused at the edge. This repo has already had a Supabase egress overage; paying full ingress for a request you're going to reject is the same class of waste. | `nginx.conf:54` vs `backend/core/config.py:87` |
| 8.4.2 | 🔵 | **Magic-byte check is permissive**: `if b"%PDF" not in content[:1024]` — a substring search, so any file with `%PDF` anywhere in its first 1 KB passes. Real PDFs begin with `%PDF-` at byte 0. | `content.startswith(b"%PDF-")`, keeping a small tolerance for BOM/whitespace if you've actually seen such files. Practical risk today is low because the extension gate (`.pdf`/`.pptx`) runs first, so this is defence-in-depth, not a live hole. | `backend/core/file_validation.py:23` |

**Verified working (don't re-audit):** the upload path is well built — `MAX_UPLOAD_MB` size cap, minimum-length check, extension allowlist (`.pdf` + `.pptx` with real OOXML container validation and slide counting), `sanitize_filename` stripping null bytes / path traversal via `os.path.basename` / HTML metacharacters, **content-hash dedupe that returns the existing lecture without consuming quota**, and an atomic quota claim through a `SECURITY DEFINER` RPC (`increment_upload_quota`) rather than a read-then-write race.

---

## 9. Data-layer audit (no browser required)

Run directly against the database while the browser was unavailable. **All findings here are query-verified**, so unlike §2.1 they don't depend on animation state. Note this is the *same* Supabase project production uses (`lkiiideqjoiksnycgplc`).

### 9.1 🟠 Course discovery is 83% noise — and it's live

Every authenticated student sees the same `DISCOVER` catalog: `courses` with `status='published' AND is_archived=false`. The endpoint is implemented correctly (RLS-as-boundary, explicit filter, rate-limited) — **this is a data problem, not a code one.**

| Measured | Count |
|---|---|
| Published, non-archived courses visible to every student | **36** |
| …with **zero lectures** (empty shells) | **20** (56%) |
| …that are obvious dev/test fixtures | **16** (44%) |
| …duplicated titles | **3** |
| **…genuinely named *and* containing content** | **6** (17%) |

Fixtures currently public include `testcourse`, `E2E Integration Course`, `Cache Invalidation Proof` **1 & 2**, `Clean Verification Course` **1 & 2**, `My Uploaded Biology 101`, `My Uploaded Database Course`, `Last Testing upload`, `Test`, and **five** copies of `My AI Generated Course` plus a truncated `My AI Gener`. `Systemsoftware und Rechnerkommunikation` appears **three times** (16 lectures, 1 lecture, 0 lectures).

**What it should be:** unpublish the fixtures and the empty shells before launch, and de-duplicate. A first-time student's discovery experience is currently 30 pieces of noise around 6 real courses — that is the first impression of the product's content library. Longer term, `status='published'` should require at least one lecture, so an empty course cannot reach the catalog at all.

**Evidence:** `select … from courses where status='published' and is_archived=false` (36 rows, listed in full during the audit); `backend/api/v1/courses.py:329` for the filter.

### 9.2 🟠 Review cards are missing for 38% of lectures — the SRS loop silently has nothing to serve

`review_cards` is keyed per **lecture** (`lecture_id`, `concept_id`, `source_type`, `source_id`, `content_hash`) with **no `user_id`** — per-user state lives in `review_schedule`. So any lecture with quiz questions should have cards regardless of who is enrolled.

| Measured | Count |
|---|---|
| Lectures with quiz questions | 114 |
| …that have review cards | 71 |
| **…that have ZERO review cards** | **43 (38%)** |
| Of those 43: in a course a student is enrolled in | 9 |
| Of those 43: owned by a student | 5 |

**Not explained by age.** Both buckets span the same window and reach today — e.g. `Differential Cryptanalysis` was created **2026-08-17** with 7 quiz questions and 0 cards.

**The generator code is fine.** I ran its exact query read-only against the newest affected lecture and it returns **7 rows** — so `_generate_quiz_cards` ([`card_factory.py:63`](backend/services/review/card_factory.py:63)) would happily create cards. The job simply never completed for these lectures. Also note `quiz_cards: 0` in the worker log is *not* evidence of failure: `_insert_card` dedupes on `content_hash`, so 0 is the correct idempotent answer for an already-carded lecture.

**Contributing design weakness:** on a missed Redis lock, [`card_factory.py:115`](backend/services/review/card_factory.py:115) returns `{"quiz_cards": 0}` and never reschedules — so a duplicate enqueue can consume the only attempt and the lecture is left permanently cardless with no error anywhere.

**What it should be:**
1. Run the existing `backend/scripts/backfill_review_cards.py` to close the current 43.
2. Reschedule instead of no-op'ing when the lock is missed.
3. Add a reconciliation invariant — *"every lecture with quiz questions has ≥1 review card"* — as a monitored check. This drifted to 38% with no signal, which is the actual problem; without the check it will drift again.

**Why it matters:** the review engine is the product's retention loop. For 38% of the library it has nothing to serve, and the student just sees an empty queue with no explanation that anything is wrong.

### 9.3 Verified working (data layer)

- **Ingestion output is real and correct.** My end-to-end upload produced `total_slides=10`, **10 slides**, **8 quiz questions**, and **8 review cards** — a complete, studiable lecture from one 487 KB PDF. (8 questions for 10 slides is expected: title/metadata slides are correctly skipped.)
- `visibility='course'` and `source_language='en'` were set correctly on the new lecture.
- `/courses/browse` is properly authenticated, rate-limited (`60/minute`), paginated by cursor, and uses the RLS-enforcing per-user client rather than `supabase_admin`.
- Review-card generation is **idempotent** via `content_hash`, and holds a Redis lock to avoid concurrent duplicate runs.

---

## 10. Still to audit (Parts 2 cont. & 3)

Blocked on an authenticated session.

| Part | Scope |
|---|---|
| **2 — Student** | onboarding (`/onboarding`, `/onboarding/start`, `/onboarding/upload`), dashboard, library, course view, lecture view, study guide, review session, materials, exam flow (config → take → report), ascent, leaderboard, friends, profile, settings |
| **3 — Professor + Admin** | professor dashboard, courses, course detail, archive, analytics (+ advanced), lecture upload, batch review, admin dashboard |
| Cross-cutting | console errors per screen, failed network requests, empty/loading/error states, mobile + dark-mode responsiveness, keyboard/a11y, N+1 and slow queries, RLS behaviour |

---

*Report generated during a live co-piloted walkthrough. Every finding above was verified against the running app or the actual source — none are inferred from documentation.*
