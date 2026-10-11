# Learn, deeper — design

**Date:** 2026-10-11 · **Branch:** `claude/studio-canvas-spec` · **Extends:** [Living Learn](2026-10-10-living-learn-design.md) and the [Studio canvas design](2026-10-10-studio-canvas-design.md). Mock-only, like everything in `src/features/spaces`.

The user chose three directions on 2026-10-11 ("keep working… be creative, impress me"):

1. **Answers you can play with:** OpenIntelligentUI-style interactive answers, woven into the page.
2. **Recall mode:** Learn turns into active recall.
3. **Depth dial:** each page can be read at four depths, from one line to the real page.

Each part ships on its own and works with the others. They are built in this order.

---

## Part 1 — Answers you can play with

### 1.1 What changes
An answer is no longer only a paragraph. The writer of an answer (the mock now, a model later) picks the **shape** that helps most. That can be prose, a side-by-side comparison, a table you edit, a step-through, or a question you answer first. The answer still grows under its paragraph with the Living Learn choreography. Its blocks arrive one after another, as if streamed.

### 1.2 The catalogue: ported, not invented
The reader branch (`claude/two-faces-lesson-styling-1da325`, `components/reader/iui/`) already built and tested a catalogue for this exact Material (Studio spec §5.1a). Studio ports `spec.ts`, `fd.ts` and the renderers from `Blocks.tsx` into `studio/answers/`.

The port changes three things:
- **Rendering:** it goes through Studio's `Markdown` (Streamdown) instead of the reader's `Prose`.
- **Timing:** constants come from `studio/motion.ts` instead of the reader's `Planes`.
- **Look:** every card uses Studio's tokens (`--studio-chip`, `--studio-hairline`, `--studio-woven`, `--studio-term`).

| Block | What you do with it | In v1? |
|---|---|---|
| `text` | Read prose | ✅ |
| `key` | One sentence that matters most, set apart | ✅ |
| `compare` | Two or three columns side by side | ✅ |
| `fdTable` | Edit cells in a real table; a live line says whether X → A still holds, and the rows that break it turn amber | ✅ |
| `closure` | Pick a start set and step through X⁺ one rule at a time | ✅ |
| `bcnf` | Split a relation into BCNF, one violating FD at a time | ✅ |
| `check` | Commit to an answer first, then see why | ✅ |
| `steps` | Numbered steps, walked one at a time | ✅ |
| `explore` | Parts of the page that light up on the original | ❌ Later: needs Peek to outline several spots at once |
| `sandbox` | Generated HTML in an iframe | ❌ Never in v1 (Studio spec §5.1a) |

### 1.3 Data model
```ts
// studio/answers/spec.ts (ported; sandbox and explore left out)
export type AnswerBlock = TextBlock | KeyBlock | CompareBlock | FdTableBlock | ClosureBlock | BcnfBlock | CheckBlock | StepsBlock;

// studio/types.ts
export interface GeneratedBlock {
  id: string; origin: 'generated'; markdown: string; citations: Citation[]; askedAs: string; anchorId: string;
  /** The answer's shape. `markdown` stays the plain-text version: screen readers, Morph labels, search. */
  blocks?: AnswerBlock[];
  /** "A table to try", "Step by step", … shown quietly beside "From your question". */
  format?: string;
}
```
`ScriptedAnswer` gains the same two optional fields.

### 1.4 Growing, block by block
- The answer grows exactly as in Living Learn §4.3: space opens and the teal rule draws down.
- Its blocks then settle one after another, 280 ms apart. Each block fades up 6 px and goes from blur(4px) to sharp.
- The **first text block** keeps the word-by-word settle. Interactive cards settle as one piece and become usable when they land.
- The total budget stays at about 2.5 s. With reduced motion, the whole answer is one 150 ms fade.
- Interactive state (edited cells, the closure step, the check you chose) lives in the card while it is mounted. It is not saved in v1.

### 1.5 Scripted answers (mock)
- The five existing answers get shapes:
  - "What is a functional dependency?" becomes `text` → `fdTable`: the creature table, `Name → Weight`. Change one Nidoran's weight and watch it break.
  - "Why doesn't commutativity hold?" becomes `text` → `fdTable` on X/Y/Z, with `Y → X` failing live.
