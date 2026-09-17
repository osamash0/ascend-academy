# Build prompt · Learnstation v4 UI

*A self-contained brief for building the v4 interface to completion, test-first, with a
self-review loop. Assumes no memory of previous sessions. Written 2026-08-30 by the
session that built the foundation, Spaces and Space screens.*

---

## 1 · Who you are and what you are building

You are building the UI for **Learnstation**: anyone creates a shared study **Space**,
uploads material, and learns with an AI tutor alongside other people. Reference model is
Skool, not Coursera.

You build screens with **mock data only**. No API calls, no Supabase, no backend imports.
Wiring comes later and must mean *swapping the data source, not rewriting components*.

**Work on your own branch in your own worktree. Never commit to `main`.**

---

## 2 · Read these before writing code

Absolute paths, readable from any worktree:

```
/Users/abdullahabobaker/Desktop/ascend-academy/docs/design-v4/
├── 01-foundations.md        ← source of truth, Locked v1.15. Read fully.
├── 02-navigation.md         ← Locked v0.7. Destinations, modes, tabs, the map.
├── 01-foundations-diagram.html
├── 02-space-tabs-options.html
├── map-ui-vision.html       ← the map drawn, + anatomy of one body
└── notes-spaces-screen.md   ← nine known gaps
```

⚠️ **These docs may live on another branch.** If `docs/design-v4/02-navigation.md` is
missing from `main`, search the worktrees:
`find ~/Desktop/ascend-academy/.claude/worktrees -name "02-navigation.md"`.
The docs session works on its own branch and does not always merge promptly.

**If this prompt and those docs disagree, the docs win — say so rather than guessing.**

---

## 3 · What already exists — extend it, do not rebuild it

```
src/features/spaces/
├── types.ts                    v4 domain model, fully commented
├── mocks/
│   ├── people.ts               real authors, incl. latin-ext names
│   ├── spaces.ts               7 Spaces covering every state
│   ├── lessons.ts              real Lesson titles from the live app
│   ├── contributions.ts        likes, endorsed, orphaned, hidden
│   └── __tests__/fixtures.test.ts   22 rule-guard tests ← THE PATTERN TO COPY
├── data/useSpaces.ts           the swap seam. Nothing below it touches a network.
├── components/
│   ├── Scene.tsx               browse vs focus ground + MotionConfig
│   ├── SpacesTopBar.tsx        rocket + pill tabs, the five destinations
│   ├── SpaceTile.tsx           a Space as a console tile
│   ├── LessonRow.tsx           a Lesson in the path
│   ├── ContributionCard.tsx    a member contribution
│   ├── badges.tsx              Origin, Grounding, Mode, Visibility, Star, Author
│   └── states.tsx              empty / loading / error
└── screens/
    ├── SpacesScreen.tsx        DONE — Mine / Discover
    ├── SpaceScreen.tsx         DONE — Overview · Members · Map
    └── SpaceRoute.tsx
```

Also existing and **not** to be rebuilt: **shadcn/ui** (~30 primitives in
`src/components/ui/`), the **console layer** (`src/components/console/` — `DepthScene`,
`ConsoleTile`, `MediaRail`, `LaunchButton`), and the **token layer**
(`tailwind.config.ts` + `src/index.css`).

Dev routes: `/v4/spaces`, `/v4/space/:spaceId`. Append `?mock=empty|loading|error`.

### Still to build

1. **Library** — objects *you made* across every Space. Learn mode.
2. **Library's Studio screens** — manage uploads · drafts across Spaces · how your work landed.
3. **Home** — your next action across every Space. Landing screen after login.
4. **Social** — friends, requests, public profiles, rankings (XP only).
5. **Profile** — Ascent (XP, Rank, badges) + public profile subset.
6. **The per-Space Map** — locked in Doc 2 §"The map". The tab slot exists and is empty.
7. **A v4 `LessonTile`** — `ConsoleTile` bakes in `uppercase font-black` and is shared
   with the old product, so its `LESSON 1` / `DONE` labels cannot be calmed without
   touching code you must not touch.

---

## 4 · Locked decisions — do not relitigate

**Vocabulary law.** Banned in all UI copy: *professor · student · teacher · instructor ·
course · classroom · module · folder · lecture · LMS*. Use **Universe · Space · Lesson ·
Material · Practice · Members · XP · Rank · Like · Star**, and **Learner / Creator** for
people (copy words only — permissions stay Owner/Editor/Member).
**Like belongs to contributions. Star belongs to whole Spaces. Neither ever crosses.**
Enforced by `node scripts/check-vocabulary.mjs`.

**Namespace.** `features/courses/`, `features/student/`, `features/assignments/` are the
old product. Do not touch, rename, or import from them. Old and new coexist.

**Visual law — the console language.** Built on `DepthScene` + `ConsoleTile` + rail/hero
structure, because that is the existing product and Abi chose it over the flat card-grid
in `spaces-mockup.html`. That mockup is a **layout sketch only** — take its structure,
never its styling.

