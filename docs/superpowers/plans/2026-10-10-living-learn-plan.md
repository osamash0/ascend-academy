# Living Learn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Learn view becomes a calm summary of the Material by default, and answers to your questions grow into the page under the paragraph they are about.

**Architecture:**
- A new canvas block origin, `summary`, carries a `SourceRef` exactly like `extracted`. Every Peek/Morph rule switches from "origin is extracted" to "has a source" (`hasSource`), so summaries open Peek and fly home with no new geometry code.
- Answers are `generated` blocks with an `anchorId`, inserted after their anchor by a pure edit function.
- A new `WovenAnswer` component runs the growing choreography.
- A `Composer` at the bottom holds the ask box and the pager.
- Answers come from a deterministic mock behind a `useAsk` seam.

**Tech Stack:** React 18, TypeScript, Tailwind 3.4, Motion 13 (`motion/react`), Streamdown 2.7.0 (via `studio/components/Markdown.tsx`), Vitest + happy-dom + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-10-living-learn-design.md` (extends `docs/superpowers/specs/2026-10-10-studio-canvas-design.md`).

## Global Constraints

- All code lives under `src/features/spaces/` (mock-only v4). No new dependencies. Imports outside the namespace must pass `src/features/spaces/__tests__/boundary.test.ts`.
- UI copy must pass `node scripts/check-vocabulary.mjs`. Banned words, singular and plural, case-insensitive: professor, student, teacher, instructor, course, classroom, module, folder, lecture, lms, slide, deck, document.
- Motion owns animation: use `motion/react`, never CSS keyframes. Every `AnimatePresence` child needs an `exit` (`components/__tests__/motion.test.tsx`).
- Decorative icons get `aria-hidden`. Interactive targets are at least 24×24 px.
- Internal identifiers stay as they are: the view values `'clean'` / `'original'`, `data-view`, `data-extracted`, `data-block-id`, `data-page-anchor`, `CanvasView`. The UI says **Learn** / **Source**.
- Window-level keys use the guards in `studio/keys.ts` (`isTyping`, `inDialog`) and ignore modifier keys and `e.repeat`.
- Reduced motion (`useReducedMotion()`): one 150 ms fade instead of any choreography.
- Gates, run from the worktree root:
  - `npx tsc -p tsconfig.app.json --noEmit` (never `tsconfig.json`)
  - `npx eslint <changed files>`
  - `node scripts/check-vocabulary.mjs`
  - `npx vitest run src/features/spaces --maxWorkers=2`
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/features/spaces/studio/types.ts` | modify | `SummaryBlock`, `GeneratedBlock.anchorId`, `SourcedBlock` |
| `src/features/spaces/studio/edit.ts` | modify | `hasSource`, `insertAnswer`, `removeBlock`, `restoreBlock`, `placeAfterCovering`, `resolveAnchor` |
| `src/features/spaces/studio/geometry.ts` | modify | use `hasSource` |
| `src/features/spaces/studio/components/CanvasPage.tsx` | modify | use `hasSource`; render `WovenAnswer` for generated blocks; pass glow/fresh |
| `src/features/spaces/studio/components/OriginalPage.tsx` | modify | morph overlays for every sourced block |
| `src/features/spaces/studio/components/CleanBlock.tsx` | modify | sourced = extracted or summary; gist styling; glow |
| `src/features/spaces/studio/studio-surface.css` | modify | `--studio-term`, `--studio-woven` tokens; warm `strong` |
| `src/features/spaces/mocks/studio-summary.ts` | create | authored summary for pages 1–12 |
| `src/features/spaces/mocks/studio-canvas.ts` | modify | default canvas = summary + handwriting + note |
| `src/features/spaces/mocks/studio-answers.ts` | create | scripted answers |
| `src/features/spaces/data/useAsk.ts` | create | the ask seam |
| `src/features/spaces/studio/components/WovenAnswer.tsx` | create | growing choreography, Remove |
| `src/features/spaces/studio/useKeepPlace.ts` | create | scroll compensation while an answer grows above you |
| `src/features/spaces/studio/components/Composer.tsx` | create | ask pill, suggestions, notices, pager slot, `/` key |
| `src/features/spaces/studio/components/PagerPill.tsx` | modify | `embedded` variant for inside the composer |
| `src/features/spaces/screens/StudioCanvasScreen.tsx` | modify | wires ask → insert → grow, Remove/Undo, Added below, hint |

---

### Task 1: The `summary` origin and the pure edits

**Files:**
- Modify: `src/features/spaces/studio/types.ts`
- Modify: `src/features/spaces/studio/edit.ts`
- Modify: `src/features/spaces/studio/geometry.ts` (lines 36, 59, 86)
- Modify: `src/features/spaces/studio/components/CanvasPage.tsx:48`
- Modify: `src/features/spaces/studio/components/OriginalPage.tsx:46`
- Modify: `src/features/spaces/studio/components/CleanBlock.tsx:47`
- Modify: `src/features/spaces/screens/StudioCanvasScreen.tsx:151`
- Test: `src/features/spaces/studio/__tests__/edit.test.ts`, `src/features/spaces/studio/__tests__/geometry.test.ts`

**Interfaces:**
- Produces (types.ts):
  ```ts
  export interface SummaryBlock { id: string; origin: 'summary'; markdown: string; source: SourceRef; gist: boolean; edited: boolean }
  export interface GeneratedBlock { id: string; origin: 'generated'; markdown: string; citations: Citation[]; askedAs: string; anchorId: string }
  export type CanvasBlock = ExtractedBlock | SummaryBlock | WrittenBlock | GeneratedBlock;
  export type SourcedBlock = ExtractedBlock | SummaryBlock;
  ```
- Produces (edit.ts):
  ```ts
  export function hasSource(b: CanvasBlock): b is SourcedBlock;
  export function insertAnswer(doc: CanvasDoc, answer: GeneratedBlock): CanvasDoc;
  export interface Removed { block: CanvasBlock; index: number }
  export function removeBlock(doc: CanvasDoc, id: string): { doc: CanvasDoc; removed: Removed | null };
  export function restoreBlock(doc: CanvasDoc, removed: Removed): CanvasDoc;
  export function placeAfterCovering(blocks: CanvasBlock[], block: CanvasBlock, followsSourceId: string): CanvasBlock[];
  export function resolveAnchor(blocks: CanvasBlock[], hints: { selection?: string | null; cited?: string | null; readingLine?: string | null }): string | null;
  ```

- [ ] **Step 1: Write the failing tests.** Append to `src/features/spaces/studio/__tests__/edit.test.ts`. Keep the existing imports and add the new names to the `../edit` import.

```ts
import {
  hasSource, insertAnswer, placeAfterCovering, removeBlock, resolveAnchor, restoreBlock,
} from '../edit';
import type { CanvasBlock, CanvasDoc, GeneratedBlock } from '../types';

const ref = (page: number, blockIds: string[]) => ({ materialId: 'm', page, blockIds });
const summary = (id: string, page: number, ids: string[]): CanvasBlock =>
  ({ id, origin: 'summary', markdown: id, source: ref(page, ids), gist: false, edited: false });
const note = (id: string): CanvasBlock => ({ id, origin: 'written', markdown: id });
const answer = (id: string, anchorId: string): GeneratedBlock =>
  ({ id, origin: 'generated', markdown: id, citations: [], askedAs: 'q', anchorId });
const docOf = (blocks: CanvasBlock[]): CanvasDoc =>
  ({ id: 'd', materialIds: ['m'], spaceId: null, blocks, revision: 1, updatedAt: '' });
const ids = (d: CanvasDoc) => d.blocks.map((b) => b.id);

describe('hasSource', () => {
  it('is true for extracted and summary blocks only', () => {
    expect(hasSource(summary('s', 1, []))).toBe(true);
    expect(hasSource({ id: 'e', origin: 'extracted', markdown: '', source: ref(1, []), edited: false })).toBe(true);
    expect(hasSource(note('w'))).toBe(false);
    expect(hasSource(answer('a', 's'))).toBe(false);
  });
});

describe('insertAnswer', () => {
  it('goes right after its anchor and bumps the revision', () => {
    const d = insertAnswer(docOf([summary('s1', 1, []), summary('s2', 1, [])]), answer('a1', 's1'));
    expect(ids(d)).toEqual(['s1', 'a1', 's2']);
    expect(d.revision).toBe(2);
  });
  it('goes after earlier answers on the same anchor, oldest first', () => {
    let d = docOf([summary('s1', 1, []), summary('s2', 1, [])]);
    d = insertAnswer(d, answer('a1', 's1'));
    d = insertAnswer(d, answer('a2', 's1'));
    expect(ids(d)).toEqual(['s1', 'a1', 'a2', 's2']);
  });
  it('can anchor on a note you wrote', () => {
    const d = insertAnswer(docOf([summary('s1', 1, []), note('w1'), summary('s2', 1, [])]), answer('a1', 'w1'));
    expect(ids(d)).toEqual(['s1', 'w1', 'a1', 's2']);
  });
  it('appends when the anchor is gone', () => {
    const d = insertAnswer(docOf([summary('s1', 1, [])]), answer('a1', 'nope'));
    expect(ids(d)).toEqual(['s1', 'a1']);
  });
});

describe('removeBlock / restoreBlock', () => {
  it('removes and puts back in the same place', () => {
    const start = docOf([summary('s1', 1, []), answer('a1', 's1'), summary('s2', 1, [])]);
    const { doc, removed } = removeBlock(start, 'a1');
    expect(ids(doc)).toEqual(['s1', 's2']);
    expect(removed).toEqual({ block: start.blocks[1], index: 1 });
    expect(ids(restoreBlock(doc, removed!))).toEqual(['s1', 'a1', 's2']);
  });
  it('is a no-op for an unknown id', () => {
    const start = docOf([summary('s1', 1, [])]);
    const { doc, removed } = removeBlock(start, 'nope');
    expect(doc).toBe(start);
    expect(removed).toBeNull();
  });
  it('clamps the index when the page got shorter', () => {
    const { doc, removed } = removeBlock(docOf([summary('s1', 1, []), answer('a1', 's1')]), 'a1');
    expect(ids(restoreBlock({ ...doc, blocks: [] }, removed!))).toEqual(['a1']);
  });
});

describe('placeAfterCovering (spec §2.5)', () => {
  it('puts a note after the summary paragraph that covers the source block it followed', () => {
    const out = placeAfterCovering([summary('s1', 2, ['b1', 'b2']), summary('s2', 2, ['b3'])], note('w1'), 'b2');
    expect(out.map((b) => b.id)).toEqual(['s1', 'w1', 's2']);
  });
  it('appends when nothing covers it', () => {
    const out = placeAfterCovering([summary('s1', 2, ['b1'])], note('w1'), 'zz');
    expect(out.map((b) => b.id)).toEqual(['s1', 'w1']);
  });
});

describe('resolveAnchor (spec §4.2)', () => {
  const blocks = [summary('s1', 1, []), summary('s2', 1, []), note('w1')];
  it('prefers the selection, then the citation, then the reading line', () => {
    expect(resolveAnchor(blocks, { selection: 'w1', cited: 's2', readingLine: 's1' })).toBe('w1');
    expect(resolveAnchor(blocks, { cited: 's2', readingLine: 's1' })).toBe('s2');
    expect(resolveAnchor(blocks, { readingLine: 's1' })).toBe('s1');
  });
  it('skips hints that are not on the page, and never anchors on an answer', () => {
    const withAnswer = [...blocks, answer('a1', 's1')];
    expect(resolveAnchor(withAnswer, { selection: 'a1', cited: 'gone', readingLine: 's2' })).toBe('s2');
    expect(resolveAnchor(withAnswer, {})).toBeNull();
  });
});
```