- Three new answers are added, and the suggestions rotate to show them:
  - "What is the closure of {Title, Year}?" → `closure`.
  - "Split this relation into BCNF" → `text` → `bcnf`.
  - "Quiz me on Armstrong's axioms" → `check` (3 options) → `steps` (the transitivity proof from page 11).
- Every block's facts come from Normalization.pdf pages 5–12. Citations are guarded by fixture tests, as today.

### 1.6 Accessibility
- Every card is a labelled region (`role="group"`, `aria-label` = the card's title).
- Live results ("Name → Weight holds", "breaks in 2 rows") are `aria-live="polite"` inside the card.
- `check` options are real radio buttons. The reasons are shown only after you commit.
- All controls are at least 24 px and work with the keyboard.

---

## Part 2 — Recall mode

### 2.1 The idea
Reading feels like learning, while recalling actually is learning. One switch turns the calm summary into a gentle self-test. Every key term (the warm `**term**`s) becomes a soft blank. You try to remember it, tap, and it sharpens into view.

### 2.2 Interaction
- **Turning it on:**
  - A quiet **Recall** toggle in the header, left of the Learn · Source switch.
  - Press `R`, with the same key guards as `S`.
  - It works only in Learn. In Source the toggle is disabled.
- **A blank:** a rounded pill in the warm term colour at 14% opacity, about as wide as the term. The text is present but invisible, so the line never reflows when it is revealed. It is a real `<button>` labelled "Reveal term, page N".
- **Revealing:** tap, Enter or Space. The term goes from blur to sharp in 350 ms. A tiny two-choice row then fades in under it for 4 s: **Knew it** and **Not yet**. If you ignore it, the term counts as "seen".
- **Progress:** each page divider gets a small ring showing knew / total for that page, and the rail shows the same ring next to each page. When a whole page is known, its ring closes with one soft pulse.
- **Again:** at the end of the canvas, a quiet line reads "4 terms to try again" with a **Try again** button. It re-blanks only the "Not yet" terms and scrolls to the first one.
- **Reset:** "Start over" in the Recall toggle's menu.
- **What stays visible:** your notes, your handwriting and your answers. Only summary paragraphs blank their terms.
- **Gist paragraphs blank too.** The page's first sentence is often the best cue, and it carries the same weight as the rest.

### 2.3 State
`RecallState = { on: boolean; terms: Record<termKey, 'blank' | 'seen' | 'knew' | 'notYet'> }`, where `termKey = blockId + ':' + index of the term within the block`.

It is stored per canvas in `localStorage` (a per-viewer convenience, so browser storage is the right place, with try/catch). Progress is computed with pure functions in `studio/recall.ts`, so it can be tested without the DOM.

### 2.4 Rendering
`Markdown` gets an optional `recall` prop. When it is on, Streamdown's strong renderer (`components={{ strong }}` override) renders `RecallTerm` instead of the warm span. Each term knows its index through a counter that runs in render order. A block's terms are counted once with a regex over `**…**` in `markdown`, so render and state agree. A test guards that they do.

---

## Part 3 — Depth dial

### 3.1 The idea
Every page can be read at the depth you need right now. You can skim the gist, read the summary, check the full extracted text, or see the real page. You move between depths smoothly and never lose your place.

### 3.2 The four depths
| Depth | What the page shows |
|---|---|
| **Gist** | Only the page's gist paragraph |
| **Summary** | The calm summary (default) |
| **Full** | The page's extracted text: every text source block in reading order, rendered with `markdownFor`. This is the "near copy" Learn used to show |
| **Page** | The real page image for this page only, inline, with its regions (the `OriginalPage` component). Other pages are unaffected |

**Your blocks are always visible,** at every depth: notes, handwriting and answers.
- At **Gist**, they follow the gist in order.
- At **Full**, an answer or note anchored to a summary paragraph is placed after the last extracted block that paragraph covers.
- Page-only geometry (page 3) has no Full depth, because there are no blocks. The dial skips it.

### 3.3 Control
- A small four-stop dial sits at the right end of each page divider: four dots on a hairline, with the current one filled.
- It is labelled "Depth for page N", with options Gist · Summary · Full · Page (`role="radiogroup"`).
- Keys: `[` goes shallower and `]` goes deeper on the page you are on (the pager's current page), with the same key guards.
- **All pages at once:** hold Shift while choosing a depth on any dial.

### 3.4 Motion
- **Changing depth:**
  - The page section animates its height (Motion `layout`, 450 ms, the Studio ease).
  - Paragraphs present at both depths stay put.
  - Paragraphs leaving fade out in 150 ms; paragraphs arriving fade up and blur-in in 300 ms, staggered 30 ms.
- **Summary → Full:** each summary paragraph is replaced by the extracted blocks it covers, in its place. The cross-fade happens per paragraph, so it reads as "this sentence opened up into these".
- **Full → Page** reuses the Morph flight for this one page. Extracted blocks fly to their boxes on the image, as the global Source switch does, but only for this page.
- **Keeping your place:** the top of the page section never moves on screen. A depth change on a page above the viewport is compensated (`useKeepPlace`).
- **Reduced motion:** one 150 ms crossfade.

### 3.5 State and composition
- `depth: Record<page, Depth>` lives in the screen. It is not persisted in v1.
- A pure function `blocksAtDepth(group, depth, pages)` in `studio/depth.ts` returns what to render, and it is unit-tested.
- The global Learn · Source switch overrides the dial while Source is shown. Returning to Learn restores each page's depth.
- **With Recall:** at Full or Page there are no `**terms**`, so nothing is blanked. Progress counts only Summary and Gist terms.

---

## 4. Testing
- **Pure:**
  - `fd.ts` (ported tests, or new ones for `violations`, `closureSteps` and `bcnfSteps` on the fixture relations)
  - `recall.ts` (term keys, progress, try-again set)
  - `depth.ts` (each depth on a page with notes, answers and handwriting; page-only geometry; anchor placement at Full)
- **Components:**
  - every catalogue card renders and its interaction works (edit a cell → the violation appears; step the closure; commit a check → the reason shows)
  - the answer's blocks settle in order
  - `RecallTerm` reveal and marking, and the rings
  - the dial's keyboard and ARIA, and the Shift-all behaviour
- **Fixture:**
  - every scripted answer's blocks are valid
  - the `fdTable` and `closure` data matches the PDF's examples
  - citations are covered
- **Gates:** `tsc -p tsconfig.app.json`, eslint, `check-vocabulary`, `vitest run src/features/spaces`, a11y, boundary and motion.
- **Browser:**
  - at 1440 and on phone, ask "What is a functional dependency?" and break the dependency
  - do a recall pass on page 6
  - dial page 8 from Gist to Page and back

## 5. Out of scope
- Real AI: a model writing typed answers is Plan 2.
- Saving interactive state.
- `explore` and `sandbox` blocks.
- Spaced-repetition scheduling of recall terms. The Review engine exists on main and is a later bridge.
- Persisting depth.

## 6. As built (2026-10-11)

| Section | As built |
|---|---|
| §2.3 state | The recall state is keyed by **Material** (`studio:recall:<materialId>`), because pages belong to a Material now (One Library). Canvas-wide summary-term totals feed the shelf card through `setRecall`. |
| §2.2 Again | The footer counts across the whole Material. Try again returns a hidden term's page to Summary, then focuses the blank. Start over is a button beside the footer line, not a menu. |
| §2.2 reveal | Knew it / Not yet appear when you reveal a term. A revealed term you never marked can be tapped later to show the pair again. A term that is already seen does not replay its reveal. |
| §1.6 check | Radios choose an option, and a **Check** button commits it. Focus then moves to the explanation. |
| §3.3 keys | `[` and `]` change the depth of the page you are focused in, falling back to the current page. They work with Alt/AltGr (German layouts). Shift+arrow or Shift+Space on the dial sets every page. |
| §3.4 motion | Keep-place scrolls use `behavior: 'instant'`, because the app sets `scroll-behavior: smooth`. **Full → Page uses a crossfade.** The per-page Morph flight is deferred. |
| §3.2 Page | The inline page carries `data-inline` and is ignored by page navigation and keep-place. Your answers, notes and handwriting follow the image. Going back to a paragraph that is hidden at the current depth first returns its page to Summary. |
