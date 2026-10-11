# One Library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge Library and Studio into one place. Library becomes a shelf of living pages, one per file you brought in. Each opens into the canvas at `/v4/library/m/:id`, carries its progress back to the shelf, and is shared to a Space from the page with a role-aware outcome.

**Architecture:**
- **One object, `ShelfItem`:** held in an in-memory mock store (`mocks/shelf.ts`) behind a data seam (`data/useShelf.ts`).
- **Derived values:** the journey, life line, filters and "your words" are pure functions in `studio/shelf.ts`.
- **Library screen:** rebuilt as the shelf.
- **Canvas screen:** moves to `/v4/library/m/:materialId`, gains a Library header, a Share sheet and a journey row, and reports progress to the store.
- **Retired:** the old Studio home and the three dense Library screens become redirects. Their batch actions move into Select on the shelf.

**Tech Stack:** React 18, TypeScript, Tailwind 3.4, Motion 13 (`motion/react`), Radix Dialog (shadcn `@/components/ui/dialog`), react-router v6, Vitest + happy-dom + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-11-one-library-design.md`. Read it first; this plan argues from it. The canvas specs are `2026-10-10-studio-canvas-design.md`, `2026-10-10-living-learn-design.md` (§11 "As built") and `2026-10-11-learn-deeper-design.md`.

## Global Constraints

- **Scope:** all code lives under `src/features/spaces/`, plus `src/App.tsx` for routes. Mock-only; no new dependencies. Imports from outside the namespace must pass `src/features/spaces/__tests__/boundary.test.ts`.
- **Vocabulary:** UI copy must not contain these words, singular or plural, case-insensitive: professor, student, teacher, instructor, course, classroom, module, folder, lecture, lms, slide, deck, document. "Studio" is no longer used as a UI word for a place.
  - Check with `node scripts/check-vocabulary.mjs src/features/spaces/studio`, `… src/features/spaces/data` and `… src/features/spaces/screens`. It accepts directories only.
  - The screens directory already has hits from merged reader files (LessonFacesScreen, CourseScreen, RehearsalScreen, LessonScreen). Add no new hits anywhere, and keep every file you touch clean.
- **Data seam:** screens read data only through `data/*` hooks, using `useSettled(useScenario())` load states (`?mock=loading|error|empty`).
- **Motion:**
  - Motion owns animation; never write CSS keyframes.
  - Every `AnimatePresence` child needs an `exit` (`components/__tests__/motion.test.tsx`).
  - `reachable.test.tsx` requires every exported component to be mounted somewhere at the end of each task.
  - Reduced motion (`useReducedMotion()`): replace any choreography with one 150 ms fade.
- **Screen modes:** `components/__tests__/modes.test.tsx` classifies every screen. The shelf is `learn`; the canvas stays `own-ground`. Update the map only for files you add or remove, with a comment.
- **Accessibility:**
  - Decorative icons get `aria-hidden`.
  - Targets are at least 24×24 px.
  - Window keys (`U`, `/`) go through `studio/keys.ts` guards, ignore modifier keys and `e.repeat`, and must not collide with the canvas keys (`S`, `/` in the composer, ← →, `R`, `[`, `]`).
- **React hygiene:**
  - Hold callbacks used in timers or listeners in refs.
  - Never run side effects inside a state updater.
- **Gates**, from the worktree root:
  - `npx tsc -p tsconfig.app.json --noEmit`
  - `npx eslint <changed files>`
  - the vocabulary directories above
  - `npx vitest run src/features/spaces --maxWorkers=2`
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `git add .superpowers/`. Never use bare `git stash`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `studio/shelf.ts` | create | `ShelfItem` types and pure functions: `journeyOf`, `shareOutcome`, `lifeLine`, `filterItems`, `sortItems`, `groupBySpace`, `yourWords` |
| `mocks/shelf.ts` | create | Seeded store with `subscribe` and mutations |
| `data/useShelf.ts` | create | Seam hook, plus `useShelfItem(id)` |
| `screens/LibraryScreen.tsx` | rewrite | The shelf: masthead, filters, Continue, covers, Your words, Select |
| `library/Cover.tsx`, `library/ContinueCard.tsx`, `library/BringIn.tsx`, `library/ShareSheet.tsx`, `library/Journey.tsx`, `library/SelectBar.tsx`, `library/YourWords.tsx` | create | Shelf and page components (folder `src/features/spaces/library/`) |
| `screens/StudioCanvasScreen.tsx` | modify | Route by material, Library header, Share and Journey, progress reporting, `lastPage` |
| `src/App.tsx` | modify | New route and redirects |
| `screens/StudioHomeScreen.tsx`, `screens/LibraryStudioScreen.tsx` | delete (Task 7) | Retired |

---

### Task 1: The model — `ShelfItem`, pure functions, store

**Files:**
- Create: `src/features/spaces/studio/shelf.ts`, `src/features/spaces/mocks/shelf.ts`
- Test: `src/features/spaces/studio/__tests__/shelf.test.ts`, `src/features/spaces/mocks/__tests__/shelf-store.test.ts`

**Interfaces (produce exactly):**
```ts
// studio/shelf.ts
export type ShareAs = 'lesson' | 'community-lesson' | 'contribution';
export type ShareState =
  | { kind: 'private' }
  | { kind: 'draft'; spaceId: string; as: ShareAs }
  | { kind: 'shared'; spaceId: string; as: ShareAs; likes: number; endorsed: boolean; cleared: number };
export interface ShelfItem {
  id: string; filename: string; pageCount: number; cover: string;
  stage: 'developing' | 'ready' | 'failed';
  share: ShareState;
  opens: { kind: 'canvas'; canvasId: string } | { kind: 'lesson'; spaceId: string; lessonId: string };
  progress: { pagesRead: number; recallKnew: number; recallTotal: number; answers: number; notes: number };
  lastOpenedAt: string | null; lastPage: number | null; addedAt: string;
  /** Preview honesty: true when the item opens the sample pages, not its own. */
  sample?: boolean;
}
export type JourneyStep = 'brought' | 'understood' | 'shared' | 'landed';
export type StepState = 'done' | 'now' | 'todo';
export function journeyOf(item: ShelfItem): Record<JourneyStep, StepState>;
export type Role = 'owner' | 'editor' | 'member';
export type Mode = 'guided' | 'open';
export function shareOutcome(role: Role, mode: Mode): { as: ShareAs; kind: 'draft' | 'shared'; copy: (space: string) => string };
export function lifeLine(item: ShelfItem): string[];          // e.g. ['Read 6/12', 'Recall 9/31', '2 answers', '1 note'], zeros omitted
export type ShelfFilter = 'all' | 'reading' | 'shared' | 'words';
export function filterItems(items: ShelfItem[], f: ShelfFilter, q: string): ShelfItem[];
export type ShelfSort = 'recent' | 'added' | 'az';
export function sortItems(items: ShelfItem[], s: ShelfSort): ShelfItem[];
export function groupBySpace(items: ShelfItem[], spaceName: (id: string) => string): { title: string; items: ShelfItem[] }[];
export function continueItem(items: ShelfItem[]): ShelfItem | null;  // most recent lastOpenedAt among ready items
export interface WordEntry { kind: 'note' | 'answer' | 'written'; id: string; itemId: string | null; page: number | null; title: string; body: string; at: string; href: string }
export function yourWords(entries: WordEntry[]): WordEntry[];   // newest first, stable
```

- [ ] **Step 1: Write `shelf.test.ts`.** Use a factory `item(overrides)` and assert the following.
  - **`journeyOf`:**
    - A developing private item → brought done, understood now, shared todo, landed todo.
    - A ready item with `pagesRead` 0 and `answers` 0 → understood `now`.
    - A ready item with `pagesRead` ≥ 1 → understood done, shared now.
    - A draft → shared `now`.
    - Shared with likes 0, endorsed false and cleared 0 → shared done, landed now.
    - Shared with likes 3 → landed done.
  - **`shareOutcome`** covers all six combinations of owner, editor and member against guided and open. Owner or editor → `{as:'lesson', kind:'draft'}`. Member + open → `{as:'community-lesson', kind:'shared'}`. Member + guided → `{as:'contribution', kind:'shared'}`. Each `copy('Database Systems')` matches the spec §5.6 text exactly.
  - **`lifeLine`** omits zeros, and `Read` shows `pagesRead/pageCount`.
  - **`filterItems`:**
    - `reading` = private or draft items, plus shared items whose `pagesRead < pageCount`.
    - `shared` = draft or shared.
    - `all` = everything.
    - `words` returns `[]`, because that filter renders the words stream instead.
    - `q` matches the filename case-insensitively.
  - **`sortItems`:**
    - `recent` puts null `lastOpenedAt` last and orders the rest by `addedAt`.
    - `added` sorts newest first.
    - `az` sorts by filename.
  - **`groupBySpace`:** items are grouped by the share's Space name in A–Z order, and private items come last under "Only you".
  - **`continueItem`** picks the ready item with the newest `lastOpenedAt` and ignores developing or failed items.
  - **`yourWords`** sorts newest first and keeps input order for ties.
  - Run the tests and watch them fail.

- [ ] **Step 2: Implement `studio/shelf.ts`.** `shareOutcome` copies, verbatim:
  - owner/editor: `It becomes a draft Lesson in ${space}. Only you and editors see it until you publish.`
  - member + open: `Open Space: it joins the path as a Community Lesson, with your name on it.`
  - member + guided: `It arrives as your Contribution, with your name on it. The owner can endorse it into the path.`

- [ ] **Step 3: Write `shelf-store.test.ts`, then build `mocks/shelf.ts`.**
  - **Store API:** `getItems()`, `subscribe(fn) → unsubscribe`, `bringIn(filename, now?) → id`, `settleDeveloping(id, ok: boolean)`, `markRead(id, page)`, `bumpAnswers(id, delta)`, `setRecall(id, knew, total)`, `touch(id, now)` (sets lastOpenedAt), `share(id, spaceId, role, mode)` (uses `shareOutcome`; a shared item starts with likes 0, endorsed false, cleared 0), `publish(id)` (draft → shared), `unshare(id)`, `remove(id) → {item, index} | null`, `restore(removed)`, and `__reset()` for tests.
  - **Seed (deterministic):**
    1. `m-norm`: Normalization.pdf, 12 pages, `cover: '/v4-mock/studio/normalization-p1.webp'`, stage ready, `opens: {kind:'canvas', canvasId:'c-norm'}`.
       - Share is shared in `s-dbs` as `contribution`, with likes 3, endorsed false and cleared 2.
       - Progress: pagesRead 6, recallKnew 9, recallTotal 31, answers 2, notes 1.
       - Dates: lastOpenedAt `2026-10-11T08:00:00Z`, lastPage 6, addedAt `2026-10-10T09:00:00Z`.
    2. `m-design-notes`: "Design process — my notes.pdf", 4 pages, `cover: '/v4-mock/studio/normalization-p2.webp'`, private, ready, `opens` canvas `c-norm`, `sample: true`.
       - Progress: pagesRead 4 (all four pages), no answers.
       - lastOpenedAt `2026-10-09T18:00:00Z`.
    3. `m-axioms`: "Axioms cheat sheet.pdf", 2 pages, `cover: '/v4-mock/studio/normalization-p9.webp'`, a draft in `s-linalg` as `lesson` (viewer is owner there), ready, opens `c-norm`, `sample: true`, pagesRead 1.
    4. **Every viewer upload from `mocks/library.ts`** (the items with `kind === 'material'`). Map each to:
       - `opens: {kind:'lesson', spaceId, lessonId}` from the item;
       - `share` shared in its Space as `lesson` when its Lesson is published, else draft;
       - `cover: ''`, so the cover renders a text tile with the first letter;
       - `stage`: ready, or `'developing'` when the library item is pending;
       - progress zeros.
       Read `mocks/library.ts` for the exact shape and do not change it.
  - **`bringIn`** inserts at index 0:
    - `stage:'developing'`, private, `sample: true`
    - `opens` canvas `c-norm`, `cover: '/v4-mock/studio/normalization-p1.webp'`, `pageCount` 12
    - progress zeros, `addedAt` now
  - **Tests:**
    - The seed resolves: every canvas id is `c-norm` (it exists in `mocks/studio-canvas.ts`), every Lesson exists, and every `share.spaceId` is a Space with a non-null `viewerRole`.
    - `bringIn` → `settleDeveloping` flips the stage.
    - `share` follows the role and mode table. `s-dbs` is guided with a member viewer, so it becomes a contribution and shared. `s-linalg` is open with an owner viewer, so it becomes a lesson and a draft.
    - `publish` turns a draft into shared.
    - `remove` → `restore` puts the item back at the same index.
    - `subscribe` fires on every mutation.

- [ ] **Step 4:** Run the gates. `reachable` is unaffected (no components yet). Commit `feat(library): one object for everything you bring in — ShelfItem, journey, share outcomes, store`.

### Task 2: The seam and the routes

**Files:**
- Create: `src/features/spaces/data/useShelf.ts`
- Modify: `src/App.tsx`, `src/features/spaces/screens/StudioCanvasScreen.tsx` (route param only, plus progress reporting)
- Test: `src/features/spaces/studio/__tests__/shelfRoutes.test.tsx`

**Interfaces:**
```ts
export function useShelf(): { state: LoadState; items: ShelfItem[]; continueItem: ShelfItem | null; words: WordEntry[] };
export function useShelfItem(id: string | undefined): { state: LoadState; item: ShelfItem | null };
export const shelfActions: typeof import('../mocks/shelf'); // re-export of mutations for screens
```
`useShelf` subscribes with `useSyncExternalStore`. `words` comes from `yourWords([...notesAsWords, ...answersAsWords])`:
- Notes come from `mocks/library.ts` notes. Each `href` points to the note's Lesson, as Library does today.
- Answers and written blocks come from the canvas store. For now, read `STUDIO_CANVAS.blocks` for `m-norm`. Answers asked in the session are not persisted globally yet, so include `generated` and `written` blocks from the seed canvas only, with href `/v4/library/m/m-norm#b-<id>`.

