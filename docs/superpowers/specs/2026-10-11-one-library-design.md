# One Library — design

**Date:** 2026-10-11 · **Branch:** `claude/studio-canvas-spec` · **Status:** approved direction ("give it a really solid and simple and scalable smart structure… build it"). Mock-only (`src/features/spaces`).

**Amends:** Doc 2 (navigation and modes) in two places, listed in §9. Supersedes the Studio home screen (Studio spec §3.1) and the three dense Library screens (uploads, drafts, impact).

---

## 1. The idea in one line

> **Everything you bring in becomes a living page. Library is where those pages live. You read them, ask them, recall them and, when you're ready, share them, without ever changing place.**

Library and Studio stop being two things. Library is the only place. The page you open from it is the Studio canvas, renamed by what it is: **your page**.

## 2. Who it serves (from Doc 1, Doc 2 and the specs)

There are no learner or teacher accounts; roles live in the room (Doc 1). One person has two kinds of days:

| On a learning day they want… | On a sharing day they want… |
|---|---|
| to make a file **understandable**, fast and calm | to turn it into something **good for others**, without a second tool |
| to **ask** about what confuses them, with proof from the file | to **check** it before anyone sees it; nothing public by accident |
| to **remember** it, not just read it | to share it **to the right Space, the right way** for their role |
| their **own words** kept next to the page they are about | to see **how it landed** |

One object and one place serve both. Learning is the default. Sharing is the last step on the same page.

## 3. The structure: one object, one journey

### 3.1 One object: the Shelf item
Everything on the shelf is a **Material**, a file you brought in (the locked noun). It carries the full story of that file.

```ts
interface ShelfItem {
  id: string;                    // = Material id
  filename: string;
  pageCount: number;
  cover: string;                 // first-page image (WebP poster), or '' while developing
  /** Where the file is in its preparation. Pipeline states, collapsed for people. */
  stage: 'developing' | 'ready' | 'failed';
  /** Where it is in the world. Exactly one. */
  share:
    | { kind: 'private' }
    | { kind: 'draft'; spaceId: string; as: ShareAs }
    | { kind: 'shared'; spaceId: string; as: ShareAs; likes: number; endorsed: boolean; cleared: number };
  /** Where your page lives. A canvas id, or a Lesson route for files already turned into a Lesson elsewhere. */
  opens: { kind: 'canvas'; canvasId: string } | { kind: 'lesson'; spaceId: string; lessonId: string };
  progress: { pagesRead: number; recallKnew: number; recallTotal: number; answers: number; notes: number };
  lastOpenedAt: string | null;
  lastPage: number | null;
  addedAt: string;
}
type ShareAs = 'lesson' | 'community-lesson' | 'contribution';
```

The rules:
- **One file, one card.** The canvas, its answers, recall marks, notes and its share state all belong to that card.
- **`share` is the only field that changes who can see something.** Autosave never touches it (Studio spec §7). It changes only through the Share flow (§5.4).
- **`opens` keeps the model honest at scale.** A file already published as a Lesson opens that Lesson. A file you brought in opens its canvas. Nothing points nowhere.

### 3.2 One journey, derived and never stored
The journey has four moments, computed by a pure `journeyOf(item)`:

| Step | Reached when |
|---|---|
| **Brought in** | always |
| **Understood** | `stage === 'ready'` and (`pagesRead ≥ 1` or `answers ≥ 1`) |
| **Shared** | `share.kind !== 'private'`; a draft counts as *in progress*, a share counts as *done* |
| **Landed** | `share.kind === 'shared'` and (`likes > 0` or `endorsed` or `cleared > 0`) |

The card's state dot and the page's journey row both read from it, so they can never disagree.

### 3.3 Your words, also derived
`yourWords()` merges into one stream, newest first:
- your **Notes** (existing objects: anchored, private, written in Library), and
- your canvas **answers** and **written** blocks.

Each entry carries its file, page and a deep link to the exact block (`/v4/library/m/:id#b-<blockId>`). Notes keep their editor and their re-anchoring.

## 4. Routes: small, flat, permanent

| Route | What | Mode |
|---|---|---|
| `/v4/library` | The shelf, with filters `?f=all\|reading\|shared\|words`, search `?q=` and selection `?select=1` | Learn (calm). Select reveals a toolbar, the one documented exception (§9) |
| `/v4/library/m/:materialId` | Your page: the canvas (Learn · Source, Ask, Recall, Depth, Share) | Calm working surface (§9) |

These redirect, so old links keep working:
- `/v4/library/studio` → `/v4/library`
- `/v4/library/studio/c/:canvasId` → `/v4/library/m/<material of that canvas>`
- `/v4/library/uploads` → `/v4/library?f=reading&select=1`
- `/v4/library/drafts` → `/v4/library?f=shared&select=1`
- `/v4/library/impact` → `/v4/library?f=shared`

No new top-bar destination. Five stay five (Doc 2). "Studio" disappears as a place and as a word in navigation.

## 5. The flows

