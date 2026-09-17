# Overnight goal · finish the Learnstation v4 UI

*A self-contained overnight brief. Abi is asleep — you cannot ask him anything.
Every open question gets his last known answer or a reported default, never a
silent invention. Written 2026-08-31 by the Fable session that built the first
nine screens; you are continuing that work, not starting over.*

---

## 0 · First moves, in order

1. **Invoke `superpowers:using-superpowers`** and follow it. For each screen in
   the backlog: `superpowers:writing-plans` once at the start (one plan for the
   night, screen-by-screen), then `superpowers:test-driven-development` per
   screen, and `superpowers:verification-before-completion` before each commit.
   Use `superpowers:subagent-driven-development` only for parallelisable,
   well-scoped screens (e.g. Notifications and Concept UI at the same time) —
   otherwise stay in one context; drift between subagents cost more than it
   saved last time.
2. **Read `src/features/spaces/BUILD-PROMPT.md` in full.** It is the method:
   locked decisions, the four gates, fixture-guard testing, the traps. This
   file only adds the backlog and the overnight rules — it does not repeat it.
3. **Read every image in `/Users/abdullahabobaker/Downloads/inspo/`** (8 PS5
   screenshots: home with widgets, library grid, PS Plus hub, Store, a ratings
   detail page). This is the visual north star Abi chose. The distilled lesson,
   already encoded in the built screens: **the art is enough** — no panel that
   re-explains what a tile already says; quiet section headings; one primary
   action; sort rows visible; detail lives on the item's own page.
4. **Run the app** (`preview_start` → `dev-preview`, port 5199 — never 5173,
   another session may own it) and click through every existing `/v4/*` route
   before writing anything. They are the reference implementation.
5. Work in this worktree on branch `claude/peaceful-rosalind-9d0e67`.
   **Never commit to main. Never push.**

## 1 · The hard constraint: no new backend

Everything stays **mock-only** behind `data/useSpaces.ts`, exactly as today.
But every mock you add must be a shape the **existing backend can already
serve**, so wiring later is a swap, not a feature request. Before inventing a
field, check the service it would come from:

| v4 concept | Existing surface to mirror |
|---|---|
| Spaces / Lessons | `src/services/coursesService.ts`, `lectureService.ts` |
| Concepts | `src/services/conceptsService.ts` (it exists — read it) |
| Uploads / Materials | `myMaterialsService.ts`, `uploadBatchService.ts` |
| XP / Rank / badges | `gamificationService.ts` + `profiles` fields in `src/lib/auth.tsx` (`total_xp`, `current_streak`, `avatar_url`, `luna_*`) |
| Review / practice | `reviewService.ts`, `practiceSheetsService.ts` |
| Search (⌘K) | `searchService.ts` |
| Members / invites | join codes exist on courses today; member roles are v4-new — mock them, flag them in the commit as "needs backend" |
| Notifications | `NotificationBell.tsx` + its query exist — mirror that shape |

If a screen would need a genuinely new backend capability, build the UI against
a mock, mark it `// NEEDS-BACKEND:` in the code, and list it in the final
report. **Do not design heavy new server work.**

## 2 · The backlog, in priority order

Ship each screen fully (all four states, gates green, committed) before the
next. If the night ends mid-backlog, everything committed must be coherent.