- [ ] **Step 1: Write `shelfRoutes.test.tsx` first** (MemoryRouter plus the App route table, or a copy of the relevant routes).
  - `/v4/library/m/m-norm` renders the canvas, with heading `Normalization.pdf`.
  - `/v4/library/studio/c/c-norm` redirects to `/v4/library/m/m-norm`.
  - `/v4/library/studio` redirects to `/v4/library`.
  - `/v4/library/uploads` → `/v4/library?f=reading&select=1`; `/drafts` → `?f=shared&select=1`; `/impact` → `?f=shared`. Assert the location with a small `LocationProbe` component.
  - Opening the canvas at `m-norm` and turning to page 7 (the pager) calls `markRead('m-norm', 7)`: the store's `pagesRead` becomes max(6, 7) = 7 and `lastPage` 7.
  - Asking a scripted question bumps `answers` by 1.
  - Opening calls `touch`.
  - `/v4/library/m/nope` shows the not-found state, with "Back to Library".

- [ ] **Step 2: Routes in `App.tsx`.**
  - Add `/v4/library/m/:materialId` → `V4StudioCanvas`.
  - Replace the two `/v4/library/studio…` routes with redirect elements (a tiny `Redirect` component using `useParams` + `<Navigate replace>`). For `c/:canvasId`, find the shelf item whose `opens.canvasId` equals it, preferring the non-sample `m-norm`.
  - Add explicit routes for `uploads`, `drafts` and `impact` before `:view` that redirect as above.
  - Keep `/v4/library/:view` working for any other view until Task 7.

