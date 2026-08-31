# Build prompt · Lesson Reader v2 (Read · Source · Companions)

*A self-contained brief for extending the v4 Lesson Reader. Assumes no memory of previous
sessions. Written 2026-08-31 by the session that designed the reader vision mock.*

---

## 1 · What you are building, in one paragraph

The v4 reader today (`screens/ReaderScreen.tsx`) is a calm prose column — correct, and kept.
You are adding three things around it without breaking its calm: a **Source view** (the
original Material pages, page-synced to the passage being read — the layout the old product's
Library view got right), a **summonable right rail** with two panels (**Tutor** — grounded
chat; **Notes** — the existing private notes), and **selection-to-ask** (select text in a
passage → ask the tutor or save a note, with the selection carried as context). The vision
is drawn, interactive, at `docs/design-v4/reader-mockup.html` — open it in a browser first
and click everything. Where this prompt and that mock disagree with the design docs, the
docs win — say so rather than guessing.

**Mock data only. No API calls, no Supabase, no backend imports.** Work on your own branch
in your own worktree. Never commit to `main`.

## 2 · Read before writing code

1. `docs/design-v4/reader-mockup.html` — the vision, in a browser. Its collapsed
   "Design notes" section lists what was kept and rejected, with reasons. Rejected ideas
   stay rejected: no model picker, no inline AI rewriting, no sibling-Lesson stepper in
   the header, no persistent XP HUD, no canvas.
2. `docs/design-v4/01-foundations.md` (Locked v1.15) — source of truth.
3. `docs/design-v4/02-navigation.md` (Locked, may live on another worktree — search
   `find ~/Desktop/ascend-academy/.claude/worktrees -name "02-navigation.md"`). The reader
   is a **Learn** surface: calm, no dense controls, and an Owner sees exactly the reader a
   Member sees.
4. `src/features/spaces/screens/ReaderScreen.tsx` — what exists. Its three named decisions
   (passage-per-Concept, measured 52ch, reading changes no progress) all survive this build.
5. `src/features/spaces/BUILD-PROMPT.md` §self-review loop and
   `mocks/__tests__/fixtures.test.ts` — the working pattern and the test pattern to copy.

## 3 · GLOBAL CONSTRAINTS

These bind every task. A violation is a defect regardless of what a task's own text says.

- **Focus surface.** `Scene` with `SURFACES.lessonReader` (`'focus'`); no `SpacesTopBar`.
  The rail is *summoned, never squatting*: **with the rail closed, the article column must
  render exactly as it does today** — same 52ch measure, same max-width, not narrowed or
  shifted to reserve rail space. Rail state does not persist across Lessons.
- **Vocabulary law.** Banned in all UI copy: professor · student · teacher · instructor ·
  course · classroom · module · folder · lecture · LMS. The source is the **Material**; its
  unit is a **page**. Never "slide", "deck", or "document" in copy.
- **Grounding is chrome, not prose** (Doc 1, locked). The tutor panel shows one quiet
  grounded marker at its top **only when `space.groundingEnabled` is true**; when it is
  false render **no marker at all**. Tutor message text never claims groundedness.
- **Reading changes no progress.** Nothing here marks a Concept cleared, awards XP, mutates
  `progress`/`percentComplete`, or lights the map. No XP chrome anywhere in the reader.
- **Notes are Lesson-anchored and private.** Selection-to-note stores the quote **inside the
  note body**, not as a new field or anchor type. Reuse `NoteEditor` and `mocks/notes.ts`.
  Established copy: "Private to you, and gathered in your Library."
- **Rule 1 — Members see only published content.** Keep going through `visibleLesson`.
- **The pager walks published Lessons only** — `adjacentLessons` already enforces this.
- **Role never changes the reader.** No Owner-only controls; editing lives in Studio.
- **A11y:** every control keyboard-reachable with a visible focus ring (`console-focusable`
  is the existing utility); the rail is a `<aside>` landmark with an accessible name;
  reduced motion respected (the `Scene` `MotionConfig` already covers descendants).