Append to `src/features/spaces/studio/__tests__/geometry.test.ts`:

```ts
describe('summary blocks behave like extracted ones', () => {
  it('get a region, start a page group and count as mapped', () => {
    const page = {
      materialId: 'm', page: 4, width: 4, height: 3, imageUrl: '', geometry: 'block' as const,
      blocks: [
        { id: 'b1', page: 4, bbox: [0.1, 0.1, 0.5, 0.2] as Box, kind: 'paragraph' as const, text: 'x', readingOrder: 1 },
        { id: 'b2', page: 4, bbox: [0.1, 0.3, 0.6, 0.4] as Box, kind: 'paragraph' as const, text: 'y', readingOrder: 2 },
        { id: 'b3', page: 4, bbox: [0.1, 0.8, 0.6, 0.9] as Box, kind: 'paragraph' as const, text: 'z', readingOrder: 3 },
      ],
    };
    const s = { id: 's', origin: 'summary' as const, markdown: 'm', gist: true, edited: false,
      source: { materialId: 'm', page: 4, blockIds: ['b1', 'b2'] } };
    expect(regionForBlock([s], [page], 's')?.box).toEqual([0.1, 0.1, 0.6, 0.4]);
    expect(groupByPage([s]).map((g) => g.page)).toEqual([4]);
    expect(unmappedSourceBlocks(page, [s]).map((b) => b.id)).toEqual(['b3']);
  });
});
```