- [ ] **Step 3: Canvas by material.**
  - `StudioCanvasScreen` reads `materialId` with `useShelfItem`. If `item.opens.kind === 'lesson'`, `<Navigate>` to the Lesson route. Otherwise use `useCanvas(item.opens.canvasId)`.
  - The header title becomes `item.filename`. The breadcrumb becomes "Library", and the back link goes to `/v4/library` with the label "Back to Library".
  - When `item.sample` is true, show a quiet line under the title: "Sample pages in this preview".
  - Report progress through the store:
    - on mount → `touch(id)`
    - when `nav.current` changes → `markRead(id, current)`
    - when an answer lands → `bumpAnswers(id, 1)`
    - on Remove → `-1`; on Undo → `+1`
  - Remove the old `canvasId` param use. Update existing canvas tests that mount `/v4/library/studio/c/c-norm` to mount `/v4/library/m/m-norm`. This is a mechanical path change; list each test file.

- [ ] **Step 4:** Run the gates and the full suite. Commit `feat(library): every page lives at /v4/library/m/:id; old Studio paths redirect; progress flows back`.

### Task 3: The shelf screen

**Files:**
- Rewrite: `src/features/spaces/screens/LibraryScreen.tsx`
- Create: `src/features/spaces/library/Cover.tsx`, `src/features/spaces/library/ContinueCard.tsx`, `src/features/spaces/library/YourWords.tsx`
- Test: `src/features/spaces/library/__tests__/shelfScreen.test.tsx`, plus updates to the existing Library tests