### 5.1 Arrive
The shelf screen, top to bottom:
1. **Masthead.** "Library", with the lede "What you brought in, what you made of it, and what you shared."
2. **Filters.** Everything · Reading · Shared · Your words, each with a quiet count. A search field appears from 9 items up. Sort is "Recently opened" by default, with "Added" and "A–Z" in a small menu. Once there are more than 8 items you can toggle "Group by Space", which groups shared and draft items under their Space name and puts private ones under "Only you".
3. **Continue.** One large card for the most recently opened ready item. Its real page sits beside its title, life line and a white "Continue reading" pill. Hovering or focusing the page cross-fades it into the summary's first lines (the Morph motif at shelf scale).
4. **The shelf.** A responsive grid of covers, `minmax(232px, 1fr)`. The first cell is always **Bring something in**.
5. **Empty Library.** The page itself is one big, calm drop target: "Bring in your first file — PDF, PPTX or a photo. It becomes a page you can read, ask and remember."

### 5.2 A cover
- **The page:** the real first page at 4:3. On hover or focus it shows the summary's first lines.
- **Title:** filename. **Meta:** the Space name or "Only you", plus the page count.
- **Life line:** a 3 px bar for `pagesRead / pageCount`, and under it a quiet row, "Read 6/12 · Recall 9/31 · 2 answers · 1 note". A zero is left out rather than shown.
- **State chip** with a dot:
  - white: "Only you"
  - amber: "Draft in {Space}"
  - teal: "Shared in {Space}", plus ♥ likes and "Endorsed" when true
  - pulsing grey: "Developing…"
  - red: "Couldn't read this file · Try again"
- The whole cover is one link, with `aria-label` "{filename}, {state}, {progress}". The menu (⋯: Share, Rename, Remove) is a separate button.

### 5.3 Bring in
- **Where:** drop anywhere on the Library screen (a full-page drop veil appears: "Drop to bring it in"), use the first cell, or press `U`.
- **The new cover develops in place**, inserted first with a Motion scale-in:
  - The page image starts at `blur(14px) grayscale(1) opacity(.5)`.
  - The label moves from "Reading your pages…" to "Writing your summary…", then resolves sharp.
  - The life bar runs underneath.
  - At ready, the chip briefly pulses "Only you · ready".
  - A polite announcement says "{filename} is ready".
- **Mock honesty:** a brought-in file develops in about 3.5 s and opens the sample pages. The cover says "Sample pages in this preview" until real import exists. It is never silent.
- **Failure** (mocked with `?mock=import-error`): the red chip, a "Try again" button, and the file stays on the shelf.

### 5.4 Open: the cover becomes the page
- Clicking a cover plays a **zoom-through** in Motion. The cover's page image scales to fill the viewport and the rest of the shelf dims and recedes (scale .98, 300 ms). At the end, the route changes to `/v4/library/m/:id`. The page enters from the same frame: its first page section fades up from the image.
- Back reverses it, returning the cover to its grid slot. With reduced motion, a 150 ms fade.
- The page remembers your place: `lastPage`. Opening a ready item scrolls to the last page you read, and the counter says "Back on page 6".

### 5.5 Your page (the canvas, with a Library header)
- **Header:** ← Library, a breadcrumb "Library · {filename}", the Learn · Source switch, then **Share**. While a share is in progress the button reads "Draft in {Space}"; once shared it reads "Shared · ♥ 3".
- **Journey row:** a quiet four-step row (Brought in · Understood · Shared · Landed) under the header on wide screens, folded into the Share button's menu on phones.
- **Progress flows back to the shelf:** turning to a page updates `pagesRead` and `lastPage`; asking updates `answers`; recall updates `recallKnew`/`recallTotal`. This goes through the store (§6), so going back to Library shows the new life line at once.

### 5.6 Share
- **Share** opens a sheet (Radix dialog). It lists the viewer's Spaces, each with its mode and your role, e.g. "Database Systems · Guided · you're a member".
- Choosing one shows **exactly what will happen**, from a pure function `shareOutcome(role, mode)`:

| Your role there | Mode | It becomes | Copy |
|---|---|---|---|
| Owner / Editor | any | a **draft Lesson** (`as: 'lesson'`, `kind: 'draft'`) | "It becomes a draft Lesson in {Space}. Only you and editors see it until you publish." |
| Member | Open | a **Community Lesson** (`as: 'community-lesson'`, `kind: 'shared'`) | "Open Space: it joins the path as a Community Lesson, with your name on it." |
| Member | Guided | a **Contribution** (`as: 'contribution'`, `kind: 'shared'`) | "It arrives as your Contribution, with your name on it. The owner can endorse it into the path." |

- **Confirm:** "Share to {Space}". The sheet closes, the journey's Shared step fills, the button updates, and the cover's dot changes on return.
- **A draft goes live** with "Publish" from the Share button's menu on the page, or from Select on the shelf. Publish is the only action that turns `draft` into `shared`.
- **Unshare** is "Take back to only you", with a confirm. It returns `share` to `private`.

