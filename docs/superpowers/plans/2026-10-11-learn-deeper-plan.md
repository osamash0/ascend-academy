# Learn, deeper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three features for Studio Learn:
- answers you can play with (typed interactive blocks woven into the page)
- Recall mode (key terms become blanks you reveal)
- a per-page Depth dial (Gist → Summary → Full → Page)

**Architecture:**
- **Part 1** ports the reader branch's typed answer catalogue (`claude/two-faces-lesson-styling-1da325`, `src/features/spaces/components/reader/iui/`) into `studio/answers/`. `GeneratedBlock`/`ScriptedAnswer` get an optional `blocks`. `WovenAnswer` renders those blocks one after another.
- **Part 2** adds pure recall state (`studio/recall.ts`), a `RecallTerm` renderer injected through `Markdown`'s strong override, and progress rings.
- **Part 3** adds a pure `blocksAtDepth` (`studio/depth.ts`), a `DepthDial` on each page divider, and per-page depth rendering in `CanvasPage`. The deepest step reuses `OriginalPage` and the Morph flight for that one page.

**Tech Stack:** React 18, TypeScript, Tailwind 3.4, Motion 13 (`motion/react`), Streamdown 2.7.0 via `studio/components/Markdown.tsx`, Vitest + happy-dom + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-11-learn-deeper-design.md`. It extends `2026-10-10-living-learn-design.md` (read its §11 "As built") and `2026-10-10-studio-canvas-design.md`.

## Global Constraints

- All code lives under `src/features/spaces/` (mock-only v4). No new dependencies. Imports from outside the namespace must pass `src/features/spaces/__tests__/boundary.test.ts`. **Never import from another branch.** Copy code in with `git show <branch>:<path>` and adapt it.
- UI copy must pass `node scripts/check-vocabulary.mjs`. Banned words, singular and plural, case-insensitive: professor, student, teacher, instructor, course, classroom, module, folder, lecture, lms, slide, deck, document. Ported code contains "lecture" and "slide" in comments and copy: rewrite them, e.g. "page" or "Material".
- Motion owns animation: use `motion/react`, never CSS keyframes. Every `AnimatePresence` child needs an `exit` (`components/__tests__/motion.test.tsx`). `reachable.test.tsx` requires every exported component to be mounted somewhere by the end of each Part. A red result is allowed only between tasks of the same Part.
- Decorative icons get `aria-hidden`. Interactive targets are at least 24×24 px.
- Internal identifiers stay: view values `'clean'`/`'original'`, `data-view`, `data-extracted`, `data-block-id`, `data-page-anchor`, `data-woven`. The UI says **Learn** / **Source**.
- Window keys (`R`, `[`, `]`) use `studio/keys.ts` (`isTyping`, `inDialog`) and ignore modifiers (except Shift where specified) and `e.repeat`. They must not collide with `S`, `/`, ← →, Space or Esc.
- Hold callbacks used inside timers or listeners in refs, not in effect deps (lesson from Living Learn).
- Never run side effects inside a React state updater (StrictMode double-invokes them).
- Reduced motion (`useReducedMotion()`): one 150 ms fade instead of any choreography.
- Browser storage is only for per-viewer conveniences, wrapped in try/catch, and the page must work without it.
- Gates, run from the worktree root:
  - `npx tsc -p tsconfig.app.json --noEmit`
  - `npx eslint <changed files>`
  - `node scripts/check-vocabulary.mjs`
  - `npx vitest run src/features/spaces --maxWorkers=2`
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `git add .superpowers/`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `studio/answers/spec.ts` | create (port) | `AnswerBlock` union (no explore/sandbox) |
| `studio/answers/fd.ts` | create (port) | `FD`, `Relation`, `fdText`, `violations`, `closureSteps`, `bcnfSteps` |
| `studio/answers/Blocks.tsx` | create (port) | One renderer per block; `AnswerBlockView` |
| `studio/types.ts` | modify | `GeneratedBlock.blocks?`, `format?` |
| `mocks/studio-answers.ts` | modify | Shapes for existing answers; 3 new answers; `blocks`/`format` |
| `studio/components/WovenAnswer.tsx` | modify | Block-by-block settle |
| `screens/StudioCanvasScreen.tsx` | modify | Copy `blocks`/`format` into the woven block; rotate suggestions; Recall + Depth wiring |
| `studio/recall.ts` | create | Pure recall state |
| `studio/components/RecallTerm.tsx` | create | Blank → reveal → Knew it / Not yet |
| `studio/components/Markdown.tsx` | modify | Optional `recall` render prop via the `strong` override |
| `studio/components/ProgressRing.tsx` | create | Small knew/total ring |
| `studio/useRecall.ts` | create | Recall state hook with persistence and the `R` key |
| `studio/depth.ts` | create | `Depth`, `blocksAtDepth` |
| `studio/components/DepthDial.tsx` | create | Four-stop radiogroup |
| `studio/components/CanvasPage.tsx`, `PageDivider.tsx`, `PageRail.tsx`, `CleanBlock.tsx` | modify | Depth rendering, rings, recall props |

---

## Part 1 — Answers you can play with

### Task 1: Port the catalogue

**Files:**
- Create: `src/features/spaces/studio/answers/spec.ts`, `src/features/spaces/studio/answers/fd.ts`, `src/features/spaces/studio/answers/Blocks.tsx`
- Test: `src/features/spaces/studio/__tests__/answers-fd.test.ts`, `src/features/spaces/studio/__tests__/answers-blocks.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // spec.ts
  export type AnswerBlock =
    | { type: 'text'; md: string }
    | { type: 'key'; md: string }
    | { type: 'compare'; columns: { title: string; tone?: 'a' | 'b'; points: string[] }[]; note?: string }
    | { type: 'fdTable'; title: string; columns: string[]; rows: string[][]; fd: FD; prompt: string }
    | { type: 'closure'; title: string; attrs: string[]; fds: FD[]; start: string[] }
    | { type: 'bcnf'; title: string; relation: Relation; fds: FD[] }
    | { type: 'check'; question: string; options: { text: string; correct?: boolean; why: string }[] }
    | { type: 'steps'; title: string; steps: { label: string; body: string }[] };
  // fd.ts — exactly the reader branch's exports (FD, Relation, fdText, violations, closureSteps, bcnfSteps, and any helper they use)
  // Blocks.tsx
  export function AnswerBlockView(props: { block: AnswerBlock }): JSX.Element;
  ```

- [ ] **Step 1: Read the source.**
  ```bash
  B=claude/two-faces-lesson-styling-1da325; P=src/features/spaces/components/reader/iui
  git show "${B}:${P}/spec.ts"; git show "${B}:${P}/fd.ts"; git show "${B}:${P}/Blocks.tsx"
  git show "${B}:src/features/spaces/components/__tests__/explain.test.ts"
  ```
  Use the quoting exactly as above: in zsh, `$B:src` is parsed as a history modifier.

- [ ] **Step 2: Port `fd.ts` verbatim, plus its tests.** Then write `answers-fd.test.ts`, porting every `violations` / `closureSteps` / `bcnfSteps` case from `explain.test.ts` and adding these:

```ts
import { describe, expect, it } from 'vitest';
import { closureSteps, fdText, violations } from '../answers/fd';