- **Do not touch** `features/courses/`, `features/student/`, `features/assignments/`, or
  import from them. Do not edit `docs/design-v4/**` (another session owns it).

## 4 · Components to build (all under `src/features/spaces/`)

| Piece | What it is |
|---|---|
| `components/reader/ReaderHeader.tsx` | Fixed slim bar: exit ✕, `Space · Lesson N`, centered Read/Source segment, Concept progress dots, two rail toggles. |
| `components/reader/SourceView.tsx` | Material pages one at a time, pager (`n / total`), and a "belongs to {Concept}" sync line linking back to the passage. |
| `components/reader/ReaderRail.tsx` | Docked panel: Tutor/Notes tabs, close. Overlays instead of docking under 900px. |
| `components/reader/TutorPanel.tsx` | Conditional grounded marker, empty state, thread, citation chips, three quick prompts, composer. |
| `components/reader/SelectionAsk.tsx` | Popover on text selection inside the article: "Ask the tutor" / "Save as note". |
| `mocks/tutor.ts` | The swap seam — canned deterministic replies. Wiring later replaces this module only. |

`ReaderScreen.tsx` composes these; the article column itself changes as little as possible.

## 5 · The fixture you are building against

**`l-s-dbs-4` — "Normalization", Lesson 4 of Space `s-dbs` (Datenbanksysteme).** It is the
only fixture with `passages` written. Its five Concepts are `c-l-s-dbs-4-1` … `c-l-s-dbs-4-5`
(Functional dependency · 1NF · 2NF · 3NF · BCNF). The vision mock uses B-Trees as
illustrative content — **ignore the mock's subject matter and use this fixture.** Route:
`/v4/space/s-dbs/lesson/l-s-dbs-4/read`.

---

## Task 1 · ReaderHeader and the Read/Source toggle

**Goal:** replace the reader's current inline `✕ + breadcrumb` row with a fixed header
carrying the view toggle, Concept progress dots, and the two rail buttons. The article
column below is otherwise untouched.

**Files:** create `src/features/spaces/components/reader/ReaderHeader.tsx`; edit
`src/features/spaces/screens/ReaderScreen.tsx`.

**Build:**

1. `ReaderHeader` props: `{ spaceName: string; lessonOrder: number; backTo: string;
   concepts: Concept[]; view: 'read' | 'source'; onViewChange?: (v: 'read'|'source') => void;
   showToggle: boolean; railOpen: boolean; railTab: 'tutor' | 'notes' | null;
   onRailToggle: (tab: 'tutor'|'notes') => void }`.
2. Layout: fixed to the top, height 56px, `backdrop-blur`, hairline bottom border, sitting
   above the article. Left: round exit button linking to `backTo`, `aria-label="Leave the
   reader"`. Then `{spaceName} · Lesson {lessonOrder}`, truncating.
3. Centre: a two-button segmented control, "Read" / "Source", `role="tablist"`. **Rendered
   only when `showToggle` is true** (Task 2 supplies the condition; for this task pass
   `false` and leave the Source branch unbuilt).
4. Right: Concept progress dots — one dot per Concept, styled by `progress`
   (`cleared` → success, otherwise neutral). This is a **display of existing state, not a
   control and not new progress**: no click handler. Give the group an `aria-label` of
   `"{n} of {total} ideas cleared"` and hide the individual dots from a11y.
5. Right: two icon buttons, "Tutor" (`Sparkles`) and "Notes" (`NotebookPen`), each
   `aria-pressed` reflecting whether that tab is the open one. For this task they may call
   `onRailToggle` with no rail behind it — wire the no-op and let Task 3 mount the rail.
6. In `ReaderScreen`, hold `view` and rail state (`railTab: 'tutor'|'notes'|null`) in
   `useState`. Remove the old inline `✕` row. Add top padding to the article so the fixed
   header does not overlap the first line.
7. A scroll-progress bar (2px, gradient, fixed at the very top) reflecting document scroll.
   Pure decoration over the reading position; it is **not** Lesson progress and must not be
   labelled as such. `aria-hidden`.