(Add `regionForBlock`, `groupByPage`, `unmappedSourceBlocks` and `type Box` to that file's imports if missing.)

- [ ] **Step 2: Run them and watch them fail.**
Run: `npx vitest run src/features/spaces/studio/__tests__/edit.test.ts src/features/spaces/studio/__tests__/geometry.test.ts`
Expected: FAIL. `hasSource` and the others are not exported, and summary blocks get no region.

- [ ] **Step 3: Types.** In `studio/types.ts`:
  - Update the header comment: "`origin` is the one field…" becomes "having a `source` is what every Peek/Morph rule keys on: `extracted` and `summary` blocks have one".
  - Add `SummaryBlock` and `SourcedBlock` after `ExtractedBlock`.
  - Add `anchorId` to `GeneratedBlock`.
  - Widen the `CanvasBlock` union.

```ts
/** A few calm sentences condensing source blocks of ONE page (Living Learn spec §2–3). */
export interface SummaryBlock {
  id: string;
  origin: 'summary';
  /** 2–4 sentences; key terms as **term**. */
  markdown: string;
  /** Every source block it condenses; [] on page-only geometry. */
  source: SourceRef;
  /** The first paragraph of its page: read slightly brighter. */
  gist: boolean;
  /** You changed the wording. */
  edited: boolean;
}

/** A block with a place on the original: Peek, page markers, Morph flight. */
export type SourcedBlock = ExtractedBlock | SummaryBlock;
```

In `GeneratedBlock`, add `/** The block it grew under (Living Learn spec §4.2). */ anchorId: string;` and change the union to `ExtractedBlock | SummaryBlock | WrittenBlock | GeneratedBlock`.

- [ ] **Step 4: Pure edits.** In `studio/edit.ts`, add the following and switch `includeSourceBlock`'s `onPage` guard to `hasSource(b) && …` (its type guard becomes `b is SourcedBlock`; `order` takes a `SourcedBlock`):

```ts
import type { CanvasBlock, CanvasDoc, ExtractedBlock, GeneratedBlock, SourceBlock, SourcePage, SourcedBlock } from './types';

/** Has a place on the original (Peek, marker, Morph): extracted and summary blocks. */
export const hasSource = (b: CanvasBlock): b is SourcedBlock => b.origin === 'extracted' || b.origin === 'summary';

const bump = (doc: CanvasDoc, blocks: CanvasBlock[]): CanvasDoc => ({ ...doc, blocks, revision: doc.revision + 1 });

/** After its anchor and after the answers already on that anchor (oldest first). Missing anchor → the end. */
export function insertAnswer(doc: CanvasDoc, answer: GeneratedBlock): CanvasDoc {
  const at = doc.blocks.findIndex((b) => b.id === answer.anchorId);
  if (at === -1) return bump(doc, [...doc.blocks, answer]);
  let end = at + 1;
  while (end < doc.blocks.length) {
    const b = doc.blocks[end];
    if (b.origin !== 'generated' || b.anchorId !== answer.anchorId) break;
    end++;
  }
  const blocks = [...doc.blocks];
  blocks.splice(end, 0, answer);
  return bump(doc, blocks);
}

export interface Removed {
  block: CanvasBlock;
  index: number;
}

export function removeBlock(doc: CanvasDoc, id: string): { doc: CanvasDoc; removed: Removed | null } {
  const index = doc.blocks.findIndex((b) => b.id === id);
  if (index === -1) return { doc, removed: null };
  return { doc: bump(doc, doc.blocks.filter((b) => b.id !== id)), removed: { block: doc.blocks[index], index } };
}

/** Undo: back where it was, or at the end if the page got shorter meanwhile. */
export function restoreBlock(doc: CanvasDoc, removed: Removed): CanvasDoc {
  if (doc.blocks.some((b) => b.id === removed.block.id)) return doc;
  const blocks = [...doc.blocks];
  blocks.splice(Math.min(removed.index, blocks.length), 0, removed.block);
  return bump(doc, blocks);
}

/** Spec §2.5: a note goes after the paragraph that now covers the source block it used to follow. */
export function placeAfterCovering(blocks: CanvasBlock[], block: CanvasBlock, followsSourceId: string): CanvasBlock[] {
  const at = blocks.findIndex((b) => hasSource(b) && b.source.blockIds.includes(followsSourceId));
  const out = [...blocks];
  out.splice(at === -1 ? out.length : at + 1, 0, block);
  return out;
}

/** Spec §4.2: selection → the answer's first citation → the reading line. Never an answer. */
export function resolveAnchor(
  blocks: CanvasBlock[],
  hints: { selection?: string | null; cited?: string | null; readingLine?: string | null },
): string | null {
  const ok = (id?: string | null) =>
    !!id && blocks.some((b) => b.id === id && b.origin !== 'generated');
  for (const id of [hints.selection, hints.cited, hints.readingLine]) if (ok(id)) return id!;
  return null;
}
```

Rewrite `includeSourceBlock` so it returns through `bump(doc, blocks)`. Its behaviour must not change: the existing `includeSourceBlock` tests stay green.

- [ ] **Step 5: Switch every `origin === 'extracted'` check to `hasSource`.**
  - `geometry.ts`, three places:
    - line 36: `return block && hasSource(block) ? regionFor(block.source, pages) : null;`
    - line 59: `if (hasSource(b) && (!current || …))`
    - line 86: `hasSource(b) && b.source.page === page.page && …`
    - Import with `import { hasSource } from './edit';` (edit.ts imports only types from geometry, so there is no cycle).
  - `CanvasPage.tsx:48`: `if (hasSource(b) && (minConfidence(b.source, p.pages) ?? 1) < 0.8)`.
  - `OriginalPage.tsx:46`: `const mapped = blocks.filter(hasSource);` and change the type import from `ExtractedBlock` to `SourcedBlock`.
  - `CleanBlock.tsx:47`: rename the local `extracted` to `sourced = hasSource(block)` and use it everywhere `extracted` was used. Keep `data-extracted={sourced ? 'true' : 'false'}`: the attribute name is a test and reading-line selector and stays. Update the doc comment: "Only a block with a source (extracted or summary) has a place on the original…".
  - `StudioCanvasScreen.tsx:151`: `pageHint.current = target && hasSource(target) ? target.source.page : null;`.
  - Run `grep -rn "origin === 'extracted'" src/features/spaces/studio src/features/spaces/screens`. Expected: only `edit.ts`'s `hasSource` and `includeSourceBlock`'s construction of a new extracted block remain.

- [ ] **Step 6: Run the tests.**
Run: `npx vitest run src/features/spaces/studio --maxWorkers=2`
Expected: PASS, everything including the new tests.

- [ ] **Step 7: Gates and commit.**

```bash
npx tsc -p tsconfig.app.json --noEmit && npx eslint src/features/spaces/studio src/features/spaces/screens/StudioCanvasScreen.tsx && node scripts/check-vocabulary.mjs
git add src/features/spaces/studio src/features/spaces/screens/StudioCanvasScreen.tsx
git commit -m "feat(studio): summary blocks have a source; answers anchor; pure edits for weaving

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The authored summary becomes the default canvas

**Files:**
- Create: `src/features/spaces/mocks/studio-summary.ts`
- Modify: `src/features/spaces/mocks/studio-canvas.ts` (`buildBlocks`, header comment)
- Test: `src/features/spaces/mocks/__tests__/studio-canvas.test.ts`

**Interfaces:**
- Consumes: `SummaryBlock`, `placeAfterCovering`, `hasSource` (Task 1).
- Produces: `STUDIO_SUMMARY: SummaryBlock[]` (ids `s-p<page>-<n>`). `STUDIO_CANVAS.blocks` = summary + `w-1` + `c-p2-hw`. Later tasks rely on the ids `s-p2-1`, `s-p5-2`, `s-p6-1`, `s-p8-2`, `s-p10-1` and `s-p12-2`.

- [ ] **Step 1: Write the failing fixture tests.** In `mocks/__tests__/studio-canvas.test.ts`:
  - Replace the `extracted` constant with `const sourced = STUDIO_CANVAS.blocks.filter(hasSource);` (import `hasSource` from `../../studio/edit`) and use `sourced` wherever `extracted` was used.
  - In the page-geometry test, the page-3 check becomes `for (const b of sourced.filter((b) => b.source.page === 3)) expect(b.source.blockIds).toEqual([]);`.
  - Replace the test "has exactly one edited block and one written block" with the tests below, and add the rest:

```ts
  it('opens on the summary: every page has one, the first is the gist', () => {
    const summaries = STUDIO_CANVAS.blocks.filter((b) => b.origin === 'summary');
    for (const p of studioPages) {
      const mine = summaries.filter((b) => b.origin === 'summary' && b.source.page === p.page);
      expect(mine.length, `page ${p.page}`).toBeGreaterThanOrEqual(1);
      expect(mine.map((b) => b.origin === 'summary' && b.gist)).toEqual(mine.map((_, i) => i === 0));
    }
    expect(STUDIO_CANVAS.blocks.filter((b) => b.origin === 'extracted').map((b) => b.id)).toEqual(['c-p2-hw']);
  });

  it('keeps every summary on one page, short, with real block ids', () => {
    for (const b of STUDIO_CANVAS.blocks) {
      if (b.origin !== 'summary') continue;
      const sentences = b.markdown.split(/(?<=[.!?])\s+/).filter(Boolean).length;
      expect(sentences, b.id).toBeLessThanOrEqual(4);
      const page = studioPages.find((p) => p.page === b.source.page)!;
      for (const id of b.source.blockIds) expect(page.blocks.some((s) => s.id === id), `${b.id} → ${id}`).toBe(true);
    }
  });

  it('has exactly one edited paragraph and one written note, placed by the §2.5 rule', () => {
    expect(STUDIO_CANVAS.blocks.filter((b) => hasSource(b) && b.edited).map((b) => b.id)).toEqual(['s-p2-2']);
    const ids = STUDIO_CANVAS.blocks.map((b) => b.id);
    expect(ids.filter((id) => id.startsWith('w-'))).toEqual(['w-1']);
    expect(ids.indexOf('w-1')).toBe(ids.indexOf('s-p2-1') + 1);
    expect(ids.indexOf('c-p2-hw')).toBe(ids.indexOf('s-p2-2') + 1);
  });
```

  The existing "has something for Morph to reveal as missing" test still applies, now through `sourced`.

- [ ] **Step 2: Run it and watch it fail.**
Run: `npx vitest run src/features/spaces/mocks/__tests__/studio-canvas.test.ts`
Expected: FAIL, because there are no summary blocks yet.

- [ ] **Step 3: Write `mocks/studio-summary.ts` exactly as below.** The text is authored and passes the vocabulary gate. Running headers and footers ("Slide N / author", "Normalization", "Database Systems") are deliberately left uncovered, so Morph shows them as "Not in your version".

```ts
import type { SummaryBlock } from '../studio/types';

/**
 * The calm summary of Normalization.pdf — Living Learn spec §2, style A.
 *
 * Authored, not generated: the real summary step arrives with the pipeline
 * spec. Every paragraph condenses source blocks of ONE page and lists all of
 * them, so Peek outlines their union and Morph flies home to it. Running
 * headers and footers are left out on purpose — Morph shows them as
 * "Not in your version", which is the truth.
 */
const s = (page: number, n: number, blockIds: string[], markdown: string, edited = false): SummaryBlock => ({
  id: `s-p${page}-${n}`,
  origin: 'summary',
  markdown,
  source: { materialId: 'm-norm', page, blockIds },
  gist: n === 1,
  edited,
});

export const STUDIO_SUMMARY: SummaryBlock[] = [
  s(1, 1, ['p1-b2'], '**Normalization**, from Database Systems by Thorsten Papenbrock.'),

  s(2, 1, ['p2-b2', 'p2-b3', 'p2-b4', 'p2-b5', 'p2-b6', 'p2-b7', 'p2-b8'],
    'Building a database follows a fixed path. It starts with **requirement analysis**, an informal description of what people need, then a **conceptual design** drawn as an **ER diagram**, and a **distribution design** that decides how data is partitioned.'),
  s(2, 2, ['p2-b9', 'p2-b10', 'p2-b11', 'p2-b12', 'p2-b13', 'p2-b14', 'p2-b15'],
    'Next come the **logical design** as relation schemas, the **data definition** in SQL DDL, and the **physical design** with parameters and indices. Implementation and maintenance close the path — in my words: this is where tables get real.',
    true),

  s(3, 1, [], 'This part has four stops: **functional dependencies**, the **closure algorithm**, **Boyce-Codd normal form**, and the **normal forms** in general.'),

  s(4, 1, ['p4-b1', 'p4-b3', 'p4-b22', 'p4-b23', 'p4-b24'],
    'So far the design runs from a **conceptual design** to a **logical design**: first by translating the ER model, then by merging relations.'),
  s(4, 2, ['p4-b28'], 'The result works, but it can still be improved — and that is where functional dependencies come in.'),

  s(5, 1, ['p5-b1', 'p5-b5', 'p5-b6', 'p5-b7'],
    'A working **logical design** can still be refined. Break down structures to make attributes explicit, and split schemas to make constraints explicit.'),
  s(5, 2, ['p5-b8', 'p5-b9', 'p5-b10', 'p5-b11', 'p5-b12', 'p5-b13', 'p5-b14'],
    'The tools are **functional** and **multivalued dependencies**. The goal is to avoid **redundancy** by splitting relation schemas, without losing meaning and without losing the way back to the original relations. Doing this systematically is **normalization**.'),

  s(6, 1, ['p6-b1', 'p6-b5', 'p6-b6'],
    'A **functional dependency** X → A says: whenever two rows agree on the attributes in X, they also agree on A.'),
  s(6, 2, ['p6-b7', 'p6-b8', 'p6-b9'],
    'Formally, X → A holds in a relation exactly when, for any two tuples, equal values on X force equal values on A.'),
  s(6, 3, ['p6-b10', 'p6-b11', 'p6-b12', 'p6-b13', 'p6-b20', 'p6-b21', 'p6-b22', 'p6-b23', 'p6-b28'],
    'Single letters like A, B, C name attributes, and X, Y, Z name sets of them. X → ABC is short for X → A, X → B and X → C. In German: *Funktionale Abhängigkeit* (FA).'),

  s(7, 1, ['p7-b1', 'p7-b3', 'p7-b4', 'p7-b5', 'p7-b6', 'p7-b7', 'p7-b8', 'p7-b9', 'p7-b10', 'p7-b11', 'p7-b12', 'p7-b13'],
    'A table of creatures, with name, evolution, location, weight, type and more, shows dependencies hiding in real data.'),
  s(7, 2, ['p7-b14', 'p7-b16'],
    'For instance **Name → Weight**: the same name always comes with the same weight. And **Type → Weak**: a type decides its weakness.'),

  s(8, 1, ['p8-b1', 'p8-b5', 'p8-b6', 'p8-b7', 'p8-b8', 'p8-b9'],
    'The **splitting rule** breaks A₁…Aₙ → B₁…Bₘ into one dependency per right-hand attribute. The **combining rule** puts them back together.'),
  s(8, 2, ['p8-b10', 'p8-b11', 'p8-b12', 'p8-b13', 'p8-b14', 'p8-b15', 'p8-b16', 'p8-b17', 'p8-b18'],
    'So Title, Year → Length, Type, StudioName means the same as three separate dependencies. But splitting works **only on the right-hand side**: Title, Year → Length gives neither Year → Length nor Title → Length.'),

  s(9, 1, ['p9-b10', 'p9-b17', 'p9-b21'],
    "**Armstrong's axioms** derive new dependencies from known ones. They are **sound**, never deriving a false one, and **complete**, deriving every true one."),
  s(9, 2, ['p9-b1', 'p9-b2', 'p9-b3', 'p9-b4', 'p9-b5', 'p9-b6', 'p9-b7', 'p9-b8', 'p9-b9'],
    '**Reflexivity**: if Y ⊆ X, then X → Y. **Augmentation**: X → Y gives XZ → YZ. **Transitivity**: X → Y and Y → Z give X → Z.'),

  s(10, 1, ['p10-b10', 'p10-b17'], '**Commutativity does not hold**: X → Y does not mean Y → X.'),
  s(10, 2, ['p10-b18', 'p10-b19', 'p10-b20', 'p10-b21', 'p10-b22', 'p10-b23', 'p10-b24', 'p10-b25', 'p10-b26'],
    'A small counterexample proves it. Every X value is different, so X → Y holds, yet the same Y value b₁ appears with three different X values, so Y → X fails.'),

  s(11, 1, ['p11-b10', 'p11-b17', 'p11-b18', 'p11-b19', 'p11-b20'],
    'Why **transitivity** holds: given X → Y and Y → Z, any two rows that agree on X must also agree on Z.'),
  s(11, 2, ['p11-b21', 'p11-b22', 'p11-b23'],
    'Take two such rows. X → Y makes their Y values equal, and then Y → Z makes their Z values equal.'),

  s(12, 1, ['p12-b10', 'p12-b14', 'p12-b15', 'p12-b16', 'p12-b17', 'p12-b18', 'p12-b19'],
    'More rules follow from the axioms. **Splitting**: X → YZ gives X → Y. **Combining**: X → Y and X → Z give X → YZ.'),
  s(12, 2, ['p12-b20', 'p12-b21', 'p12-b22', 'p12-b26'],
    '**Pseudotransitivity**: X → Y and WY → Z give WX → Z. Augment X → Y with W to get WX → WY, then apply transitivity.'),
];
```

- [ ] **Step 4: Rebuild the default canvas.** In `mocks/studio-canvas.ts`:
  - Update the header comment's bullet list:
    - "the default canvas is the calm summary (`studio-summary.ts`); your handwriting stays verbatim"
    - "one paragraph you reworded (s-p2-2), and one note you wrote yourself (w-1, placed after the paragraph covering the heading it used to follow)"
    - "running headers and footers are covered by no summary paragraph, so Morph has real 'Not in your version' regions"
  - Replace `buildBlocks` with the code below. Import `STUDIO_SUMMARY` from `./studio-summary` and `placeAfterCovering` from `../studio/edit`. Leave `generated.blocks` unused and remove the `ExtractedBlock` import if eslint flags it. Keep `generated` itself, because `buildPages` still uses it.

```ts
function buildBlocks(): CanvasBlock[] {
  let out: CanvasBlock[] = [...STUDIO_SUMMARY];
  // The note used to follow page 2's heading (p2-b2); §2.5 puts it after the paragraph covering that.
  out = placeAfterCovering(out, { id: 'w-1', origin: 'written', markdown: 'My note: this is the roadmap for the whole topic.' }, 'p2-b2');
  // Your handwriting is never summarised: it stays verbatim, after its page's summary.
  const lastOfPage2 = out.map((b) => b.origin === 'summary' && b.source.page === 2).lastIndexOf(true);
  out.splice(lastOfPage2 + 1, 0, {
    id: 'c-p2-hw',
    origin: 'extracted',
    markdown: 'Klausurrelevant!',
    source: { materialId: 'm-norm', page: 2, blockIds: ['p2-hw'] },
    edited: false,
  });
  return out;
}
```

- [ ] **Step 5: Run the whole Studio suite.** Other tests may assert on the old extracted text.
Run: `npx vitest run src/features/spaces --maxWorkers=2`
Expected: the fixture tests PASS.
  - If a screen test fails because it searched for old extracted wording, update only that assertion to the summary wording. Behaviour assertions (Peek opens, Morph flies, ids `c-p2-hw` and `w-1`) must not change.
  - List every assertion you changed in your report.

- [ ] **Step 6: Gates and commit.**

```bash
npx tsc -p tsconfig.app.json --noEmit && npx eslint src/features/spaces/mocks && node scripts/check-vocabulary.mjs
git add src/features/spaces/mocks src/features/spaces/studio/__tests__ src/features/spaces/components/__tests__
git commit -m "feat(studio): Learn opens on a calm summary of Normalization.pdf

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Quiet-prose styling: gist and warm terms

**Files:**
- Modify: `src/features/spaces/studio/studio-surface.css`
- Modify: `src/features/spaces/studio/components/CleanBlock.tsx`
- Test: `src/features/spaces/studio/__tests__/summaryBlock.test.tsx` (create)

**Interfaces:**
- Consumes: `SummaryBlock.gist` (Task 1).
- Produces:
  - CSS tokens `--studio-term` (RGB triplet) and `--studio-woven` (RGB triplet), defined in both theme scopes.
  - `.studio-prose strong` renders in `rgb(var(--studio-term))`, weight 500.
  - CleanBlock adds `data-gist="true"` and the class `studio-gist` on gist summaries.

- [ ] **Step 1: Write the failing test.** Create `studio/__tests__/summaryBlock.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CleanBlock } from '../components/CleanBlock';
import type { SummaryBlock } from '../types';

const block = (gist: boolean): SummaryBlock => ({
  id: 's', origin: 'summary', markdown: 'A **functional dependency** holds.', gist, edited: false,
  source: { materialId: 'm', page: 6, blockIds: ['b'] },
});
const props = {
  page: 6, index: 0, count: 1, morph: false, flying: false, lowConfidence: false, active: false, flash: false,
  markerDisabled: false, glow: false,
  onPointerEnter: vi.fn(), onPointerLeave: vi.fn(), onOpenPeek: vi.fn(), onClosePeek: vi.fn(),
};

describe('a summary paragraph', () => {
  it('has a page marker and counts as sourced', () => {
    const { container, getByRole } = render(<CleanBlock {...props} block={block(false)} />);
    expect(getByRole('button', { name: 'Show the source, page 6' })).toBeInTheDocument();
    expect(container.querySelector('[data-extracted="true"]')).not.toBeNull();
  });
  it('marks the gist and renders key terms as strong', () => {
    const { container } = render(<CleanBlock {...props} block={block(true)} />);
    expect(container.querySelector('[data-gist="true"].studio-gist')).not.toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('functional dependency');
  });
  it('does not mark a non-gist paragraph', () => {
    const { container } = render(<CleanBlock {...props} block={block(false)} />);
    expect(container.querySelector('[data-gist]')).toBeNull();
  });
});
```

(`glow` is added to CleanBlock's props in Task 7. Add it now as an optional prop `glow?: boolean` that does nothing yet, so this test compiles.)

- [ ] **Step 2: Run it and watch it fail.**
Run: `npx vitest run src/features/spaces/studio/__tests__/summaryBlock.test.tsx`
Expected: FAIL on `data-gist`.

- [ ] **Step 3: Implement.** In `CleanBlock.tsx`:
  - Compute `const gist = block.origin === 'summary' && block.gist;`.
  - On the outer `motion.div`, add `data-gist={gist ? 'true' : undefined}`, and add `gist && 'studio-gist'` to the `cn(...)` list.
  - Add the optional prop `glow?: boolean` to `Props` and destructure it (unused until Task 7). Leave the variable out of the destructure if eslint flags it, but keep it on `Props`.

In `studio-surface.css`, add to the dark scope:

```css
  /* Living Learn: warm light for key terms, teal for what your questions added. */
  --studio-term: 243 231 201;
  --studio-woven: 159 211 199;
```

and to the light scope:

```css
  --studio-term: 138 90 0;
  --studio-woven: 47 125 109;
```

and append:

```css
/* Key terms in the calm summary: warm light, not bold (Living Learn spec §2.2). */
.studio-prose strong {
  color: rgb(var(--studio-term));
  font-weight: 500;
}

/* The gist of a page reads a touch brighter and larger than the rest. */
.studio-gist .studio-prose {
  color: hsl(var(--foreground));
  font-size: 18px;
}
```

Check that `.studio-prose`'s base colour is the dimmer body colour. If its `color` is already full foreground, set the base `.studio-prose` colour to `hsl(var(--foreground) / 0.8)` so the gist stands out. Report which you found.

- [ ] **Step 4: Run the Studio tests.**
Run: `npx vitest run src/features/spaces/studio --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Gates and commit.**

```bash
npx tsc -p tsconfig.app.json --noEmit && npx eslint src/features/spaces/studio && node scripts/check-vocabulary.mjs
git add src/features/spaces/studio
git commit -m "style(studio): quiet prose — gist reads brighter, key terms in warm light

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Scripted answers and the `useAsk` seam

**Files:**
- Create: `src/features/spaces/mocks/studio-answers.ts`
- Create: `src/features/spaces/data/useAsk.ts`
- Test: `src/features/spaces/mocks/__tests__/studio-answers.test.ts`, `src/features/spaces/studio/__tests__/useAsk.test.tsx`

**Interfaces:**
- Consumes: `Citation` (types), `STUDIO_CANVAS`, `studioPages` (Task 2 ids).
- Produces:
  ```ts
  // mocks/studio-answers.ts
  export interface ScriptedAnswer { question: string; match: RegExp; anchorId: string; markdown: string; citations: Citation[] }
  export const STUDIO_ANSWERS: ScriptedAnswer[];
  export const SUGGESTED_QUESTIONS: string[];            // the first three questions
  export function findAnswer(question: string): ScriptedAnswer | null;
  export const ASK_LATENCY_MS = 600;
  // data/useAsk.ts
  export type AskResult = { kind: 'answer'; answer: ScriptedAnswer } | { kind: 'unknown' };
  export function useAsk(): { ask(question: string): Promise<AskResult>; answering: boolean; suggestions: string[] };
  ```

- [ ] **Step 1: Write the failing tests.** Create `mocks/__tests__/studio-answers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { STUDIO_ANSWERS, SUGGESTED_QUESTIONS, findAnswer } from '../studio-answers';
import { STUDIO_CANVAS, studioPages } from '../studio-canvas';

describe('scripted answers', () => {
  it('anchor on a paragraph that exists, and cite blocks that exist', () => {
    for (const a of STUDIO_ANSWERS) {
      expect(STUDIO_CANVAS.blocks.some((b) => b.id === a.anchorId), a.anchorId).toBe(true);
      expect(a.citations.length).toBeGreaterThan(0);
      for (const c of a.citations) {
        const page = studioPages.find((p) => p.page === c.page)!;
        expect(page.blocks.some((s) => s.id === c.blockId), `${a.question} → ${c.blockId}`).toBe(true);
      }
    }
  });
  it('match their own question, case-insensitively, and nothing else matches by accident', () => {
    for (const a of STUDIO_ANSWERS) {
      expect(findAnswer(a.question)).toBe(a);
      expect(findAnswer(a.question.toUpperCase())).toBe(a);
    }
    expect(findAnswer('What is the capital of France?')).toBeNull();
    expect(findAnswer('')).toBeNull();
  });
  it('suggest the first three questions', () => {
    expect(SUGGESTED_QUESTIONS).toEqual(STUDIO_ANSWERS.slice(0, 3).map((a) => a.question));
  });
});
```

Create `studio/__tests__/useAsk.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAsk } from '../../data/useAsk';
import { ASK_LATENCY_MS } from '../../mocks/studio-answers';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useAsk', () => {
  it('answers a scripted question after a real wait, one at a time', async () => {
    const { result } = renderHook(() => useAsk());
    let p!: Promise<unknown>;
    act(() => { p = result.current.ask('Why does repeated data cause problems?'); });
    expect(result.current.answering).toBe(true);
    await act(async () => { vi.advanceTimersByTime(ASK_LATENCY_MS); });
    await expect(p).resolves.toMatchObject({ kind: 'answer', answer: { anchorId: 's-p5-2' } });
    expect(result.current.answering).toBe(false);
  });
  it('says so honestly when it has no answer', async () => {
    const { result } = renderHook(() => useAsk());
    let p!: Promise<unknown>;
    act(() => { p = result.current.ask('Tell me a joke'); });
    await act(async () => { vi.advanceTimersByTime(ASK_LATENCY_MS); });
    await expect(p).resolves.toEqual({ kind: 'unknown' });
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**
Run: `npx vitest run src/features/spaces/mocks/__tests__/studio-answers.test.ts src/features/spaces/studio/__tests__/useAsk.test.tsx`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Write `mocks/studio-answers.ts`.**

```ts
import type { Citation } from '../studio/types';

/**
 * Studio's answers, canned — the same pattern as `mocks/tutor.ts`.
 *
 * Deterministic: the same question returns the same words, so tests can
 * assert them. A question none of these match gets an honest "I can only
 * answer these here" (Living Learn spec §4.7), never an invented answer.
 * Every anchor is a paragraph of the default canvas and every citation a
 * real source block — guarded in `__tests__/studio-answers.test.ts`.
 */
export interface ScriptedAnswer {
  question: string;
  match: RegExp;
  /** The paragraph it grows under (spec §4.2, "first citation"). */
  anchorId: string;
  markdown: string;
  citations: Citation[];
}

export const ASK_LATENCY_MS = 600;

const cite = (page: number, blockId: string, quote: string): Citation =>
  ({ label: `p. ${page}`, materialId: 'm-norm', page, blockId, quote });

export const STUDIO_ANSWERS: ScriptedAnswer[] = [
  {
    question: 'Why does repeated data cause problems?',
    match: /repeat|redundan|duplicat/i,
    anchorId: 's-p5-2',
    markdown:
      'If the same fact is stored twice, an update can change one copy and miss the other — and the table starts telling two stories. Normalization splits relations so each fact lives in one place, which removes these **update anomalies** at the root.',
    citations: [cite(5, 'p5-b10', 'Goal: Avoid redundancies'), cite(5, 'p5-b11', 'Approach: Split relation schemas')],
  },
  {
    question: 'What is a functional dependency?',
    match: /functional dependenc|\bfds?\b/i,
    anchorId: 's-p6-1',
    markdown:
      'A promise about the data: if you know X, you know A. Whenever two rows share the same X values, they must share the same A value. In the example table, knowing a creature’s **Name** tells you its **Weight**.',
    citations: [cite(6, 'p6-b6', 'A functional dependency (FD) X → A'), cite(7, 'p7-b14', 'Name → Weight')],
  },
  {
    question: 'Why doesn’t commutativity hold?',
    match: /commutativ|y\s*→\s*x/i,
    anchorId: 's-p10-1',
    markdown:
      'X → Y only says X decides Y, not the other way round. Many X values can share one Y value — a₁, a₂ and a₄ all point to b₁ — so knowing Y cannot tell you which X you have.',
    citations: [cite(10, 'p10-b17', 'Commutativity does not apply!'), cite(10, 'p10-b23', 'a 1 b 1 c 1')],
  },
  {
    question: 'Can I split the left-hand side too?',
    match: /left[- ]hand|split.*left|left.*split/i,
    anchorId: 's-p8-2',
    markdown:
      'No. Title, Year → Length needs *both* attributes: one title can exist in several years with different lengths. Drop either one and the dependency breaks, which is why splitting only works on the right.',
    citations: [cite(8, 'p8-b15', 'The splitting rule only on right-hand side!'), cite(8, 'p8-b17', '⇏ Year → Length')],
  },
  {
    question: 'What does pseudotransitivity give me?',
    match: /pseudo/i,
    anchorId: 's-p12-2',
    markdown:
      'A shortcut. If X decides Y, and W together with Y decides Z, then W together with X decides Z — you may swap Y for X inside a left-hand side. It comes in handy in the **closure algorithm**.',
    citations: [cite(12, 'p12-b21', 'X → Y ∧ WY → Z ⇒ WX → Z')],
  },
];

export const SUGGESTED_QUESTIONS = STUDIO_ANSWERS.slice(0, 3).map((a) => a.question);

export function findAnswer(question: string): ScriptedAnswer | null {
  const q = question.trim();
  if (!q) return null;
  return STUDIO_ANSWERS.find((a) => a.question.toLowerCase() === q.toLowerCase() || a.match.test(q)) ?? null;
}
```

- [ ] **Step 4: Write `data/useAsk.ts`.**

```ts
import { useCallback, useRef, useState } from 'react';
import { ASK_LATENCY_MS, SUGGESTED_QUESTIONS, findAnswer } from '../mocks/studio-answers';
import type { ScriptedAnswer } from '../mocks/studio-answers';

/**
 * The ask seam (Living Learn spec §6.3). Mock now: a scripted answer after a
 * real wait. Wiring a model later replaces this hook's body and nothing above it.
 */
export type AskResult = { kind: 'answer'; answer: ScriptedAnswer } | { kind: 'unknown' };

export function useAsk(): { ask(question: string): Promise<AskResult>; answering: boolean; suggestions: string[] } {
  const [answering, setAnswering] = useState(false);
  const busy = useRef(false);
  const ask = useCallback((question: string): Promise<AskResult> => {
    if (busy.current) return Promise.resolve({ kind: 'unknown' });
    busy.current = true;
    setAnswering(true);
    return new Promise((resolve) => {
      setTimeout(() => {
        busy.current = false;
        setAnswering(false);
        const answer = findAnswer(question);
        resolve(answer ? { kind: 'answer', answer } : { kind: 'unknown' });
      }, ASK_LATENCY_MS);
    });
  }, []);
  return { ask, answering, suggestions: SUGGESTED_QUESTIONS };
}
```

- [ ] **Step 5: Run the tests.**
Run: `npx vitest run src/features/spaces/mocks/__tests__/studio-answers.test.ts src/features/spaces/studio/__tests__/useAsk.test.tsx src/features/spaces/__tests__/boundary.test.ts`
Expected: PASS.

- [ ] **Step 6: Gates and commit.**

```bash
npx tsc -p tsconfig.app.json --noEmit && npx eslint src/features/spaces/mocks src/features/spaces/data && node scripts/check-vocabulary.mjs
git add src/features/spaces/mocks src/features/spaces/data src/features/spaces/studio/__tests__/useAsk.test.tsx
git commit -m "feat(studio): scripted answers behind a useAsk seam

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `WovenAnswer`: the growing choreography, Remove, and keeping your place

**Files:**
- Create: `src/features/spaces/studio/components/WovenAnswer.tsx`
- Create: `src/features/spaces/studio/useKeepPlace.ts`
- Modify: `src/features/spaces/studio/motion.ts` (add constants)
- Test: `src/features/spaces/studio/__tests__/WovenAnswer.test.tsx`

**Interfaces:**
- Consumes: `GeneratedBlock` (Task 1), `Markdown`, `plainText`.
- Produces:
  ```ts
  // motion.ts
  export const GROW_S = 0.7; export const RULE_S = 0.9; export const WORD_S = 0.55;
  export const WORD_STAGGER_S = 0.055; export const WORD_BUDGET_S = 1.6; export const WORD_LIMIT = 40;
  export const COLLAPSE_S = 0.4; export const GLOW_FADE_S = 0.8;
  // WovenAnswer.tsx
  interface WovenAnswerProps {
    block: GeneratedBlock;
    fresh: boolean;                  // grows now (true once, right after it was added)
    onSettled(id: string): void;     // choreography finished (or immediately when not fresh / reduced motion)
    onRemove(id: string): void;      // called after the collapse finishes
    onOpenPeek?(blockId: string): void; // citation chip → Peek on the cited source block (Task 7 wires)
  }
  export function WovenAnswer(props: WovenAnswerProps): JSX.Element;
  export function wordDelays(count: number): number[]; // seconds, per word (exported for tests)
  // useKeepPlace.ts
  export function useKeepPlace(ref: React.RefObject<HTMLElement>, enabled: boolean): void;
  ```

- [ ] **Step 1: Write the failing tests.** Create `studio/__tests__/WovenAnswer.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WovenAnswer, wordDelays } from '../components/WovenAnswer';
import { WORD_BUDGET_S, WORD_LIMIT, WORD_STAGGER_S } from '../motion';
import type { GeneratedBlock } from '../types';

const block: GeneratedBlock = {
  id: 'a1', origin: 'generated', askedAs: 'Why?', anchorId: 's1',
  markdown: 'Stored **once**, never twice.',
  citations: [{ label: 'p. 5', materialId: 'm', page: 5, blockId: 'p5-b10' }],
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('wordDelays', () => {
  it('staggers short answers word by word', () => {
    expect(wordDelays(3)).toEqual([0, WORD_STAGGER_S, 2 * WORD_STAGGER_S]);
  });
  it('never takes longer than the budget, however long the answer', () => {
    const d = wordDelays(400);
    expect(Math.max(...d)).toBeLessThanOrEqual(WORD_BUDGET_S + 1e-9);
    // after WORD_LIMIT words the rest settle in groups, not one by one
    expect(new Set(d.slice(WORD_LIMIT)).size).toBeLessThan(400 - WORD_LIMIT);
  });
});

describe('WovenAnswer', () => {
  it('shows the tag, the question, the answer and its citations', () => {
    render(<WovenAnswer block={block} fresh={false} onSettled={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('From your question')).toBeInTheDocument();
    expect(screen.getByText('Why?')).toBeInTheDocument();
    expect(screen.getByText('once').tagName).toBe('STRONG');
    expect(screen.getByRole('button', { name: /p\. 5/ })).toBeInTheDocument();
    expect(document.querySelector('[data-block-id="a1"][data-extracted="false"]')).not.toBeNull();
  });
  it('settles at once when it is not fresh', () => {
    const onSettled = vi.fn();
    render(<WovenAnswer block={block} fresh={false} onSettled={onSettled} onRemove={vi.fn()} />);
    expect(onSettled).toHaveBeenCalledWith('a1');
  });
  it('while growing, words are hidden from screen readers and the full text is there once', () => {
    render(<WovenAnswer block={block} fresh onSettled={vi.fn()} onRemove={vi.fn()} />);
    expect(document.querySelector('[data-woven-words][aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('Stored once, never twice.', { selector: '.sr-only' })).toBeInTheDocument();
  });
  it('Remove asks the screen to remove it once the collapse is done', async () => {
    const onRemove = vi.fn();
    render(<WovenAnswer block={block} fresh={false} onSettled={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove this answer' }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(onRemove).toHaveBeenCalledWith('a1');
  });
});
```

(happy-dom does not run Motion's `onAnimationComplete` reliably. `WovenAnswer` must therefore also finish settle and remove on a timer equal to the animation length, as in Step 3, and the tests rely on that.)

- [ ] **Step 2: Run them and watch them fail.**
Run: `npx vitest run src/features/spaces/studio/__tests__/WovenAnswer.test.tsx`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Add the constants and the components.** Append to `studio/motion.ts`:

```ts
/** Living Learn: an answer grows into the page (spec §4.3). */
export const GROW_S = 0.7;
export const RULE_S = 0.9;
export const WORD_S = 0.55;
export const WORD_STAGGER_S = 0.055;
/** No answer takes longer than this to start its last word. */
export const WORD_BUDGET_S = 1.6;
/** After this many words, the rest settle sentence by sentence. */
export const WORD_LIMIT = 40;
export const COLLAPSE_S = 0.4;
export const GLOW_FADE_S = 0.8;
/** Teal in rgba because Motion cannot interpolate `var()`. Matches --studio-woven (dark). */
export const GLOW_ON = 'rgba(159,211,199,0.06)';
export const GLOW_OFF = 'rgba(159,211,199,0)';
```

Create `studio/useKeepPlace.ts`:

```ts
import { useEffect } from 'react';

/**
 * Your view never moves on its own (Living Learn spec §4.4). While `ref`
 * grows above the top of the viewport, scroll by exactly the growth, on the
 * same frame, so the words you are reading stay put. The column sets
 * `overflow-anchor: none` so the browser's own anchoring never doubles it.
 */
export function useKeepPlace(ref: React.RefObject<HTMLElement>, enabled: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return;
    let last = el.getBoundingClientRect().height;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const delta = r.height - last;
      last = r.height;
      if (delta !== 0 && r.bottom - delta <= 0) window.scrollBy(0, delta);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, enabled]);
}
```

Create `studio/components/WovenAnswer.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { Markdown } from './Markdown';
import {
  COLLAPSE_S, FLIGHT_EASE, GROW_S, RULE_S, WORD_BUDGET_S, WORD_LIMIT, WORD_S, WORD_STAGGER_S,
} from '../motion';
import { plainText } from '../text';
import { useKeepPlace } from '../useKeepPlace';
import type { GeneratedBlock } from '../types';

interface Props {
  block: GeneratedBlock;
  fresh: boolean;
  onSettled(id: string): void;
  onRemove(id: string): void;
  onOpenPeek?(blockId: string): void;
}

/** Per-word start delays: word by word up to WORD_LIMIT, then in groups; never past WORD_BUDGET_S. */
export function wordDelays(count: number): number[] {
  const step = Math.min(WORD_STAGGER_S, WORD_BUDGET_S / Math.max(count - 1, 1));
  const head = Math.min(count, WORD_LIMIT);
  const out = Array.from({ length: head }, (_, i) => i * step);
  if (count > head) {
    const start = head * step;
    const groups = Math.ceil((count - head) / 12);
    const g = groups > 1 ? (WORD_BUDGET_S - start) / (groups - 1) : 0;
    for (let i = head; i < count; i++) out.push(Math.min(WORD_BUDGET_S, start + Math.floor((i - head) / 12) * g));
  }
  return out;
}

/**
 * An answer, woven under the paragraph it is about — Living Learn spec §4.3–4.6.
 *
 * Fresh: space opens, a teal rule draws down, words settle from blurred to
 * sharp; then the plain words give way to the rendered Markdown (the key
 * terms light up last). Not fresh, or reduced motion: it is simply there.
 * Remove collapses it, then asks the screen to take it out (Undo lives there).
 */
export function WovenAnswer({ block, fresh, onSettled, onRemove, onOpenPeek }: Props) {
  const reduce = useReducedMotion();
  const animate = fresh && !reduce;
  const [settled, setSettled] = useState(!animate);
  const [leaving, setLeaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useKeepPlace(ref, animate && !settled);

  const words = useMemo(() => plainText(block.markdown).split(' '), [block.markdown]);
  const delays = useMemo(() => wordDelays(words.length), [words.length]);
  const total = GROW_S * 0.2 + (delays[delays.length - 1] ?? 0) + WORD_S;

  useEffect(() => {
    if (!animate) {
      onSettled(block.id);
      return;
    }
    const t = setTimeout(() => {
      setSettled(true);
      onSettled(block.id);
    }, total * 1000);
    return () => clearTimeout(t);
    // once per mount: a fresh answer grows once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => onRemove(block.id), (reduce ? 0.15 : COLLAPSE_S) * 1000);
    return () => clearTimeout(t);
  }, [leaving, reduce, onRemove, block.id]);

  return (
    <motion.div
      ref={ref}
      data-block-id={block.id}
      data-extracted="false"
      data-woven="true"
      initial={animate ? { height: 0, opacity: 1 } : reduce && fresh ? { opacity: 0 } : false}
      animate={leaving ? { height: 0, opacity: reduce ? 0 : 1 } : { height: 'auto', opacity: 1 }}
      transition={{
        height: { duration: leaving ? COLLAPSE_S : GROW_S, ease: FLIGHT_EASE },
        opacity: { duration: 0.15 },
      }}
      className="group/woven relative overflow-hidden"
    >
      <div className="relative mb-4 mt-0.5 py-1 pl-[18px]">
        <motion.span
          aria-hidden
          initial={animate ? { scaleY: 0 } : false}
          animate={{ scaleY: 1 }}
          transition={{ duration: RULE_S, ease: FLIGHT_EASE, delay: 0.15 }}
          style={{ originY: 0 }}
          className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full bg-gradient-to-b from-[rgb(var(--studio-woven))] to-[rgb(var(--studio-woven)/0.15)]"
        />
        <motion.p
          initial={animate ? { opacity: 0 } : false}
          animate={{ opacity: 0.85 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mb-1 text-[12px] text-[rgb(var(--studio-woven))]"
        >
          From your question
        </motion.p>
        <p className="mb-1.5 text-[13px] text-quiet">{block.askedAs}</p>

        {settled ? (
          <motion.div initial={animate ? { opacity: 0.6 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
            <Markdown className="studio-woven-text">{block.markdown}</Markdown>
          </motion.div>
        ) : (
          <p className="studio-prose studio-woven-text">
            <span className="sr-only">{words.join(' ')}</span>
            <span data-woven-words aria-hidden="true">
              {words.map((w, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  transition={{ duration: WORD_S, delay: GROW_S * 0.2 + delays[i] }}
                >
                  {w}{' '}
                </motion.span>
              ))}
            </span>
          </p>
        )}

        {block.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {block.citations.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => c.blockId && onOpenPeek?.(c.blockId)}
                className="console-focusable min-h-6 rounded-full bg-[rgb(var(--studio-chip))] px-2.5 text-[11.5px] tabular-nums text-quiet transition-colors hover:bg-[rgb(var(--studio-chip-hover))] hover:text-foreground"
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          aria-label="Remove this answer"
          onClick={() => setLeaving(true)}
          className="console-focusable absolute right-0 top-0 flex h-7 w-7 items-center justify-center rounded-full text-faint opacity-0 transition-opacity hover:bg-[rgb(var(--studio-chip))] hover:text-foreground focus-visible:opacity-100 group-hover/woven:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
```

Append to `studio-surface.css`:

```css
/* An answer you asked for reads in full foreground, a touch smaller than the summary. */
.studio-woven-text,
.studio-woven-text.studio-prose {
  font-size: 16px;
  color: hsl(var(--foreground));
}
```

- [ ] **Step 4: Run the tests.**
Run: `npx vitest run src/features/spaces/studio/__tests__/WovenAnswer.test.tsx src/features/spaces/components/__tests__/motion.test.tsx`
Expected: PASS.

- [ ] **Step 5: Gates and commit.**

```bash
npx tsc -p tsconfig.app.json --noEmit && npx eslint src/features/spaces/studio && node scripts/check-vocabulary.mjs
git add src/features/spaces/studio
git commit -m "feat(studio): WovenAnswer — space opens, rule draws, words settle; Remove collapses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Composer: ask pill, suggestions, notices, pager slot, `/`

**Files:**
- Create: `src/features/spaces/studio/components/Composer.tsx`
- Modify: `src/features/spaces/studio/components/PagerPill.tsx` (`embedded` prop)
- Test: `src/features/spaces/studio/__tests__/Composer.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type ComposerNotice =
    | { kind: 'unknown' }                          // §4.7 honest line + suggestion chips
    | { kind: 'removed'; onUndo(): void }          // "Answer removed · Undo"
    | { kind: 'below'; onJump(): void };           // "Added below ↓"
  interface ComposerProps {
    answering: boolean;
    suggestions: string[];
    showSuggestions: boolean;      // until the first question
    notice: ComposerNotice | null;
    hint: string | null;
    pager: React.ReactNode;        // rendered at the pill's right end, hidden below 640px
    onAsk(question: string): void;
  }
  export function Composer(props: ComposerProps): JSX.Element;
  ```
- PagerPill gains `embedded?: boolean`. When true it renders only the group, without its own `bg-[rgb(var(--studio-chip))]`, `backdrop-blur-md` or the hint paragraph.

- [ ] **Step 1: Write the failing tests.** Create `studio/__tests__/Composer.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Composer } from '../components/Composer';

const base = {
  answering: false, suggestions: ['Why does repeated data cause problems?'], showSuggestions: true,
  notice: null, hint: null, pager: <span>2 / 12</span>, onAsk: vi.fn(),
};

describe('Composer', () => {
  it('sends on Enter and clears', () => {
    const onAsk = vi.fn();
    render(<Composer {...base} onAsk={onAsk} />);
    const box = screen.getByRole('textbox', { name: 'Ask about this Material' });
    fireEvent.change(box, { target: { value: 'What is an FD?' } });
    fireEvent.submit(box.closest('form')!);
    expect(onAsk).toHaveBeenCalledWith('What is an FD?');
    expect(box).toHaveValue('');
  });
  it('ignores an empty question', () => {
    const onAsk = vi.fn();
    render(<Composer {...base} onAsk={onAsk} />);
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    expect(onAsk).not.toHaveBeenCalled();
  });
  it('a suggestion chip asks that question', () => {
    const onAsk = vi.fn();
    render(<Composer {...base} onAsk={onAsk} />);
    fireEvent.click(screen.getByRole('button', { name: 'Why does repeated data cause problems?' }));
    expect(onAsk).toHaveBeenCalledWith('Why does repeated data cause problems?');
  });
  it('is disabled while answering', () => {
    render(<Composer {...base} answering />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Answering…' })).toBeDisabled();
  });
  it('/ focuses it, but not while typing elsewhere or with a modifier', () => {
    render(<><input aria-label="other" /><Composer {...base} /></>);
    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByRole('textbox', { name: 'Ask about this Material' })).toHaveFocus();
    const other = screen.getByLabelText('other');
    other.focus();
    fireEvent.keyDown(other, { key: '/' });
    expect(other).toHaveFocus();
    fireEvent.keyDown(window, { key: '/', metaKey: true });
    expect(other).toHaveFocus();
  });
  it('says honestly when it cannot answer, and offers the suggestions', () => {
    render(<Composer {...base} showSuggestions={false} notice={{ kind: 'unknown' }} />);
    expect(screen.getByText(/In this preview I can answer a few questions about Normalization/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Why does repeated data cause problems?' })).toBeInTheDocument();
  });
  it('offers Undo and Added below', () => {
    const onUndo = vi.fn();
    const onJump = vi.fn();
    const { rerender } = render(<Composer {...base} notice={{ kind: 'removed', onUndo }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalled();
    rerender(<Composer {...base} notice={{ kind: 'below', onJump }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Added below ↓' }));
    expect(onJump).toHaveBeenCalled();
  });
  it('holds the pager at its end', () => {
    render(<Composer {...base} />);
    expect(screen.getByText('2 / 12')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**
Run: `npx vitest run src/features/spaces/studio/__tests__/Composer.test.tsx`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement `Composer.tsx`.**

```tsx
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp } from 'lucide-react';
import { inDialog, isTyping } from '../keys';

export type ComposerNotice =
  | { kind: 'unknown' }
  | { kind: 'removed'; onUndo(): void }
  | { kind: 'below'; onJump(): void };

interface Props {
  answering: boolean;
  suggestions: string[];
  showSuggestions: boolean;
  notice: ComposerNotice | null;
  hint: string | null;
  pager: React.ReactNode;
  onAsk(question: string): void;
}

const chip =
  'console-focusable pointer-events-auto min-h-7 rounded-full bg-[rgb(var(--studio-chip))] px-3 text-[12.5px] text-quiet backdrop-blur-md transition-colors hover:bg-[rgb(var(--studio-chip-hover))] hover:text-foreground';
const fade = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 4 }, transition: { duration: 0.2 } };

/**
 * Ask, at the bottom of the page — Living Learn spec §4.1. The reader's pill:
 * the question on the left, the pager tucked in at the right end. Above it,
 * one line at a time: the hint, an honest "can't answer that here", Undo, or
 * "Added below". `/` jumps in, unless you're typing or in a dialog.
 */
export function Composer({ answering, suggestions, showSuggestions, notice, hint, pager, onAsk }: Props) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || inDialog(e.target)) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const send = (q: string) => {
    const question = q.trim();
    if (!question || answering) return;
    onAsk(question);
    setValue('');
  };
  const chips = (showSuggestions || notice?.kind === 'unknown') && !answering;

  return (
    <div className="flex w-full max-w-[560px] flex-col items-center gap-2">
      <AnimatePresence initial={false} mode="wait">
        {notice?.kind === 'unknown' ? (
          <motion.p key="unknown" {...fade} className="pointer-events-auto text-center text-[12.5px] text-quiet">
            In this preview I can answer a few questions about Normalization — try one of these:
          </motion.p>
        ) : notice?.kind === 'removed' ? (
          <motion.div key="removed" {...fade} className="pointer-events-auto flex items-center gap-2 text-[12.5px] text-quiet">
            Answer removed
            <button type="button" onClick={notice.onUndo} className={chip}>Undo</button>
          </motion.div>
        ) : notice?.kind === 'below' ? (
          <motion.button key="below" type="button" {...fade} onClick={notice.onJump} className={chip}>
            Added below ↓
          </motion.button>
        ) : hint ? (
          <motion.p key="hint" {...fade} className="pointer-events-auto hidden text-center text-[12px] text-quiet sm:block">
            {hint}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {chips && (
          <motion.div key="chips" {...fade} className="flex flex-wrap justify-center gap-1.5">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className={chip}>{s}</button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(value);
        }}
        className="pointer-events-auto flex w-full items-center gap-1 rounded-full border border-[rgb(var(--studio-hairline))] bg-[rgb(var(--studio-chip))] p-1 pl-4 backdrop-blur-md"
      >
        <input
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={answering}
          aria-label="Ask about this Material"
          placeholder="Ask about this Material…"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-faint disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={answering}
          aria-label={answering ? 'Answering…' : 'Ask'}
          className="console-focusable flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[13px] font-semibold text-background disabled:opacity-60"
        >
          {answering ? 'Answering…' : <><ArrowUp aria-hidden className="h-3.5 w-3.5" />Ask</>}
        </button>
        <div className="ml-1 hidden border-l border-[rgb(var(--studio-hairline))] pl-1 sm:flex">{pager}</div>
      </form>
    </div>
  );
}
```

In `PagerPill.tsx`, add `embedded?: boolean` to `Props`. When `embedded`:
  - return only the `role="group"` div;
  - drop `rounded-full bg-[rgb(var(--studio-chip))] p-1 backdrop-blur-md` from its classes, keeping `pointer-events-auto flex items-center gap-1 text-[12.5px]`;
  - do not render the hint.

The existing PagerPill tests must stay green.

- [ ] **Step 4: Run the tests.**
Run: `npx vitest run src/features/spaces/studio/__tests__/Composer.test.tsx src/features/spaces/studio/__tests__/pageNav.test.tsx src/features/spaces/components/__tests__/motion.test.tsx`
Expected: PASS.

- [ ] **Step 5: Gates and commit.**

```bash
npx tsc -p tsconfig.app.json --noEmit && npx eslint src/features/spaces/studio && node scripts/check-vocabulary.mjs
git add src/features/spaces/studio
git commit -m "feat(studio): Composer — ask pill with suggestions, honest notices, pager at its end

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Wire it together on the canvas

**Files:**
- Modify: `src/features/spaces/studio/components/CanvasPage.tsx`
- Modify: `src/features/spaces/studio/components/CleanBlock.tsx` (glow)
- Modify: `src/features/spaces/studio/useReadingLine.ts` (export `blockAtReadingLine`)
- Modify: `src/features/spaces/screens/StudioCanvasScreen.tsx`
- Test: `src/features/spaces/studio/__tests__/ask.test.tsx` (create)

**Interfaces:**
- Consumes: everything above. `useAsk`, `insertAnswer`, `removeBlock`, `restoreBlock`, `resolveAnchor`, `WovenAnswer`, `Composer`, `PagerPill embedded`.
- Produces:
  - `CanvasPage` gains these props:
    ```ts
    freshId: string | null; glowId: string | null;
    onAnswerSettled(id: string): void; onRemoveAnswer(id: string): void;
    ```
  - `CleanBlock`'s `glow` now animates.
  - `useReadingLine.ts` exports `blockAtReadingLine(column: HTMLElement | null): string | null` (the same hit-test as the hook, run once, now matching any `[data-block-id]` that is not `[data-woven]`).

- [ ] **Step 1: Write the failing screen tests.** Create `studio/__tests__/ask.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const mount = async () => {
  const utils = render(
    <MemoryRouter initialEntries={['/v4/library/studio/c/c-norm']}>
      <Routes>
        <Route path="/v4/library/studio/c/:canvasId" element={<StudioCanvasScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => { vi.advanceTimersByTime(700); });
  return utils;
};
const ask = async (q: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask about this Material' }), { target: { value: q } });
  fireEvent.submit(screen.getByRole('textbox', { name: 'Ask about this Material' }).closest('form')!);
  await act(async () => { vi.advanceTimersByTime(700); });
};
const order = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-view="clean"] [data-block-id]')).map((e) => e.getAttribute('data-block-id'));

describe('asking on the canvas', () => {
  it('weaves the answer under the paragraph it is about and announces it', async () => {
    const { container } = await mount();
    await ask('Why does repeated data cause problems?');
    const ids = order(container);
    const at = ids.indexOf('s-p5-2');
    expect(ids[at + 1]).toMatch(/^ans-/);
    expect(screen.getByRole('status')).toHaveTextContent(/Answer added under: The tools are functional/);
  });

  it('disables the composer while answering', async () => {
    await mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask about this Material' }), { target: { value: 'What is a functional dependency?' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    expect(screen.getByRole('textbox', { name: 'Ask about this Material' })).toBeDisabled();
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(screen.getByRole('textbox', { name: 'Ask about this Material' })).not.toBeDisabled();
  });

  it('is honest about questions it cannot answer, and adds nothing', async () => {
    const { container } = await mount();
    const before = order(container).length;
    await ask('Tell me a joke');
    expect(screen.getByText(/In this preview I can answer a few questions/)).toBeInTheDocument();
    expect(order(container).length).toBe(before);
  });

  it('Remove and Undo put the answer back in the same place', async () => {
    const { container } = await mount();
    await ask('What is a functional dependency?');
    await act(async () => { vi.advanceTimersByTime(3000); });
    const withAnswer = order(container);
    fireEvent.click(screen.getByRole('button', { name: 'Remove this answer' }));
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(order(container).some((id) => id?.startsWith('ans-'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(order(container)).toEqual(withAnswer);
  });

  it('answers fade, not fly, in Source view', async () => {
    const { container } = await mount();
    await ask('What is a functional dependency?');
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(container.querySelector('[data-woven="true"][data-morph]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**
Run: `npx vitest run src/features/spaces/studio/__tests__/ask.test.tsx`
Expected: FAIL, because there is no composer on the screen yet.

- [ ] **Step 3: CleanBlock glow.** Use `glow` from Props. On the outer `motion.div`:
  - extend `animate` so it sets `boxShadow` to `0 0 0 8px ${GLOW_ON}` and `backgroundColor` to `GLOW_ON` when `glow`, and to the `GLOW_OFF` equivalents when not (keep the flash frames taking precedence when `flash`);
  - add `boxShadow: { duration: glow ? 0.3 : GLOW_FADE_S }` and a matching `backgroundColor` entry to `transition`;
  - skip all of this when `useReducedMotion()` is true.
  - Import `GLOW_ON`, `GLOW_OFF` and `GLOW_FADE_S` from `../motion`.

- [ ] **Step 4: CanvasPage renders answers.**
  - Add the four props.
  - In the clean section's block map, render `b.origin === 'generated' ? <WovenAnswer key={b.id} block={b} fresh={p.freshId === b.id} onSettled={p.onAnswerSettled} onRemove={p.onRemoveAnswer} onOpenPeek={p.onOpenPeekSource} /> : <CleanBlock … glow={p.glowId === b.id} />`.
  - Also add an `onOpenPeekSource(sourceBlockId: string): void` prop: a citation chip names a *source* block id, and the screen maps it to the canvas block that covers it (below).

- [ ] **Step 5: `blockAtReadingLine`.** In `useReadingLine.ts`, export:

```ts
/** The block under the reading line right now, once (Living Learn spec §4.2, last fallback). */
export function blockAtReadingLine(column: HTMLElement | null): string | null {
  if (typeof document.elementsFromPoint !== 'function') return null;
  const r = column?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
  for (const el of document.elementsFromPoint(x, window.innerHeight * READING_LINE)) {
    const block = (el as HTMLElement).closest?.('[data-block-id]:not([data-woven])') as HTMLElement | null;
    if (block?.dataset.blockId) return block.dataset.blockId;
  }
  return null;
}
```

- [ ] **Step 6: The screen.** In `StudioCanvasScreen.tsx`:

  1. Change the hints to:
     ```ts
     const HINT = 'Rest on a paragraph to see the source, press S, or ask below.';
     const HINT_NO_ORIGINAL = 'Use ← → to move between pages, or ask below.';
     ```
     If a test asserts the old hint, update it and list it in your report.
  2. Add state and the ask flow:

```ts
const { ask, answering, suggestions } = useAsk();
const [asked, setAsked] = useState(false);
const [freshId, setFreshId] = useState<string | null>(null);
const [glowId, setGlowId] = useState<string | null>(null);
const [notice, setNotice] = useState<ComposerNotice | null>(null);
const [announce, setAnnounce] = useState('');
const noticeTimer = useRef<ReturnType<typeof setTimeout>>();
const showNotice = (n: ComposerNotice | null, ms = 6000) => {
  clearTimeout(noticeTimer.current);
  setNotice(n);
  if (n) noticeTimer.current = setTimeout(() => setNotice(null), ms);
};
useEffect(() => () => clearTimeout(noticeTimer.current), []);
const askSeq = useRef(0);

const onAsk = async (question: string) => {
  if (!doc) return;
  setAsked(true);
  setEngaged(true);
  showNotice(null);
  const selectionBlock =
    (window.getSelection()?.anchorNode?.parentElement?.closest('[data-block-id]') as HTMLElement | null)?.dataset.blockId ?? null;
  const result = await ask(question);
  if (result.kind === 'unknown') {
    showNotice({ kind: 'unknown' }, 10000);
    return;
  }
  setEdited((prev) => {
    const base = prev ?? canvas;
    if (!base) return prev;
    const anchorId =
      resolveAnchor(base.blocks, {
        selection: selectionBlock,
        cited: result.answer.anchorId,
        readingLine: blockAtReadingLine(column.current),
      }) ?? base.blocks[base.blocks.length - 1].id;
    const id = `ans-${++askSeq.current}`;
    const block: GeneratedBlock = {
      id, origin: 'generated', markdown: result.answer.markdown, citations: result.answer.citations,
      askedAs: question, anchorId,
    };
    const anchor = base.blocks.find((b) => b.id === anchorId);
    setFreshId(id);
    setGlowId(anchorId);
    setAnnounce(`Answer added under: ${anchor ? firstWords(anchor.markdown) : 'the end'}`);
    return insertAnswer(base, block);
  });
};
```

  3. **"Added below ↓".** After a fresh answer mounts, check whether it is off-screen:

```ts
useEffect(() => {
  if (!freshId) return;
  const el = document.querySelector<HTMLElement>(`[data-block-id="${freshId}"]`);
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.height !== 0 && r.top > window.innerHeight) {
    showNotice({ kind: 'below', onJump: () => { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); showNotice(null); } });
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNotice((n) => (n?.kind === 'below' ? null : n)); io.disconnect(); } });
      io.observe(el);
      return () => io.disconnect();
    }
  }
}, [freshId]);
```

  4. **Settle, Remove and Undo:**

```ts
const onAnswerSettled = useCallback((id: string) => {
  setFreshId((f) => (f === id ? null : f));
  setGlowId(null);
}, []);
const onRemoveAnswer = useCallback((id: string) => {
  setEdited((prev) => {
    const base = prev ?? canvas;
    if (!base) return prev;
    const { doc: next, removed } = removeBlock(base, id);
    if (removed)
      showNotice({ kind: 'removed', onUndo: () => { setEdited((p) => (p ? restoreBlock(p, removed) : p)); showNotice(null); } });
    return next;
  });
}, [canvas]);
```

  (`showNotice` is called from inside a state updater. Wrap it so it is scheduled with `queueMicrotask(() => showNotice(…))`, keeping the updater pure under StrictMode. Do the same for `setFreshId`, `setGlowId` and `setAnnounce` in `onAsk`: compute the new doc and the ids *outside* `setEdited` from `edited ?? canvas`, then call the setters normally. Prefer that over side effects inside an updater.)

  5. **Citation chips → Peek.** `onOpenPeekSource(sourceId)` finds the first block with `hasSource(b) && b.source.blockIds.includes(sourceId)` and calls `peek.open(thatBlock.id)`. If none covers it, it does nothing.

  6. **The live region**, anywhere in the screen's JSX:
     `<p role="status" aria-live="polite" className="sr-only">{announce}</p>`

  7. **Replace the bottom page line** (the `PagerPill` wrapper) with:

```tsx
<div className={cn('pointer-events-none fixed inset-x-0 bottom-5 z-20 flex justify-center px-4 min-[1180px]:left-60', gutter && 'right-[29.5rem]')}>
  <Composer
    answering={answering}
    suggestions={suggestions}
    showSuggestions={!asked}
    notice={notice}
    hint={engaged ? null : material.sourceRemoved ? HINT_NO_ORIGINAL : HINT}
    onAsk={onAsk}
    pager={
      <PagerPill
        embedded
        current={nav.counter}
        last={nav.last}
        canBack={nav.index > 0}
        canForward={nav.index >= 0 && nav.index < viewPages.length - 1}
        hint={null}
        onStep={nav.step}
      />
    }
  />
</div>
```

     - Raise the scrim from `h-36` to `h-48`, and the column's bottom padding from `pb-56` to `pb-72`, so the composer with chips never covers words.
     - Add `[overflow-anchor:none]` to the `<main>` classes (spec §4.4).
  8. Pass `freshId`, `glowId`, `onAnswerSettled`, `onRemoveAnswer` and `onOpenPeekSource` to `CanvasPage`.
  9. **Answers in Morph:** `WovenAnswer` never sets `layoutId`, so in Source view it leaves with the clean section's crossfade (spec §4.8). No extra code. The last ask test guards it.

- [ ] **Step 7: Run the whole Studio suite.**
Run: `npx vitest run src/features/spaces --maxWorkers=2`
Expected: PASS. Update only wording assertions that changed (hint text) and list them in your report.

- [ ] **Step 8: Gates and commit.**

```bash
npx tsc -p tsconfig.app.json --noEmit && npx eslint src/features/spaces/studio src/features/spaces/screens/StudioCanvasScreen.tsx && node scripts/check-vocabulary.mjs
git add src/features/spaces
git commit -m "feat(studio): ask on the canvas — answers grow under their paragraph, Remove/Undo, Added below

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Verification after Task 7 (controller, in the browser)

Use the `dev-studio` preview on :5221 at `/v4/library/studio/c/c-norm`, at 1440×900 and on the mobile preset.
1. Learn opens on the calm summary. Gists are brighter, terms warm, the note sits under page 2's first paragraph, and "Klausurrelevant!" is underlined.
2. Hover a summary paragraph: Peek outlines the union area. Press `S`: paragraphs fly home, and "Not in your version" shows running headers.
3. Click the suggestion "Why does repeated data cause problems?": the anchor glows, space opens, the rule draws, and the words settle.
4. Scroll to the top and ask "What does pseudotransitivity give me?": "Added below ↓" appears, and clicking it scrolls to the answer.
5. Remove → Undo restores it. Ask "Tell me a joke" → the honest line and the chips.
6. Reduced motion (emulated): an answer just fades in.