const fd = (l: string, r: string) => ({ lhs: l.split(' '), rhs: r.split(' ') });

describe('fd engine on Normalization.pdf examples', () => {
  it('Name → Weight holds on the creature table until a weight changes (page 7)', () => {
    const cols = ['Name', 'Weight'];
    const rows = [['Nidoran', '7.0'], ['Nidoran', '7.0'], ['Pikachu', '6.0']];
    expect(violations(cols, rows, fd('Name', 'Weight'))).toEqual([]);
    rows[1][1] = '9.0';
    expect(violations(cols, rows, fd('Name', 'Weight'))).toEqual([[0, 1]]);
  });
  it('Y → X fails on the page-10 counterexample', () => {
    const cols = ['X', 'Y', 'Z'];
    const rows = [['a1', 'b1', 'c1'], ['a2', 'b1', 'c1'], ['a3', 'b2', 'c1'], ['a4', 'b1', 'c1']];
    expect(violations(cols, rows, fd('X', 'Y'))).toEqual([]);
    expect(violations(cols, rows, fd('Y', 'X')).length).toBe(3);
  });
  it('the closure of {title, year} reaches every attribute', () => {
    const fds = [fd('title year', 'length type studioName'), fd('studioName', 'president'), fd('president', 'presAddr')];
    const steps = closureSteps(['title', 'year'], fds);
    expect(steps[steps.length - 1].after.sort()).toEqual(['length', 'presAddr', 'president', 'studioName', 'title', 'type', 'year'].sort());
    expect(fdText(fds[1])).toBe('studioName → president');
  });
});
```

- [ ] **Step 3: Port `spec.ts`.**
  - Drop the `explore` and `sandbox` members.
  - Drop `ExplainAnswer`; Task 2 puts `blocks` and `format` on the answer types instead.
  - Rename the union to `AnswerBlock`.
  - Keep the doc comment, rewritten without banned words.

- [ ] **Step 4: Port `Blocks.tsx`, with these changes only:**
  - Remove `Explore`, `SandboxBlock` and their cases.
  - `Prose` → Studio's `Markdown` (`../components/Markdown`). `Inline` may keep its own tiny renderer if it renders inline code/arrows; otherwise use `Markdown`.
  - `timing` from `../Planes` → constants in `studio/motion.ts`. Add any missing constant there with a comment, e.g. `CARD_SETTLE_S = 0.3`.
  - Restyle with Studio tokens:
    - card ground `bg-[rgb(var(--studio-chip))]`
    - hairline `border-[rgb(var(--studio-hairline))]`
    - accents: the warm term colour `rgb(var(--studio-term))` for "new/added", the amber `hsl(var(--studio-mark))` for "breaks/violation", the teal `rgb(var(--studio-woven))` for "holds/ok"
    - text `text-foreground` / `text-quiet` / `text-faint`
    - `rounded-2xl`
  - Accessibility:
    - each card root gets `role="group"` and `aria-label` = its title (or the question for `check`)
    - live verdicts (fdTable holds/breaks, closure result, bcnf done) sit in an element with `aria-live="polite"`
    - `check` options are radio inputs inside a `fieldset` with a `legend` = the question, and each reason is shown only after a choice
  - Export `AnswerBlockView({ block })` (renamed from `BlockView`).
  - Rewrite every comment and string containing a banned word.

- [ ] **Step 5: Component tests.** Create `answers-blocks.test.tsx` to cover:
  - `text`/`key` render their markdown.
  - `compare` renders every column title.
  - `fdTable`: the verdict says the FD holds; editing a cell (`fireEvent.change` on the cell input) to break it flips the live verdict and marks the two rows (`data-violates="true"` on their `<tr>`, which you add).
  - `closure`: stepping forward adds attributes until the final set is shown; there is a back step.
  - `bcnf`: stepping through reaches a "done" state listing the decomposed relations.
  - `check`: nothing's reason shows before a choice; choosing the correct option shows its `why` and marks it correct; choosing a wrong one shows that option's `why`.
  - `steps`: next/previous move through labels.
  - Each card has `role="group"` with its title as the name.

- [ ] **Step 6: Gates and commit.** `reachable.test.tsx` may now be red for `AnswerBlockView` until Task 2 mounts it. That is allowed inside Part 1; report it.

```bash
git add src/features/spaces/studio/answers src/features/spaces/studio/motion.ts src/features/spaces/studio/__tests__/answers-fd.test.ts src/features/spaces/studio/__tests__/answers-blocks.test.tsx
git commit -m "feat(studio): port the interactive answer catalogue — fd table, closure, BCNF, check, steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Answers grow as playable shapes