**Constraint check for this task:** the header shows no XP, no Lesson stepper, no
Owner-only control. Dots are `cleared`-vs-not only — never a percentage.

**Tests** (`components/__tests__/`): header renders breadcrumb and exit link; dots count and
`aria-label` match the fixture's Concepts; the segment is absent when `showToggle` is false;
rail buttons carry correct `aria-pressed`. Extend `labels.test.tsx` with the new copy.

**Verify:** `/v4/space/s-dbs/lesson/l-s-dbs-4/read` in the browser — header present, article
not overlapped, still the calm column.

---

## Task 2 · SourceView — the Material, page by page

**Goal:** the Material's pages as a second view of the same Lesson, synced to Concepts.

**Files:** create `components/reader/SourceView.tsx`; edit `types.ts`,
`mocks/lessons.ts` (fixture data only), `screens/ReaderScreen.tsx`.

**Build:**

1. Extend `Material` in `types.ts` with `pages?: MaterialPage[]`, and add
   `export interface MaterialPage { page: number; conceptId: string; title: string;
   bullets: string[] }`. Document why the pages live on `Material` and not on `Lesson`:
   they are the *file's* structure, and deleting the Material is exactly what removes them.
2. Give `l-s-dbs-4`'s Material a `pages` array — 10–14 pages spread across the five
   Concepts in passage order, with real Normalization content (short titles, 3–4 bullets).
   No lorem. Every `conceptId` must be one of that Lesson's five.
3. `SourceView` props: `{ pages: MaterialPage[]; concepts: Concept[];
   onJumpToPassage: (conceptId: string) => void }`. Internal `useState` for the current
   page index.
4. Render one page as a light "page" card (the material is a document; it reads as paper
   against the dark ground), with its title and bullets. Below it: `‹`, `n / total`, `›`,
   with `font-variant-numeric: tabular-nums`. Disable at the ends rather than wrapping.
5. Under the pager, the sync line: "This page belongs to **{Concept name}**" where the
   Concept name is a button calling `onJumpToPassage`. In `ReaderScreen` that switches to
   the Read view and scrolls that passage into view.
6. `showToggle` for Task 1's header becomes
   `lesson.passages?.length > 0 && (lesson.material?.pages?.length ?? 0) > 0`.
7. **The state that replaces a dead end:** when the Lesson has a Material with pages but
   **no** passages, the reader opens in the Source view instead of today's "Not written yet"
   screen, and the toggle is absent. When it has neither, today's "Not written yet" screen
   stays exactly as it is. Give one fixture each of these two shapes.
8. When `lesson.material === null`, there is no Source view and no toggle. The Read view
   keeps the existing "The original file was removed" affordance semantics — do not
   duplicate that copy into the reader if it is not already there.

**Tests:** page↔concept mapping guard in `mocks/__tests__/` (every `page.conceptId` resolves
to a Concept of that Lesson; pages are contiguous from 1); SourceView pager bounds; sync line
names the right Concept; the three shapes in §7/§8 render the right thing; toggle absent when
`material` is null.

**Verify in the browser:** toggle both ways; pager to both ends; sync line jumps to the
matching passage.

---

## Task 3 · ReaderRail and the Notes panel

**Goal:** the docked companion shell, with Notes as its first real panel.

**Files:** create `components/reader/ReaderRail.tsx`; edit `screens/ReaderScreen.tsx`.

**Build:**

1. `ReaderRail` props: `{ open: boolean; tab: 'tutor'|'notes'; onTabChange: (t) => void;
   onClose: () => void; tutor: React.ReactNode; notes: React.ReactNode }`. It owns chrome
   only — the panels are passed in, so Task 4 drops the tutor in without touching this file.
2. `<aside aria-label="Reader companions">`, fixed to the right below the header, 384px wide,
   left hairline border, its own scroll. Header row: two tabs + a close button.