**Requirements** (spec §5.1, §5.2, §5.7, §7, §8):
- **Chrome:** `Scene` + `SpacesTopBar active="library"` + `Skylight` + `Masthead title="Library"`, with the lede "What you brought in, what you made of it, and what you shared." Remove the old "doors" nav entirely.
- **Filters:**
  - A `role="tablist"` with Everything · Reading · Shared · Your words, each with a count. Words counts `words.length`.
  - The filter syncs with `?f=`.
  - From 9 items up, show a search field (`aria-label="Search your Library"`, `?q=`) and a sort menu (Recently opened · Added · A–Z).
  - From 9 items up, also show a "Group by Space" toggle.
  - `/` focuses search when it exists, with the keys guards.
- **`ContinueCard`** for `continueItem`:
  - The real page image at 4:3. On hover or focus it cross-fades (Motion, 0.6 s) to the summary's first 2 paragraphs: the first two `summary` blocks of the canvas for that page.
  - Title, "Pick up where you left off · page N of M", the life bar and life line, and a white pill "Continue reading".
  - The whole card is one link to `/v4/library/m/:id`.
  - Hidden on the `shared` and `words` filters.
- **`Cover`**, per spec §5.2:
  - A link with `aria-label` = `${filename}, ${stateLabel}, ${lifeLine.join(', ')}`.
  - Page image, or a text tile (big initial on `bg-white/[0.04]`) when `cover` is empty.
  - Hover shows the summary lines (summary covers only). Text-tile covers show nothing extra on hover.
  - Filename, meta (Space name or "Only you", plus pages), the life bar (`pagesRead/pageCount`) and the life line.
  - The state chip, with its dot colour per state. Shared adds "♥ n", and "Endorsed" when true.
  - A ⋯ menu button labelled "More for {filename}" with Share · Remove. In this task it only opens; wire the actions in Tasks 6 and 7, and render the menu items disabled until then.