**Files:**
- Modify: `src/features/spaces/studio/types.ts`, `src/features/spaces/mocks/studio-answers.ts`, `src/features/spaces/studio/components/WovenAnswer.tsx`, `src/features/spaces/screens/StudioCanvasScreen.tsx`, `src/features/spaces/studio/components/Composer.tsx` (only if needed for rotating suggestions)
- Test: `src/features/spaces/mocks/__tests__/studio-answers.test.ts`, `src/features/spaces/studio/__tests__/WovenAnswer.test.tsx`, `src/features/spaces/studio/__tests__/ask.test.tsx`

**Interfaces:**
- Consumes: `AnswerBlock`, `AnswerBlockView`, `FD` (Task 1).
- Produces:
  - `GeneratedBlock.blocks?: AnswerBlock[]` and `GeneratedBlock.format?: string`, with the same two fields on `ScriptedAnswer`.
  - Exported `nextSuggestions(asked: string[], n = 3): string[]` in `mocks/studio-answers.ts`: the first `n` questions not yet asked, in catalogue order.

- [ ] **Step 1: Types.** Add both optional fields to `GeneratedBlock` (`types.ts`) and `ScriptedAnswer`, with doc comments: `markdown` stays the plain-text version used for screen readers and Morph.

- [ ] **Step 2: Scripted shapes.** In `mocks/studio-answers.ts`:
  - Keep every existing field. Each answer's `markdown` becomes the plain-text summary of its blocks.
  - Two existing answers get shapes:
    - **'What is a functional dependency?'**: `format: 'A table to try'`.
      - `blocks`: `{type:'text', md: <the current markdown>}`, then:
        ```ts
        { type: 'fdTable', title: 'Does Name → Weight hold?', columns: ['Name','Weight','Type'], rows: [['Pikachu','6.0','electric'],['Nidoran','7.0','poison'],['Nidoran','7.0','poison'],['Vulpix','9.9','fire'],['Abra','19.5','psychic']], fd: {lhs:['Name'], rhs:['Weight']}, prompt: 'Change one Nidoran’s weight and watch the dependency break.' }
        ```
      - The rows are real values from page 7.
    - **'Why doesn’t commutativity hold?'**: `format: 'See it fail'`.
      - `blocks`: `{type:'text', md: <current>}`, then:
        ```ts
        { type: 'fdTable', title: 'X → Y holds — does Y → X?', columns: ['X','Y','Z'], rows: [['a₁','b₁','c₁'],['a₂','b₁','c₁'],['a₃','b₂','c₁'],['a₄','b₁','c₁']], fd: {lhs:['Y'], rhs:['X']}, prompt: 'Rows that share a Y value but differ in X are the counterexample.' }
        ```
      - The table is page 10's.
  - Three new answers are appended, in this order. Each needs `match`, `citations` (real block ids, covered by a sourced block, checked by the existing fixture test) and a plain-text `markdown`.
    1. **'What is the closure of {Title, Year}?'**
       - `match: /closure/i`, `anchorId: 's-p8-2'`, `format: 'Step through it'`.
       - Blocks:
         - `{type:'key', md: 'X⁺ is everything X determines — keep firing dependencies whose left side you already have.'}`
         - `{type:'closure', title: 'Compute {Title, Year}⁺', attrs: ['Title','Year','Length','Type','StudioName','President','PresAddr'], fds: [{lhs:['Title','Year'], rhs:['Length','Type','StudioName']}, {lhs:['StudioName'], rhs:['President']}, {lhs:['President'], rhs:['PresAddr']}], start: ['Title','Year']}`
       - Citations: `p8-b14` and `p9-b9`.
    2. **'Split this relation into BCNF'**
       - `match: /bcnf|boyce/i`, `anchorId: 's-p3-1'`, `format: 'Decompose it'`.
       - Blocks: a `text` block explaining that a relation is in BCNF when every dependency's left side is a key, then a `bcnf` block with `relation: { name: 'Studios', attrs: ['Title','Year','StudioName','President','PresAddr'] }` (adapt to the ported `Relation` shape) and `fds: [{lhs:['Title','Year'], rhs:['StudioName']}, {lhs:['StudioName'], rhs:['President']}, {lhs:['President'], rhs:['PresAddr']}]`.
       - Citation: `p5-b11`.
    3. **'Quiz me on Armstrong’s axioms'**
       - `match: /quiz|armstrong|axiom/i`, `anchorId: 's-p9-2'`, `format: 'Try first'`.
       - Blocks:
         - a `check` block: `question: 'You know X → Y and Y → Z. Which rule gives you X → Z?'`, options **Reflexivity** (why: "That only gives X → Y when Y ⊆ X."), **Augmentation** (why: "That adds the same attributes to both sides; it never chains two dependencies."), **Transitivity** (correct; why: "X → Y and Y → Z give X → Z.").
         - a `steps` block, `title: 'Why transitivity holds (page 11)'`, with 3 steps taken from summary paragraphs s-p11-1 and s-p11-2.
       - Citations: `p9-b8` and `p11-b20`.
  - Add `nextSuggestions`.
  - Fixture tests:
    - every `blocks` entry has a known `type`;
    - each `fdTable`'s rows have `columns.length` cells and its `fd` attributes are in `columns`;
    - each `closure`'s `start` and fds use only `attrs`;
    - `nextSuggestions([])` gives the first three questions and `nextSuggestions(firstThree)` gives the next ones;
    - every new `match` matches its own question and no earlier answer's regex steals it (each question resolves to itself via `findAnswer`).