**The Scene rule** (`components/Scene.tsx`). Doc 2 rule 10 says the theme is spent on the
map "and nowhere else"; the console language spends it everywhere. Resolved by Abi:
- **browse** surfaces (Home, Spaces, Space Overview, Library, Social, Profile) keep the
  console texture — parallax wash, ambient glow, particles.
- **focus** surfaces (Lesson reader, Practice, **the Map**) get plain near-black, no
  gradient behind anything.

The map *requires* this: "darkness is the content, not the background — unlit means
unlearned" is unbuildable on a gradient. **Every screen renders through `<Scene>`.**

**Calm is the default.** Doc 2 puts every destination in **Learn mode** — "generous
spacing, minimal chrome, one primary action, no tables". The first build of Spaces was
rejected as *"very robotic"*. The cause was measurable and will recur if you let it:

| Never | Instead |
|---|---|
| `font-black` on labels, chips, meta | `font-medium` / `font-semibold` |
| `uppercase` + `tracking-[0.2em]`+ on everything | sentence case, normal tracking |
| `text-[10px]` chips | `text-[11.5px]`, `py-[3px]` |
| `leading-snug` on body | `leading-relaxed` / `leading-[1.75]` |
| Badge fills at `/15` | `/12` |

Weight 700+ is for **page titles only**. Everything else earns attention by spacing.

**Classification helps you choose, not once you have chosen.** Chips appear on Discover
(capped at 2, most-specific first) and **nowhere inside a Space you have joined**. The
full classification stays on the object; this is display, not data.

**Typography.** Inter, **self-hosted** in `public/fonts/`. The Google CDN is forbidden —
LG München I (3 O 17493/20, 2022) held that transmitting visitor IPs to Google breaches
GDPR, and the users are German universities. Never "simplify" the `@font-face` block in
`src/index.css` into an `@import`.

**Quiet text scale.** `text-quiet` (0.72) · `text-label` (0.58) · `text-faint` (0.50).
Every step clears 4.5:1 on **both** the console background and a `depth-card`. `text-decor`
(0.14) is **not a text colour** — decoration only, never information that appears nowhere
else. Do not reintroduce raw `text-white/40` or `text-primary/80`; both measured as AA
failures.

**Motion.** `<MotionConfig reducedMotion="user">` lives in `Scene` and covers everything
below it. It disables transform/layout animations while **preserving opacity**, because a
cross-fade still says "this changed" without causing nausea. Do not hand-roll
`duration: 0` per component — that kills the fade too.

---

## 5 · The method

### 5.1 Test-driven — the rules become executable before the screen exists

UI "TDD" here does not mean snapshot tests. It means: **every rule in the docs that a
screen must obey becomes an assertion before you build the screen.** Two layers:

**Layer 1 — fixture guards** (`mocks/__tests__/fixtures.test.ts`). These do not test
product code. They test that the *mock data itself* obeys the locked rules, because a
fixture that quietly breaks a rule produces a screen that looks right and is wrong.
Existing examples to copy:

```ts
it('renders no grounding value where grounding is switched off', () => {
  for (const s of allSpaces.filter((x) => !x.groundingEnabled))
    for (const l of lessonsForSpace(s.id))
      expect(l.grounding, `${s.name} / ${l.title}`).toBeNull();
});
```

**This layer has already caught three real bugs** — a Space claiming 23 Lessons while
rendering 0, contribution anchors silently re-pointing when a Lesson was inserted, and
every Lesson claiming "Source file removed". Add a guard for every new invariant.

**Layer 2 — browser assertions.** Rules that only exist once rendered. Write these as
`preview_eval` scripts and run them after every change:

```js
// Grounding is dormant by default: a Space with it off must render ZERO markers.
const count = () => [...document.querySelectorAll('[title]')]
  .filter(e => /^(Grounded|Not grounded)$/.test(e.textContent.trim())).length;
// → 0 for Advanced Topics in Cryptography, 10 for Database Systems
```

**Order per screen: write the assertions → watch them fail → build → watch them pass.**

### 5.2 The self-review loop

Repeat until the exit criteria pass **twice with no new findings**:

1. **Build** the smallest thing that satisfies the assertions.
2. **Verify in the browser.** Screenshot *and* assert programmatically. A screenshot alone
   is not verification — twice this session a screenshot was captured before React
   re-rendered and showed a stale state.
3. **Audit** against §5.3. Measure, do not eyeball.
4. **Fix** everything found. Add a guard test for anything that a test could have caught.
5. **Report** what the docs got wrong — see §7.

Never claim a screen works without having driven it. If something failed, say so with the
output.

### 5.3 The audit — run all of it, every screen

```bash
npx tsc -p tsconfig.app.json --noEmit    # ⚠️ NOT tsconfig.json — that checks nothing
npx eslint src/features/spaces --quiet   # errors only; scoped, so it stays fast
npx vitest run src/features/spaces
node scripts/check-vocabulary.mjs
```