- **Grid:** `grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-[18px]`. Leave the first cell as a placeholder slot (Task 4 fills it). Render a plain "Bring something in" link-styled button for now that does nothing.
- **Your words** filter → `<YourWords>`:
  - The existing `NoteEditor` flows: edit, and "New note" (keep the current behaviour and tests).
  - Notes and answers as quiet rows with a 2 px left rule: teal for answers, indigo/40 for notes. Each row has a meta line "Note · {title} · page N" and links to its `href`.
  - Orphan contributions under "Needs a new home" with `ReanchorDialog`, moved from the old Library.
- **Empty Library:** when there are 0 items, the whole content area becomes the calm empty drop target from spec §5.1. Task 4 wires the drop.
- **States:** loading, error and empty inside the same chrome, with the existing components.
- **Tests:**
  - Covers render with their names.
  - Continue shows `m-norm` with "page 6 of 12".
  - The Reading/Shared filters narrow the list and sync the URL.
  - Search appears only from 9 items, so test it with a store seeded to 10 via `__reset` plus `bringIn` calls.
  - Your words lists the note `w-1`-style notes from `mocks/library.ts` and answers with `#b-` links.
  - The old Library behaviours (note edit and new note, re-anchor) still pass in their new home.
  - Update or remove the old Library tests that assert the removed doors or filters, and list them in the report.
- **Modes:** `LibraryScreen` stays `learn`.
- Run the gates, then commit `feat(library): the shelf — Continue, living covers, filters, your words`.

### Task 4: Bring in

**Files:**
- Create: `src/features/spaces/library/BringIn.tsx` (the first-cell tile, the full-page drop veil, and the `U` key)
- Modify: `LibraryScreen.tsx`, `Cover.tsx` (the developing look)
- Test: `src/features/spaces/library/__tests__/bringIn.test.tsx`

**Requirements** (spec §5.3):
- **The first-cell tile:** a `<label>` wrapping a hidden `<input type="file" accept=".pdf,.pptx,image/*">`, labelled "Bring something in". It reads "Bring something in" with the subline "PDF, PPTX or a photo — drop it, or click".
- **Drop veil:**
  - A window-level `dragenter` with files shows a full-page `motion.div` veil ("Drop to bring it in", hairline dashed frame).
  - `dragleave` past the window, or `drop`, hides it.
  - On drop, call `bringIn(file.name)` for each file.