- [ ] **Step 3: WovenAnswer shapes.** When `block.blocks` is present, render, in order:
  - The tag row: "From your question" plus, if `format` exists, a quiet "· {format}".
  - The question.
  - Each block through `AnswerBlockView`, in a `motion.div` with `initial={{opacity:0, y:6, filter:'blur(4px)'}}` and `animate={{opacity:1, y:0, filter:'blur(0px)'}}`. The delay is `GROW_S*0.2 + i*BLOCK_STAGGER_S`, with `BLOCK_STAGGER_S = 0.28` added to `motion.ts`, and the duration is `0.4`. This animates only when `fresh` and motion is not reduced.
  - The first `text` block keeps the existing word settle when fresh.
  - The settle timer covers the last block's delay plus its duration.
  - The `sr-only` full text stays `block.markdown`.
  - Without `blocks`, behaviour is unchanged.
  - Tests:
    - a shaped answer renders its cards (`role="group"` names) and its format label;
    - the blocks carry increasing animation delays when fresh;
    - none when not fresh;
    - `onSettled` fires after the computed total.

- [ ] **Step 4: Screen.**
  - In `onAsk`, copy `blocks` and `format` from the scripted answer into the `GeneratedBlock`.
  - Track the questions asked so far (state). Pass `nextSuggestions(asked)` to the Composer instead of the static `suggestions`, and keep showing suggestions after the first question. The Composer's `showSuggestions` becomes: no answer in flight and the input empty. Change the Composer only if needed; the "unknown" notice still shows chips.
  - Update `ask.test.tsx`:
    - asking "What is a functional dependency?" weaves an answer that contains `role="group"` named "Does Name → Weight hold?";
    - breaking a cell in it flips the verdict;
    - the suggestions after asking the first suggestion include the fourth question.