**Do not skip ESLint because the other three are green.** It was missing from this list
for the whole first build, and the first time it ran it found a real defect that `tsc`,
47 tests and the vocabulary check had all waved through:

```ts
next.has(id) ? next.delete(id) : next.add(id);   // an expression pretending to be control flow
```

Types were fine and behaviour was fine, which is exactly why nothing else caught it.
That is the class of thing ESLint exists for — and it also catches the imports left
dangling by a rewrite, which is the most common residue of the self-review loop in §5.2.

Prefer the scoped command above to `npm run lint`: that runs i18n parity plus ESLint
across the whole repo, so it is slow and buries your errors under the old product's.

Then in the browser:

- **Contrast.** Composite alpha over the *actual* background and measure. Text sits *on*
  the card, so composite over the card — compositing over the page and comparing to the
  card is wrong and gave me wrong numbers once already. Floor: **4.5:1**.
- **Target size.** WCAG 2.2 AA is **24×24 CSS px** (the 44px figure is Apple's *touch*
  guidance; this is desktop web). Flag anything under 24.
- **Decorative icons.** Every icon whose meaning is already in adjacent text needs
  `aria-hidden`. Audit found 30 exposed in one pass.
- **All four states.** `?mock=empty|loading|error` plus ready. Screenshot each.
- **Reduced motion.** Confirm `MotionConfig` wraps the tree.
- **Calm check.** `grep -c "font-black\|uppercase" <screen>` — if labels are shouting,
  it will show up as a number.

### 5.4 Exit criteria — a screen is done when

- [ ] `tsc` exits 0 · **`eslint --quiet` exits 0** · `vitest` green · vocabulary check clean
- [ ] Every doc rule the screen touches has a passing assertion
- [ ] Zero text below 4.5:1; zero interactive targets below 24×24; zero exposed decorative icons
- [ ] Ready, empty, loading and error all render and have been screenshotted
- [ ] No import from `features/{courses,student,assignments}`; no backend import
- [ ] Screens render through `<Scene>` with the correct surface
- [ ] Reviewed once more after a break, against §4's calm table

---

## 6 · Traps that cost time in this session

- **`tsconfig.json` checks nothing.** Always `-p tsconfig.app.json`.
- **A fresh worktree has no `node_modules` and no `.env`.** Symlink
  `ln -s ~/Desktop/ascend-academy/node_modules ./node_modules` (package.json is identical)
  and copy `.env` (gitignored). Dev server: `preview_start` → `dev-preview` on **5199**,
  so it never collides with another session on 5173.
- **The backend is probably not running.** `/api/* → 500` in the console is expected and
  unrelated to your work. Do not chase it.
- **`preview_screenshot` can capture before React re-renders.** Assert state via
  `preview_eval` first, then screenshot.
- **CI never runs on feature-branch pushes.** Local gates are the only gates.
- **Real content contains banned words.** A live Lesson description reads "*students* will
  learn basic operations". The vocabulary law governs **UI chrome, not user content** —
  the lint rule checks string literals and JSX text only, never rendered data or comments.
- **Do not use real credentials.** Build against mocks; the fixtures already mirror the
  real data.

---

## 7 · Report, do not silently resolve

Screens are where design docs get found out. A flaw caught while building costs a
paragraph in a doc; the same flaw caught later costs a rebuild. When the foundation does
not answer something, or answers it badly once it is on a real screen, **stop and report
it** with the collision named and options offered.

Precedent from this session: the console language and Doc 2's map rules were in direct
contradiction (rule 10 says the theme is spent on the map "and nowhere else"; the app
spent it everywhere *except* the map). Reporting it produced the Scene rule in §4. Quietly
picking a side would have produced a rebuild.

### Currently open — do not decide alone

- **The two maps.** `Ascent` already holds a cross-Space journey (`FullJourneyPath`,
  `SkillTreeView`); Doc 2's ten rules are written for the **per-Space** map. One thing at
  two scales, or two features? Undecided. If you touch `Ascent`, report.
- **"Things you kept."** Library covers what you *made*. Saving someone else's work needs
  a fourth engagement verb beside Like, Star and XP — a Doc 1 amendment, not a Doc 2 call.
- **Is Starred a tab in Spaces, or a filter?** Provisional. It is under Spaces either way.
- **Which mode the persistent top bar is.** All five destinations are Learn ("minimal
  chrome"), but the bar carries notifications, settings and sign-out. Unruled.
- **Does the Spaces list need a Lesson sub-rail** now that Space → Overview owns the
  Lesson list? Possibly a duplicate index in a different coat.
- **Mobile**: which five items survive a bottom bar, and where ⌘K goes without a keyboard.

---

## 8 · First move

Do not start by writing a screen. Start by:

1. Reading `01-foundations.md` and `02-navigation.md` in full.
2. Running `/v4/spaces` and `/v4/space/s-dbs` in the browser and reading their source —
   they are the reference implementation for everything in §4.
3. Picking the next screen from §3, and writing its rule assertions **first**.

Then build, verify, audit, fix, repeat — until §5.4 passes twice clean.