3. **Docking:** at ≥900px, opening the rail shifts the main column left so nothing is
   covered. Below 900px it overlays the content instead (the article stays put), with the
   same close affordance. The article's own measure never changes — the column shifts, it
   does not narrow.
4. Closed, the rail is unmounted or fully translated off; either way **no layout trace**.
5. Notes panel content, composed in `ReaderScreen`: the existing `notesForLesson` list
   rendered with `NoteEditor` for each, plus a new-note `NoteEditor` with the established
   placeholder "Private to you, and gathered in your Library." Use the same `noteTick`
   re-render pattern `LessonScreen.tsx` uses — the note store lives outside React.
   Empty state: "Nothing yet. Notes are private, and only you ever see them."
6. Escape closes the rail. Focus moves into the rail when it opens and returns to the
   button that opened it when it closes.

**Tests:** rail is absent from the tree when closed; tab switching; Escape closes; adding a
note through the rail appears in the list and in `allNotes()`; the article column's classes
are unchanged between rail-open and rail-closed (this is the "summoned, never squatting"
guard); `a11y.test.tsx` extension for the landmark and its name.

**Verify:** open/close at desktop and at 800px wide; write a note; reload-free re-render.

---

## Task 4 · TutorPanel

**Goal:** a grounded tutor thread that cites back into the Lesson.

**Files:** create `components/reader/TutorPanel.tsx`, `mocks/tutor.ts`; edit
`screens/ReaderScreen.tsx`.

**Build:**

1. `mocks/tutor.ts` is the swap seam — the only module a real backend would replace:
   ```ts
   export interface TutorCitation { label: string; conceptId?: string; materialPage?: number }
   export interface TutorReply { text: string; citations: TutorCitation[] }
   export function askTutor(lessonId: string, question: string, quote?: string): Promise<TutorReply>
   ```
   Deterministic canned replies keyed by `lessonId` (no randomness, no `Date.now()` in the
   reply body — tests must be able to assert exact text). Resolve after a short timeout so
   the pending state is real. Write 4 exchanges for `l-s-dbs-4`, at least one taking a
   `quote`, and include both citation kinds across them. Every `conceptId` must be a real
   Concept of that Lesson; every `materialPage` a real page from Task 2. Provide one
   generic fallback reply for a Lesson with no script.
2. `TutorPanel` props: `{ lesson: Lesson; groundingEnabled: boolean;
   onCiteConcept: (conceptId: string) => void; onCiteMaterial: (page: number) => void;
   pendingQuote?: string; onQuoteConsumed: () => void }`.
3. Top: the grounded marker — one quiet line, `groundingEnabled` only. Copy:
   "Grounded — answers draw on this Space's Lessons and name where they came from."
   No marker at all when grounding is off (a marker on everything is a marker on nothing).
4. Empty state before the first message: "Ask about anything in this Lesson — or select a
   sentence in the text and start from there."
5. Thread: an optional quote chip (the carried selection, italic, quote-marked), the user's
   message, the tutor's reply, then its citation chips. A chip with a `conceptId` calls
   `onCiteConcept`; one with a `materialPage` calls `onCiteMaterial`. In `ReaderScreen`
   those switch to the right view and scroll/paginate to the target. **When
   `lesson.material === null`, a `materialPage` citation renders as plain text, not a
   button** — there is nothing to open.
6. A pending state while `askTutor` is in flight, and an error state if it rejects, with a
   retry. Do not leave a dead composer.
7. Three quick prompts as chips: "Explain more simply", "Concrete example", "Why does this
   matter?". Composer: input + send, Enter submits, empty input does nothing.
8. The thread resets when `lesson.id` changes. No cross-Lesson memory in v1.

**Constraint check:** no model picker, no vendor names, no "regenerate", no thumbs rating.

**Tests:** marker present/absent by `groundingEnabled`; empty state; a question renders the
canned reply and its chips; a Concept chip fires `onCiteConcept` with the right id; a
material chip is inert text when `material` is null; pending then resolved; thread clears on
lesson change; `labels.test.tsx` covers the new copy.

**Verify:** ask each quick prompt; click both chip kinds and land in the right place.