- [ ] **Step 5:** Run the full suite; `reachable` must be green. Run the gates, then commit `feat(studio): answers grow as playable shapes — break a dependency, step a closure, split to BCNF`.

---

## Part 2 — Recall mode

### Task 3: Recall core: pure state, terms, rings

**Files:**
- Create: `src/features/spaces/studio/recall.ts`, `src/features/spaces/studio/components/RecallTerm.tsx`, `src/features/spaces/studio/components/ProgressRing.tsx`
- Modify: `src/features/spaces/studio/components/Markdown.tsx`
- Test: `src/features/spaces/studio/__tests__/recall.test.ts`, `src/features/spaces/studio/__tests__/RecallTerm.test.tsx`

**Interfaces:**
```ts
// recall.ts
export type TermState = 'blank' | 'seen' | 'knew' | 'notYet';
export interface RecallState { on: boolean; terms: Record<string, TermState> }
export const termKey = (blockId: string, index: number) => `${blockId}:${index}`;
export function termsIn(markdown: string): string[];               // the **term** texts, in order
export function stateOf(s: RecallState, key: string): TermState;   // default 'blank'
export function mark(s: RecallState, key: string, t: TermState): RecallState;
export function pageProgress(blocks: CanvasBlock[], s: RecallState): { knew: number; total: number }; // summary blocks only
export function tryAgain(s: RecallState): string[];                // keys marked notYet
export function retry(s: RecallState): RecallState;                 // notYet → blank
export function reset(s: RecallState): RecallState;                 // all terms cleared, on unchanged
// RecallTerm.tsx
export function RecallTerm(p: { text: string; state: TermState; page: number; onReveal(): void; onMark(t: 'knew' | 'notYet'): void }): JSX.Element;
// ProgressRing.tsx
export function ProgressRing(p: { knew: number; total: number; size?: number; label: string }): JSX.Element;
// Markdown.tsx — new optional prop
recall?: { blockId: string; page: number; get(key: string): TermState; onReveal(key: string): void; onMark(key: string, t: 'knew' | 'notYet'): void };
```