### 5.7 Your words
The "Your words" filter replaces the shelf with the stream from §3.3:
- **Notes** keep inline edit and "New note".
- **Answers** show their question and first lines, and link into the page at that block.
- **Orphan contributions** keep their re-anchor action, under "Needs a new home".

### 5.8 Select (the dense moment, on purpose)
- **Select…** (or `?select=1`) turns every cover into a checkable tile and slides in a sticky toolbar. The toolbar shows a count and **Share to…**, **Publish drafts** and **Remove**, plus Select all and Done.
- Remove has a confirm and an undo toast.
- This is the only dense surface, and it comes from Library rather than living on a separate screen.

## 6. Data and seams (scales from mock to real)
- **`mocks/shelf.ts`** is an in-memory store with `subscribe` (the same pattern as `mocks/reanchor-store.ts`).
  - Seed: Normalization.pdf, plus the viewer's uploads derived from `mocks/library.ts` (lesson materials, `opens: lesson`), plus two hand-made private items that open the sample canvas.
  - Mutations: `bringIn(filename)`, `markRead(id, page)`, `bumpAnswers(id, delta)`, `setRecall(id, knew, total)`, `share(id, spaceId)`, `publish(id)`, `unshare(id)`, `remove(id)`, `restore(item, index)`.
- **`data/useShelf.ts`** is the seam. It returns `{ state, items, continueItem, words, actions }` with the usual `useSettled(useScenario())` load states. The real backend replaces this body only.
- **Pure functions** live in `studio/shelf.ts`: `journeyOf`, `shareOutcome`, `lifeLine`, `filterItems(items, f, q)`, `sortItems`, `groupBySpace`, `yourWords`. All are unit-tested.

### Scale
- Covers use `loading="lazy"` WebP posters (the egress lesson).
- Search and grouping turn on at a size threshold.
- The store and its selectors are O(n).
- No item type is special-cased in components: everything flows through `ShelfItem`.

## 7. Design language
- The stage, top bar, `Skylight` and `Masthead` are Library's own, monochrome, from the merged UI.
- Covers use `rounded-2xl`, a hairline border and `bg-white/[0.03]`. Hover lifts by 3 px with the Studio ease.
- State colours reuse the Studio tokens: white (only you), amber `--studio-mark` (draft), teal `--studio-woven` (shared), warm `--studio-term` (key words).
- Motion: Motion only, the Studio ease `cubic-bezier(.2,.8,.2,1)`, and every `AnimatePresence` child has an `exit`. With reduced motion, everything becomes a 150 ms fade.
- Copy is calm, never salesy. It passes the vocabulary gate. "Studio" is no longer a UI word for a place.

## 8. Accessibility
- **Covers** are links with full names; their menus are separate buttons.
- **The drop veil** is announced. "Bring something in" is a real file input with a label.
- **The Share sheet:**
  - It is a dialog with focus trapped.
  - The Spaces are a radiogroup, and the outcome text sits in an `aria-live="polite"` region.
- **Select mode:**
  - Covers become checkboxes.
  - The toolbar is a `role="toolbar"` with a label.
  - Counts are announced.
- **Keys:** `U` (bring in) and `/` (search, on the shelf only) use the `keys.ts` guards.

## 9. Doc 2 amendments (the user decided, 2026-10-11)
1. **Library holds your files and your words together.** Doc 2 rejected "Library = your Materials and your Notes" as a second index. One Library makes it the only index: the Studio home, uploads, drafts and impact screens are removed.
2. **Your page is a calm working surface, not a dense Studio screen.** This is the open decision in Studio spec §12, resolved: the dense moment is Select on the shelf.

Unchanged: five destinations, Notes written in Library, Publish as the only visibility change, roles living in the room, and the role-aware mapping (Studio spec §7).

## 10. Testing
- **Pure:**
  - `journeyOf` (every row of §3.2)
  - `shareOutcome` (every row of the §5.6 table, for owner, editor and member × guided and open)
  - `filterItems`, `sortItems`, `groupBySpace` and `yourWords` (ordering, deep links)
  - the store's mutations, including the undo restore
- **Fixture:**
  - every `opens` resolves: a canvas exists, or the Lesson exists in its Space
  - every `share.spaceId` is a Space the viewer belongs to
- **Screens:**
  - the shelf renders Continue and the covers, with names that include the state
  - filters and search narrow the shelf
  - bringing in a file develops a new cover
  - opening a cover goes to `/v4/library/m/:id`
  - the page shows the Share button and the journey
  - sharing as a member of a Guided Space reads "Contribution" and updates the state
  - Select → Publish drafts flips drafts to shared
  - the redirects land correctly
  - Your words shows notes with an editor and answers with deep links
- **Gates:** `tsc -p tsconfig.app.json`, eslint, the vocabulary check (studio, screens and data directories clean), `vitest run src/features/spaces`, boundary, a11y, modes, motion, and reachable.
- **Browser:**
  - 1440 and phone
  - bring in → develop → open (zoom-through) → read two pages → back (the life line updated) → Share to Database Systems (Contribution) → the cover shows teal
  - Select → Remove → Undo