- **`U` key** opens the file picker (keys guards).
- **The developing cover:**
  - It enters with a scale and fade-in.
  - The image starts at `blur(14px) grayscale(1)` with opacity .5.
  - The label goes "Reading your pages…" at 0 ms, "Writing your summary…" at 1200 ms, then sharp at 3300 ms. Drive these with timers held in a ref, and call `settleDeveloping(id, true)` at 3300.
  - The life bar animates 0 → 100% across that time.
  - When the cover becomes ready, the chip pulses once and the screen's polite live region says "{filename} is ready".
  - With reduced motion: no blur animation, the label changes at the same times, and the end is a fade.
- **Failure:** `?mock=import-error` makes `settleDeveloping(id, false)`. The cover shows the red chip "Couldn't read this file" and a "Try again" button that restarts the develop sequence.
- **Sample honesty:** a cover with `sample` shows a small "Sample pages" tag in its meta.
- **Tests** (fake timers):
  - Change the input → a new first cover named after the file, in the developing state.
  - At 1200 the label changes.
  - At 3300 it is ready and the announcement fires.
  - Dragenter shows the veil and drop brings in.
  - `U` opens the picker (spy on `input.click`).
  - The `import-error` path shows "Try again", and retry develops again.
- Run the gates, then commit `feat(library): bring anything in — drop anywhere, and watch the page develop`.

### Task 5: The cover becomes the page

**Files:**
- Create: `src/features/spaces/library/Journey.tsx`
- Modify: `Cover.tsx`, `ContinueCard.tsx` (zoom-through), `StudioCanvasScreen.tsx` (header, journey, last page)
- Test: `src/features/spaces/library/__tests__/openPage.test.tsx`

**Requirements** (spec §5.4, §5.5):
- **Zoom-through:**
  - Clicking a cover or the Continue card calls `preventDefault`, measures the image rect, and renders a fixed `motion.div` clone of the image at that rect.
  - The clone animates to the viewport (`inset 0`, radius 0) over 0.45 s with the Studio ease. Meanwhile the shelf behind animates to scale .98 and opacity .4.
  - When the animation completes, `navigate(href)`.
  - With reduced motion, navigate immediately after a 150 ms fade.
  - Keyboard activation (Enter) does the same.
  - Middle-click or ⌘-click keeps default link behaviour, so it opens a new tab.
- **Page entry:** the canvas root fades in from black (opacity 0 → 1 over 0.35 s) on mount, but only when `location.state?.from === 'shelf'`. Pass that state through `navigate`.
- **Header** (canvas): ← Library · "Library · {filename}" · Learn/Source · **Share** button (state labels per spec §5.5; the Task 6 sheet opens from it, so render it now as a button that does nothing). On wide screens, the `<Journey item>` row sits under the header.
- **`Journey`:** four steps with rings and links, from `journeyOf`.
  - Done: teal ring with a check. Now: white ring. Todo: faint.
  - Link fills animate `scaleX` from the left.
  - It is an `ol` labelled "Where this page is", and each step has its state in text (`sr-only`).
- **Last page:**
  - When the canvas opens with `item.lastPage > 1`, scroll the clean section for that page into view after load, with no smooth scroll.
  - The pager hint shows "Back on page N" for 4 s, instead of the normal hint.
- **Tests:**
  - Clicking a cover navigates to `/v4/library/m/:id` (with fake timers, after the animation timeout; use `onAnimationComplete` plus a fallback timer).
  - The Journey for `m-norm` shows Shared done and Landed done.
  - The Journey for a draft shows Shared as `now`.
  - The canvas opened from the shelf scrolls to `lastPage` (spy on `scrollIntoView` on `[data-page-anchor="6"]`) and shows "Back on page 6".
- Run the gates, then commit `feat(library): open a cover and it becomes the page — with where it stands`.

### Task 6: Share

**Files:**
- Create: `src/features/spaces/library/ShareSheet.tsx`
- Modify: `StudioCanvasScreen.tsx` (opens the sheet), `Cover.tsx` (menu → Share opens the same sheet on the shelf)
- Test: `src/features/spaces/library/__tests__/share.test.tsx`