- [ ] **Step 1: Write `recall.test.ts` first.** Cover:
  - `termsIn('A **b** and **c d**.')` → `['b','c d']`; no terms → `[]`.
  - `mark` and `stateOf` round-trip; unknown key → `'blank'`.
  - `pageProgress` counts only `summary` blocks' terms (written, extracted and generated blocks are ignored): total = number of terms, knew = keys marked `knew`.
  - `tryAgain` lists `notYet` keys; `retry` turns them back to `blank` and leaves `knew` alone; `reset` empties `terms`.
  - Run it and watch it fail.

- [ ] **Step 2: Implement `recall.ts`.** `termsIn` uses `/\*\*(.+?)\*\*/g` and returns the captured groups.

- [ ] **Step 3: `RecallTerm`.**
  - **Blank:** a `<button type="button">` labelled `Reveal term, page {page}`, styled as a rounded pill (`rounded-md bg-[rgb(var(--studio-term)/0.14)]`). The text is rendered `text-transparent select-none`, so its width is the term's width and nothing reflows.
  - **Reveal:** Enter, Space or a click calls `onReveal`. The term then renders in the warm term colour, animating `filter: blur(6px) → blur(0)` and `opacity 0.4 → 1` over 350 ms (none with reduced motion).
  - **After reveal:** for 4 s it shows a tiny inline pair, **Knew it** and **Not yet**, as small buttons (≥24 px hit area via a `::before` pad) that call `onMark`. When they are ignored the state stays `seen`.
  - **Marked states:** `knew` shows the term with a faint teal underline; `notYet` with a faint amber underline.
  - **Tests:** blank hides the text from view (`text-transparent`) but keeps its width; clicking reveals and shows both mark buttons; the marks call `onMark`; after 4 s with fake timers the pair disappears; reduced motion means no blur style.

- [ ] **Step 4: Markdown `recall` prop.**
  - When `recall` is set, pass Streamdown a `components` override for `strong`. Keep a per-render counter (`let i = 0` captured in a `useMemo` keyed on the markdown, reset each render) so the n-th strong renders `<RecallTerm text={children text} state={recall.get(termKey(blockId, n))} … />`.
  - Without `recall`, output is unchanged. The existing Markdown tests must stay green.
  - Add a test: a block with two terms renders two `Reveal term` buttons whose keys are `id:0` and `id:1` (assert through `onReveal` calls).
  - Check what Streamdown passes to `strong`. If it already maps to `span[data-streamdown=strong]`, override the key it actually uses (`strong`) and verify in the test.

- [ ] **Step 5: `ProgressRing`.**
  - An SVG ring with a teal stroke dash for `knew/total` and a hairline track. It has `role="img"` and `aria-label={label}`, e.g. "Recall, page 6: 3 of 5 known".
  - When `knew === total > 0` it renders `data-complete="true"` and plays one soft scale pulse (Motion, once, keyed on completion; none with reduced motion).
  - `total === 0` renders nothing.
  - Test the label and the complete flag.

- [ ] **Step 6:** Run the gates. `reachable` may be red until Task 4. Commit `feat(studio): recall core — terms you reveal, knew/not-yet, progress rings`.

### Task 4: Recall mode on the canvas

**Files:**
- Create: `src/features/spaces/studio/useRecall.ts`
- Modify: `StudioCanvasScreen.tsx`, `CanvasPage.tsx`, `CleanBlock.tsx`, `PageDivider.tsx`, `PageRail.tsx`
- Test: `src/features/spaces/studio/__tests__/recallMode.test.tsx`

**Interfaces:**
```ts
export function useRecall(canvasId: string, enabled: boolean): {
  state: RecallState; toggle(): void; reveal(key: string): void; markTerm(key: string, t: 'knew' | 'notYet'): void;
  retry(): void; reset(): void;
};
```

- [ ] **Step 1: Write `recallMode.test.tsx` first.** Use the screen-mount pattern from `ask.test.tsx`. Cover:
  - A **Recall** toggle button (`aria-pressed`) appears in the header and `R` toggles it. In Recall, `s-p6-1`'s "functional dependency" term is a `Reveal term, page 6` button. Outside Recall there are no such buttons.
  - Revealing then **Knew it** updates page 6's ring label to "Recall, page 6: 1 of N known".
  - **Not yet** puts the term in the end-of-canvas line "1 term to try again" (plural "terms"). **Try again** re-blanks it and focuses it.
  - Notes (`w-1`) and answers never get blanks.
  - Recall is disabled while Source is shown (toggle `disabled`, `R` ignored).
  - The state persists per canvas in `localStorage` key `studio:recall:<canvasId>`. Reloading (remount) restores `on` and the marks. A throwing `localStorage` still works.
  - `R` is ignored while typing in the composer.
  - Run it and watch it fail.