### A · Space routing + Overview pager — the PS Store shell
The Space today is one URL with local tab state. Make it real routing:
`/v4/space/:id` → Overview, `/v4/space/:id/map`, `/members`, and Lesson pages
as siblings. Add a **Lesson pager**: on a Lesson screen, prev/next Lessons as
edge-peeking cards (PS Store style — the next item visibly peeks from the
screen edge), plus ←/→ keys. Back always returns to the Space scrolled to that
Lesson (Doc 2's landing table).

### B · Concept UI + Concept overview
Read `conceptsService.ts` first; mirror its shape. A Concept chip (used on
Lesson screens already) opens a **Concept overview**: name, which Lesson it
lives in, its progress state (untouched/discovered/cleared), practice for it,
and the community section at Concept anchor level (Doc 1 gives Concepts their
own contribution anchor — fixtures exist for Lesson level; add a couple at
Concept level). Style: the Ratings-Details-Page inspo — one focused object,
stats left, context behind.

### C · Space lifecycle — create, join, manage
- **New Space**: a modal/flow from the Spaces screen button (it's inert
  today). Name → mode (Guided/Open) → visibility (Private default). On
  "create" land on the new Space's empty Overview (Doc 2 landing table).
  Mock-only: append to the fixture set in memory.
- **Join with a code**: modal from the existing button; code → preview card →
  join → land on Overview.
- **Manage a Space** (Owner only): a **Studio screen** (`/v4/space/:id/manage`)
  using `StudioShell` — rename, description, mode switch (lossless, Doc 1),
  grounding toggle, archive, delete-with-confirm. Delete requires typing the
  Space name (destructive, Studio pattern).
- **Members management** (Owner/Editor): promote/demote Member↔Editor, remove,
  **invite** — show the join code + copy button. No approval flows beyond
  Invite visibility (Doc 1: three visibility levels only).

### D · Notifications
A popover from the bell in `SpacesTopBar` (currently inert). Mirror the old
`NotificationBell` data shape. Items are Lesson-level or people-level, never a
Space card: "Åsa endorsed your contribution", "2 new Lessons in Database
Systems" (opens the Lesson list, names the Space as context), "Chidi sent a
friend request". Group by day, mark-all-read, empty state. Quiet — no red
badge spam; a small count like the reference's tray.

### E · Profile avatar + Ascent
The profile already exists as a bento. Add:
- **Avatar**: the product has `LunaAstronaut` (learnstation-luna) and
  `profiles.avatar_url` + `luna_suit_color/visor_tint/patch`. Use Luna as the
  avatar in the v4 top bar chip and Profile header (initials only as fallback)
  — do not build a new avatar system.
- **Ascent in v4**: the old `Ascent.tsx` has `RankRing`, `FullJourneyPath`,
  `SkillTreeView`. Do NOT port them wholesale. Add one "Your journey" section
  to the v4 Profile: RankRing-style ring around the avatar + the badge grid
  that exists. The cross-Space journey map is **explicitly parked** (Doc 2
  open question: two maps, unresolved). Leave a labelled slot, report it.

### F · Home, from the current dashboard
Read `src/pages/StudentDashboard.tsx` and `features/student/homeFeed.ts`. Port
the *good ideas* into v4 Home under its rules (Lesson links only, never Space
cards): the hero-kind logic (brand-new → onboard state; all-done → celebration
strip), Recently viewed as a rail, the quick-check card idea (one practice
question inline). Keep the existing bento as the top. Do not port: Luna tour,
onboarding banners, assignments panel.

### G · Notes, writable
Library owns Notes (Doc 2 rule 5: read AND written there). Add compose/edit
in-place in Library (textarea in the row, autosave to mock), and a "New note"
action on the Lesson screen's notes section. Notes remain private-only.

### H · Studio mode sweep
`/v4/space/:id/manage` (from C) + a pass over the three Library Studio screens:
wire row-level actions visually (publish moves item out of list with a toast —
`sonner` is installed), delete-with-undo toast (Doc: undo for destructive).
Studio stays dense and loud; Learn stays calm. A screen never mixes them.

## 3 · Rules that override everything

- **BUILD-PROMPT.md §4 locked decisions** hold: vocabulary law (run the
  checker), console language, Scene browse/focus split, calm-by-default table,
  classification only where you choose, quiet-text scale, self-hosted Inter
  (never touch the @font-face), `MotionConfig` handles reduced motion.
- **The four gates before every commit**: `tsc -p tsconfig.app.json`, `eslint
  src/features/spaces --quiet`, `vitest run src/features/spaces`, vocabulary
  checker. Plus browser verification — assert via `preview_eval` before
  screenshotting; screenshots alone lie (stale renders bit us twice).
- **Fixture guards first.** Every doc rule a new screen touches becomes a
  failing test before the screen exists. The guards have caught five real
  bugs; that is the method working.
- **A bento cell must say something its list cannot.** If it restates the list
  below it, cut it.
- **One commit per backlog letter**, message style as the last three commits
  (`git log -3`): what, why, what is deliberately not done, known gaps named.
- **Do not touch** `features/{courses,student,assignments}`, `pages/`, the old
  console components (read them, copy patterns, never import except
  `@/components/console` + `topicIcon` + `cn` + shadcn `ui/*`, which are
  already established imports). Do not import `learnstation-luna` via new
  paths other than how the old product does.
- **Report, don't resolve**: anything Doc 1/Doc 2 doesn't answer, or answers
  badly on a real screen, goes in the report with options — same as the theme
  split and tab order were handled. Known live divergence: tab order is
  Overview · Map · Members (Abi's call, docs say otherwise).

## 4 · The goal condition

The night is done when:

1. Backlog A–H each: shipped + all four gates green + all four `?mock=` states
   render + committed, **or** explicitly reported as not reached (in order —
   no skipping ahead to easy ones).
2. `npx vitest run src/features/spaces` green with **new guards for every new
   rule touched** (expect the count well above the current 47).
3. Every route reachable by URL and by clicking from the top bar inward —
   walk the full click-path once in the browser at the end.
4. A final report written to `src/features/spaces/OVERNIGHT-REPORT.md`:
   what shipped, screenshots taken, every `NEEDS-BACKEND` marker, every
   doc conflict found, and the honest list of what was skipped and why.
5. Working tree clean, everything on `claude/peaceful-rosalind-9d0e67`,
   nothing pushed, main untouched.

Do not stop early because the list is long. Do not mark the goal met until
OVERNIGHT-REPORT.md exists and the tree is clean.