---

## Task 5 · SelectionAsk — starting from the text

**Goal:** select a sentence in a passage, then ask about it or keep it.

**Files:** create `components/reader/SelectionAsk.tsx`; edit `screens/ReaderScreen.tsx`.

**Build:**

1. Listen for selection changes **scoped to the article element only** — a selection in the
   rail or the header never triggers it. Trigger above a minimum length (8 characters) so a
   stray click never pops it.
2. Render a small popover positioned above the selection rectangle, clamped into the
   viewport. Two actions: "Ask the tutor" and "Save as note".
3. "Ask the tutor" opens the rail on the Tutor tab and hands the selection over as
   `pendingQuote`. "Save as note" opens the rail on Notes and creates a note whose body
   carries the quote followed by a blank line — the quote lives **in the body**, per the
   global constraint. Confirm the save visibly.
4. Dismiss on outside click, on scroll, on Escape, and when the selection collapses.
5. **Keyboard path.** Selection is a pointer gesture, so it must not be the only route: the
   header's Tutor and Notes buttons already reach both panels, and this task must not
   regress that. Additionally the popover itself, once shown, is tab-reachable and its
   buttons are activatable by keyboard.

**Tests:** popover appears for a long selection inside the article and not for a short one;
not for a selection outside the article; "Ask" routes the quote into the tutor thread;
"Save as note" writes a note containing the quote text; Escape dismisses.

**Verify:** select across two paragraphs; both actions; Escape.

---

## Task 6 · States and the a11y sweep

**Goal:** every state real, every control reachable.

**Build:**

1. Cover, with a fixture or a query flag for each, and confirm in the browser:
   passages + Material with pages · passages but `material: null` · Material with pages but
   no passages · neither · `groundingEnabled: false` · `?mock=loading` · `?mock=error`.
2. Confirm the existing `?mock=` handling still reaches the reader unchanged.
3. A11y: run the existing `a11y.test.tsx` patterns over the new surface — focus rings on
   every new control, the rail's landmark and name, the dots' label, `aria-pressed` on the
   rail toggles, the popover's keyboard path, and heading order (`h1` Lesson title, `h2` per
   passage) unbroken by the new chrome.
4. Reduced motion: nothing new animates on transform outside `Scene`'s `MotionConfig`.
5. Responsive: 1440, 1024, 900, 768, 375. The rail overlays below 900; the article never
   scrolls sideways; the source page card scales rather than overflowing.

**Tests:** a state test per shape in §1; extend `responsive.test.tsx` and `a11y.test.tsx`.

---

## Task 7 · Self-review loop

**Goal:** find your own violations before the reviewer does.

Walk **every bullet of §3 GLOBAL CONSTRAINTS** against the built screen, plus the four
rejected ideas in §2.1. Write what you checked and what you found into
`src/features/spaces/READER-REPORT.md` — findings first, then fixes. A review that lists no
findings is a review that was not run; if you genuinely find none, say what you checked and
how you confirmed each.

Then run the full check: `npx tsc -p tsconfig.app.json --noEmit` (**not** `tsconfig.json`
— it checks nothing), the vitest suite for `features/spaces`, and a browser pass over
Task 6's state list.

---

## 8 · Do not decide these — surface them instead

- **What reading does to the map** is still open (Doc 1). The reader keeps changing no
  progress; if that feels wrong while building, report it, don't fix it.
- **Community in the reader**: contributions stay on the Lesson overview. If a "3 members
  explained this idea" affordance seems to belong on a passage, write it up as a proposal
  instead of building it.
- **Tutor memory across Lessons** — v1 resets per Lesson. Flag if that reads badly in use.

## 9 · Verify before claiming done

`/v4/space/s-dbs/lesson/l-s-dbs-4/read` in the browser via the preview tools, every state in
Task 6, plus: select text → ask → citation chip → lands on the right passage; close rail →
the column is identical to the calm reader. The gate that lies: `tsc -p tsconfig.json`
checks nothing — use `tsconfig.app.json`.