- [ ] **Step 2: Implement `useRecall`.** Use the pure functions from Task 3. Load and save `localStorage` in try/catch. Add a window `keydown` listener for `R`/`r` with `keys.ts` guards, no modifiers and no repeat, only when `enabled`. Hold the callbacks in refs.

- [ ] **Step 3: Wire it in.**
  - **Screen:**
    - The Recall toggle sits left of the theme button: a quiet pill with the label "Recall" and `aria-pressed`, disabled in Source.
    - Pass `recall` down to `CanvasPage`, which passes it to `CleanBlock`, which passes it to `Markdown`, only for `summary` blocks.
    - When Recall is on and summary terms exist, render the end-of-canvas "N terms to try again" line plus a **Try again** button (after the last page, in the column).
    - Add a "Start over" control next to it, visible whenever any term is marked.
  - **`PageDivider`:** accepts an optional `ring` node, rendered at its right end. `CanvasPage` computes `pageProgress(group.blocks, state)` per page and passes `<ProgressRing …>` while Recall is on.
  - **`PageRail`:** shows a tiny ring per entry while Recall is on. Pass progress per page from the screen.
  - The hint line adds "· R to recall" only while the hint shows.

- [ ] **Step 4:** Run the full suite; `reachable` must be green. Run the gates, then commit `feat(studio): Recall mode — key terms become blanks you reveal, with rings and try-again`.

---

## Part 3 — Depth dial

### Task 5: `blocksAtDepth`

**Files:**
- Create: `src/features/spaces/studio/depth.ts`
- Test: `src/features/spaces/studio/__tests__/depth.test.ts`

**Interfaces:**
```ts
export type Depth = 'gist' | 'summary' | 'full' | 'page';
export const DEPTHS: Depth[] = ['gist', 'summary', 'full', 'page'];
/** What Learn renders for one page group at a depth. 'page' returns [] — the caller shows OriginalPage. */
export function blocksAtDepth(group: PageGroup, depth: Depth, pages: SourcePage[]): CanvasBlock[];
/** Depths this page offers: no 'full' without block geometry or text blocks; no 'page' without a page image. */
export function depthsFor(group: PageGroup, pages: SourcePage[]): Depth[];
```

- [ ] **Step 1: Write `depth.test.ts`** with a hand-built page group:
  - **The fixture group:** summary `s1` (gist, covers b1 b2), note `w1`, summary `s2` (covers b3), answer `a1` (anchor `s2`), and handwriting extracted `h1` (covers hw). Its source page has text blocks b1, b2, b3, b4 (b4 uncovered, a running footer) and the figure f1.
  - `summary` returns the group unchanged.
  - `gist` returns `[s1, w1, a1, h1]`: only gist summaries, and every non-summary block stays in its original order.
  - `full` returns extracted blocks for b1, b2 in place of s1, then `w1`, then extracted b3 in place of s2, then `a1` (anchored to s2, so it comes after the last block s2 covers), then `h1`.
    - Uncovered text blocks (b4) are **not** added; Full shows what your summary covers.
    - Generated extracted blocks have ids `full-<sourceId>`, `origin: 'extracted'`, `markdown: markdownFor(source)`, `source: { materialId, page, blockIds: [sourceId] }` and `edited: false`.
    - Figures are skipped.
  - `page` returns `[]`.
  - `depthsFor`:
    - a page-geometry page (no blocks) → `['gist','summary','page']`;
    - a normal page → all four;
    - a group with no source page (notes above page 1) → `['summary']`.
  - Run it and watch it fail.

- [ ] **Step 2: Implement it** with `markdownFor` from `edit.ts` and `hasSource`. Sort Full's extracted blocks by `readingOrder` within each covering summary. Then run the tests, run the gates, and commit `feat(studio): blocksAtDepth — gist, summary, full text, page`.

### Task 6: The dial on the canvas