**Requirements** (spec §5.6):
- **The sheet:**
  - A Radix `Dialog` titled "Share {filename}".
  - It lists the viewer's Spaces (`viewerRole !== null`, via a `data/` hook; add `useMySpaces()` to `useSpaces.ts` if none exists) as a `role="radiogroup"`. Each option reads "{Space} · Guided|Open · you own it | you edit it | you're a member".
  - Choosing one fills an `aria-live="polite"` outcome line with `shareOutcome(role, mode).copy(space)`.
  - The confirm button reads "Share to {Space}". It is disabled until a Space is chosen.
- **Confirm:** `share(id, spaceId, role, mode)` → close → the journey animates → the Share button label updates. A toast says "Shared to {Space}", or "Draft in {Space}" for drafts.
- **When the item is already a draft or shared**, the Share button opens a small menu instead:
  - Draft: "Publish to {Space}" → `publish`, and "Take back to only you" → confirm → `unshare`.
  - Shared: "Open in {Space}" (links to the Space), and "Take back to only you" → confirm → `unshare`.
- **Tests:**
  - Member + guided (`s-dbs`) shows the Contribution copy and ends shared with contribution.
  - Owner + open (`s-linalg`) shows the draft-Lesson copy, ends as a draft, and Publish ends shared.
  - Unshare returns to "Only you".
  - The sheet is reachable from the cover menu on the shelf too.
  - Focus moves into the dialog and returns to the trigger on close.
- Run the gates, then commit `feat(library): share from the page — the outcome said before you press it`.

### Task 7: Select, and retiring the old screens

**Files:**
- Create: `src/features/spaces/library/SelectBar.tsx`
- Modify: `LibraryScreen.tsx`, `Cover.tsx` (selectable), `src/App.tsx` (remove `:view` route; `uploads`/`drafts`/`impact` redirects stay)
- Delete: `screens/StudioHomeScreen.tsx`, `screens/LibraryStudioScreen.tsx`, plus their tests, `useStudioHome`, `components/StudioShell.tsx` (only if nothing else imports it; Settings may — check), and `recentCanvases` if unused
- Test: `src/features/spaces/library/__tests__/select.test.tsx`

**Requirements** (spec §5.8):
- **Entering Select:** "Select…" (a ghost pill beside the filters) or `?select=1`.
- **Covers become checkboxes:** a `role="checkbox"` overlay at the top-left (≥24 px), with click to toggle. The cover's link is inert while selecting.
- **`SelectBar`:**
  - A sticky bottom `role="toolbar"` labelled "Selection". It slides up with Motion.
  - Count: "{n} selected", announced.
  - Actions: **Share to…** (opens `ShareSheet` in multi mode, applying `share` to each selected private item; items not private are skipped, and it says so: "2 shared · 1 already shared"), **Publish drafts** (enabled only when the selection includes drafts), **Remove** (confirm dialog → `remove` each → toast "Removed {n}" with **Undo**, which calls `restore` for each in reverse order), **Select all**, and **Done**.
  - Esc exits Select.
- **Cleanup:**
  - Delete the retired files and their routes. Keep the redirects.
  - Remove `/v4/library/:view` and point any remaining in-app links to the new places. Grep for `/v4/library/uploads`, `/drafts`, `/impact`, `/studio` in `src/features/spaces` and `src/App.tsx`.
  - Update `modes.test.tsx` and `reachable.test.tsx` expectations for the removed files only.
- **Tests:**
  - `?select=1` shows the checkboxes and the toolbar.
  - Select 2 → Remove → confirm → 2 gone → Undo → both back in place.
  - Publish drafts flips `m-axioms` to shared.
  - Share to… skips already-shared items with the right summary.
  - Esc leaves Select.
  - The redirects still land (the Task 2 tests stay green).
- Run the full suite: everything green, `reachable` green. Then commit `feat(library): Select is the one dense moment; the old Studio screens retire`.

---

## Verification (controller, in the browser)

Use the `dev-studio` preview on :5221. Keep the pane visible (use `preview_start`) and scroll with real wheel input. Check at 1440 and on phone:
1. On `/v4/library`, Continue shows Normalization.pdf at page 6 and its hover morph works.
2. Bring in a file → watch it develop → open it (zoom-through).
3. Read two pages, then go back → the life line is updated.
4. Share Design notes to Database Systems → the outcome reads Contribution → the cover turns teal.
5. Select → Remove → Undo.
6. `/v4/library/studio` redirects to the shelf.