**Files:**
- Create: `src/features/spaces/studio/components/DepthDial.tsx`
- Modify: `CanvasPage.tsx`, `PageDivider.tsx`, `StudioCanvasScreen.tsx`
- Test: `src/features/spaces/studio/__tests__/DepthDial.test.tsx`, `src/features/spaces/studio/__tests__/depthCanvas.test.tsx`

**Interfaces:**
```ts
export function DepthDial(p: { page: number; value: Depth; options: Depth[]; onChange(d: Depth, all: boolean): void }): JSX.Element;
// CanvasPage new props: depth: Record<number, Depth>; onDepth(page: number, d: Depth, all: boolean): void
```

- [ ] **Step 1: Write the tests first.**
  - **`DepthDial`:**
    - A `role="radiogroup"` named `Depth for page N` holding four radios labelled Gist, Summary, Full and Page. Options not offered are disabled.
    - Arrow keys move the choice and call `onChange(d, false)`.
    - A click with Shift calls `onChange(d, true)`.
    - Each dot hit area is at least 24 px.
  - **`depthCanvas`** (screen mount):
    - Choosing Gist on page 2 leaves only `s-p2-1`, plus `w-1` and `c-p2-hw`, in page 2's section, and other pages are unchanged.
    - Full on page 6 renders `full-p6-b6` etc. in place of `s-p6-1`.
    - Page on page 5 renders an `OriginalPage` (`[data-view="original"][data-page-anchor="5"]` inside the Learn column) while page 4 stays summary.
    - Shift+Gist sets every page.
    - `]` on the current page deepens it and `[` makes it shallower, ignored while typing.
    - Switching to Source and back keeps each page's depth.
    - Asking a question while page 6 is at Gist still shows the answer, after the gist.
  - Run them and watch them fail.

- [ ] **Step 2: Implement `DepthDial`.**
  - Four 6 px dots on a hairline, the current one filled with `foreground` and the others `text-faint`.
  - Labels are visually hidden, except a quiet text label of the current depth that fades in on hover/focus.
  - Use real `input type="radio"` elements, or `role="radio"` buttons with roving tabindex.

- [ ] **Step 3: Implement the canvas.**
  - **`PageDivider`** gets an optional `dial` node (next to the optional recall `ring`).
  - **`CanvasPage`:**
    - For each clean group, compute `blocksAtDepth(g, depth[g.page] ?? 'summary', pages)`.
    - For depth `'page'`, render `OriginalPage` for that page inside the clean section, with `morph={false}` and the same handlers. It stays in Learn, and its `data-view` stays `"original"` so regions still work.
    - Wrap the block list in a `motion.div layout` with a 0.45 s Studio ease.
    - Key each block by id. Entering blocks: `initial={{opacity:0, y:4, filter:'blur(3px)'}}`, 0.3 s, stagger 0.03. Leaving blocks go in `AnimatePresence` with `exit={{opacity:0}}` over 0.15 s (use `mode="popLayout"`).
    - No motion when reduced.
  - **Screen:**
    - `depth` state, plus `onDepth`; with `all`, set every page offered that depth.
    - `[`/`]` keys on `nav.current`.
    - Keep your place: when a depth changes on a page whose section top is above the viewport, compensate with `useKeepPlace` on the section, or by measuring before and after in a layout effect.
  - **Recall interplay:** the rings count only what is rendered; at Full or Page the page shows no ring.

- [ ] **Step 4: Deferred.** The per-page Morph flight for Full → Page is deferred to a follow-up. v1 uses the crossfade and layout animation described here. Note it in the report; do not build it.

- [ ] **Step 5:** Run the full suite; `reachable` must be green. Run the gates, then commit `feat(studio): Depth dial — Gist, Summary, Full, Page on every page`.

---

## Verification after each Part (controller, in the browser)

Use the `dev-studio` preview on :5221 at `/v4/library/studio/c/c-norm`. Keep the pane **visible** (open it with `preview_start`), and scroll with real wheel input.

- **Part 1:** ask "What is a functional dependency?" → the table grows in → change a Nidoran weight → amber rows plus a "breaks" verdict. Ask "What is the closure of {Title, Year}?" → step it.
- **Part 2:** press R → the blanks appear → reveal, then Knew it / Not yet → the ring fills → Try again works.
- **Part 3:** dial page 2 to Gist, page 6 to Full, page 5 to Page, then Shift+Summary resets all.
