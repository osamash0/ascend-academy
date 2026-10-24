# Studio Canvas — Plan 1: Foundation, Peek, Morph

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A light, canvas-first Studio at `/v4/library/studio` where a Material opens as a clean page, built from real pages and block coordinates, with **Peek** (one paragraph → its spot on the original) and **Morph** (the whole page flies back to the original, and back).

**Architecture:**
- Mock-only v4 UI under `src/features/spaces/`.
- A Python script turns the real `Normalization.pdf` into page images plus a JSON fixture of source blocks with bounding boxes.
- Everything is read through one data seam (`data/useSpaces.ts`).
- Pure geometry and editing logic lives in `studio/*.ts` and is unit-tested.
- Two hooks hold the interaction state machines: `usePeek`, `useMorph`.
- Morph is Motion shared-layout animation (`layoutId`) between clean blocks and boxes over the real page image.

**Tech Stack:** React 18, TypeScript, Tailwind 3.4, Motion 13 (`motion/react`), Radix Dialog (shadcn `@/components/ui/dialog`), Streamdown 2.7.0, Vitest + happy-dom + Testing Library, Python 3 + PyMuPDF + Pillow (fixture script only).

**Spec:** `docs/superpowers/specs/2026-10-10-studio-canvas-design.md`. Read §3, §4, §6, §8–§11 before starting. Plan 2 (Ask, Create, Publish: spec §5, §7) is written after this plan lands.

## Global Constraints

- **Location:** work in worktree `/Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/studio-experience-9b2722`, branch `claude/studio-canvas-spec`. Never commit to `main`.
- **Mock data only.** No API calls, no Supabase, no backend imports below `data/useSpaces.ts`.
- **UI copy vocabulary** (checked by `node scripts/check-vocabulary.mjs` over every non-test `.ts/.tsx` in `src/features/spaces`):
  - never: professor, student, teacher, instructor, course, classroom, module, folder, lecture, lms, slide, deck, document
  - use: Material, page, Lesson, Space, Clean, Original
- **Material text is data, not copy.** The generated fixture is a `.json` file because it contains words like "Slide"; the vocabulary gate only scans `.ts/.tsx`.
- **Motion owns animation.** Use `motion/react`. Don't add CSS `@keyframes` or `transition-*` for movement (colour transitions on hover are fine). `MotionRoot` already sets `reducedMotion="user"`.
- **Every decorative lucide icon** gets `aria-hidden`. **Every interactive target** is at least 24×24px.
- **Storage:** `localStorage` holds per-viewer conveniences only (theme, last view), always inside try/catch.
- **Pinned dependency:** `streamdown@2.7.0`.
- **Gates (run all at the end of every task):**
  ```bash
  npx tsc -p tsconfig.app.json --noEmit
  node scripts/check-vocabulary.mjs
  npx vitest run src/features/spaces
  ```
  Use `tsconfig.app.json`; `tsc -p tsconfig.json` checks nothing.
- **Timings (spec §4):**

  | Constant | Value |
  |---|---|
  | Peek intent delay | 350 ms |
  | Peek grace period | 600 ms |
  | Pin follow throttle | 150 ms |
  | Reading line | 40% of viewport height |
  | Morph hold threshold | 250 ms |
  | Flight duration | 600 ms |
  | Flight stagger | 45 ms |
  | Flight easing | `[0.2, 0.8, 0.2, 1]` |
  | Outline glide | 250 ms |
  | Text fade during flight | 240 ms |
  | Flash after returning | 1.2 s |
  | Peek image crossfade | 150 ms |

---

## File map

```
scripts/studio/build_fixture.py                         T1  PDF → page WebPs + fixture JSON
public/v4-mock/studio/normalization-p{1..12}.webp       T1  generated page images
src/features/spaces/studio/types.ts                     T1  §6 types
src/features/spaces/mocks/studio-normalization.json     T1  generated fixture (do not edit)
src/features/spaces/mocks/studio-canvas.ts              T2  scenarios on top of the fixture + lookups
src/features/spaces/mocks/__tests__/studio-canvas.test.ts T2 fixture guards
src/features/spaces/studio/geometry.ts (+ __tests__)    T3  unionBox, regionFor, groupByPage, unmapped, pickAnchorPage, boxStyle
src/features/spaces/studio/edit.ts (+ __tests__)        T3  includeSourceBlock, markdownFor
src/features/spaces/data/useSpaces.ts                   T3  useCanvas, useStudioHome
src/features/spaces/studio/studio-surface.css           T4  light tokens, prose
src/features/spaces/studio/useStudioTheme.ts (+test)    T4
src/features/spaces/studio/components/Markdown.tsx (+test) T4  Streamdown wrapper
src/features/spaces/studio/motion.ts                    T5  shared motion constants
src/features/spaces/studio/components/CleanBlock.tsx    T5 (changed T9)
src/features/spaces/studio/components/CanvasPage.tsx    T5 (replaced T9)
src/features/spaces/screens/StudioHomeScreen.tsx        T5
src/features/spaces/screens/StudioCanvasScreen.tsx      T5 (replaced T7, T9)
src/App.tsx                                             T5  two routes
src/features/spaces/studio/usePeek.ts (+test)           T6
src/features/spaces/studio/useWide.ts                   T7
src/features/spaces/studio/useReadingLine.ts (+test)    T7
src/features/spaces/studio/components/Peek.tsx          T7
src/features/spaces/studio/components/FullPageDialog.tsx T7
src/features/spaces/studio/useMorph.ts (+test)          T8
src/features/spaces/studio/components/MorphSwitch.tsx   T8
src/features/spaces/studio/text.ts (+test)              T9  plainText, firstWords
src/features/spaces/studio/components/OriginalPage.tsx (+test) T9
```

Tests live in `src/features/spaces/studio/__tests__/` unless noted.

---

### Task 1: Types and the real-page fixture

**Files:**
- Create: `scripts/studio/build_fixture.py`
- Create: `src/features/spaces/studio/types.ts`
- Create (generated): `public/v4-mock/studio/normalization-p1.webp` … `normalization-p12.webp`
- Create (generated): `src/features/spaces/mocks/studio-normalization.json`
- Modify: `tsconfig.app.json` (add `"resolveJsonModule": true`)

**Interfaces:**
- Produces:
  - **Types** (exact names): `Box`, `SourceBlockKind`, `SourceBlock`, `SourcePage`, `SourceRef`, `Citation`, `ExtractedBlock`, `WrittenBlock`, `GeneratedBlock`, `CanvasBlock`, `CanvasDoc`, `StudioMaterial`.
  - **JSON shape:** `{ "_generated": string, "pages": SourcePage[], "blocks": ExtractedBlock[] }`
  - **Ids:**
    - source blocks: `p{page}-b{index}`
    - clean blocks: `c-p{page}-b{index}`
    - material id: `m-norm`
  - **Image URLs:** `/v4-mock/studio/normalization-p{n}.webp`

- [ ] **Step 1: Write the types**

`src/features/spaces/studio/types.ts`:

```ts
/**
 * Studio canvas types — spec §6.
 *
 * Two sides. The *source* side is what the pipeline reads out of a Material
 * and never changes: pages, and blocks with where they sit on the page. The
 * *canvas* side is your version: blocks you read and edit, each saying where
 * it came from. `origin` is the one field every Studio rule keys on — only
 * `extracted` blocks have a place on the original (Peek, Morph), `generated`
 * blocks carry citations instead, `written` blocks have neither.
 */

/** Normalised to the page: 0..1, origin top-left. */
export type Box = [x0: number, y0: number, x1: number, y1: number];

export type SourceBlockKind =
  | 'heading' | 'paragraph' | 'list' | 'table' | 'code' | 'math' | 'figure' | 'handwriting';

export interface SourceBlock {
  /** Stable across re-extraction where the pipeline can manage it. */
  id: string;
  page: number;
  bbox: Box;
  kind: SourceBlockKind;
  /** Extracted text, never generated. Empty for figures. */
  text: string;
  /** OCR only. Below 0.8 the clean block gets a dotted underline. */
  confidence?: number;
  readingOrder: number;
}

export interface SourcePage {
  materialId: string;
  /** 1-based and contiguous — the number printed on the page. */
  page: number;
  /** Points; only the ratio matters. */
  width: number;
  height: number;
  imageUrl: string;
  /** `'page'` = no coordinates were available. They are never invented. */
  geometry: 'block' | 'page';
  /** Empty when `geometry === 'page'`. */
  blocks: SourceBlock[];
}

/** Where a clean block came from. `blockIds: []` means "this page, no finer". */
export interface SourceRef {
  materialId: string;
  page: number;
  blockIds: string[];
}

/** Extends the reader's `TutorCitation` rule — a pointer, never a footnote — down to a block. */
export interface Citation {
  label: string;
  materialId: string;
  page: number;
  blockId?: string;
  quote?: string;
}

export interface ExtractedBlock {
  id: string;
  origin: 'extracted';
  markdown: string;
  source: SourceRef;
  /** True once you changed the wording. The extracted text stays on the SourceBlock. */
  edited: boolean;
}

export interface WrittenBlock {
  id: string;
  origin: 'written';
  markdown: string;
}

export interface GeneratedBlock {
  id: string;
  origin: 'generated';
  markdown: string;
  citations: Citation[];
  askedAs: string;
}

export type CanvasBlock = ExtractedBlock | WrittenBlock | GeneratedBlock;

/** Internal name only: the UI never says "document". */
export interface CanvasDoc {
  id: string;
  materialIds: string[];
  /** Destination Space; required before publishing (Plan 2). */
  spaceId: string | null;
  blocks: CanvasBlock[];
  revision: number;
  updatedAt: string;
}

export interface StudioMaterial {
  id: string;
  filename: string;
  spaceId: string | null;
  /** The file was removed; the clean version keeps working, the original can't be shown. */
  sourceRemoved: boolean;
}
```

- [ ] **Step 2: Write the fixture script**

`scripts/studio/build_fixture.py`:

```python
#!/usr/bin/env python3
"""Build the Studio canvas fixture from a real PDF.

Usage:
  python -I scripts/studio/build_fixture.py <pdf> <first>-<last> <image_dir> <json_out>

Writes one WebP per page (1440px wide) and a JSON file shaped like
`src/features/spaces/studio/types.ts`: {"pages": SourcePage[], "blocks": ExtractedBlock[]}.

Running footers (blocks starting below 90% of the page height) stay on the
source side but get no clean block, so Morph has real "Not in your version"
regions to reveal. Full-page background images and tiny logos are skipped.
"""
import json
import re
import statistics
import sys
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image

MATERIAL_ID = "m-norm"
IMAGE_PREFIX = "/v4-mock/studio/normalization-p"
WIDTH = 1440
PUA = re.compile(r"[-]")  # icon-font bullets in this export


def clean(s: str) -> str:
    s = PUA.sub("•", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def lines_of(block) -> list[str]:
    out = []
    for line in block["lines"]:
        t = clean(" ".join(span["text"] for span in line["spans"]))
        if t:
            out.append(t)
    return out


def max_size(block) -> float:
    return max((s["size"] for l in block["lines"] for s in l["spans"]), default=0.0)


def kind_and_markdown(lines: list[str], size: float, heading_size: float) -> tuple[str, str]:
    if all(l.startswith("•") for l in lines):
        return "list", "\n".join("- " + l.lstrip("•").strip() for l in lines)
    text = " ".join(l.lstrip("•").strip() for l in lines)
    if size >= heading_size and len(text) < 120:
        return "heading", "### " + text
    return "paragraph", text


def norm_box(b, w: float, h: float) -> list[float]:
    def c(v: float) -> float:
        return round(min(1.0, max(0.0, v)), 4)

    x0, y0, x1, y1 = b
    return [c(x0 / w), c(y0 / h), c(x1 / w), c(y1 / h)]


def main(pdf: str, rng: str, image_dir: str, json_out: str) -> None:
    first, last = (int(x) for x in rng.split("-"))
    doc = fitz.open(pdf)
    out_dir = Path(image_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    pages, clean_blocks = [], []

    for n in range(first, last + 1):
        page = doc[n - 1]
        w, h = page.rect.width, page.rect.height
        zoom = WIDTH / w
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        Image.frombytes("RGB", (pix.width, pix.height), pix.samples).save(
            out_dir / f"normalization-p{n}.webp", "WEBP", quality=80, method=6
        )

        raw = page.get_text("dict")["blocks"]
        sizes = [
            s["size"] for b in raw if b["type"] == 0
            for l in b["lines"] for s in l["spans"] if s["text"].strip()
        ]
        heading_size = statistics.median(sizes) * 1.35 if sizes else 999.0

        source = []
        for i, b in enumerate(raw):
            bid = f"p{n}-b{i}"
            box = norm_box(b["bbox"], w, h)
            area = (box[2] - box[0]) * (box[3] - box[1])
            if box[2] <= box[0] or box[3] <= box[1]:
                continue
            if b["type"] == 1:
                if area > 0.6 or area < 0.002:
                    continue  # page background or a logo
                source.append({"id": bid, "page": n, "bbox": box, "kind": "figure",
                               "text": "", "readingOrder": i})
                continue
            lines = lines_of(b)
            if not lines:
                continue
            kind, md = kind_and_markdown(lines, max_size(b), heading_size)
            source.append({"id": bid, "page": n, "bbox": box, "kind": kind,
                           "text": "\n".join(lines), "readingOrder": i})
            if box[1] >= 0.9:
                continue  # running footer: source only
            clean_blocks.append({
                "id": f"c-{bid}", "origin": "extracted", "markdown": md,
                "source": {"materialId": MATERIAL_ID, "page": n, "blockIds": [bid]},
                "edited": False,
            })

        pages.append({
            "materialId": MATERIAL_ID, "page": n,
            "width": round(w, 2), "height": round(h, 2),
            "imageUrl": f"{IMAGE_PREFIX}{n}.webp",
            "geometry": "block", "blocks": source,
        })

    Path(json_out).write_text(json.dumps({
        "_generated": f"scripts/studio/build_fixture.py from Normalization.pdf pages {first}-{last}. Do not edit by hand.",
        "pages": pages,
        "blocks": clean_blocks,
    }, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(pages)} pages, {sum(len(p['blocks']) for p in pages)} source blocks, {len(clean_blocks)} clean blocks")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    main(*sys.argv[1:])
```

- [ ] **Step 3: Get the PDF and run the script**

The PDF lives on the reader branch. Copy it to a temp location; it isn't committed.

```bash
PDF="$(mktemp -d)/normalization.pdf"
git show claude/two-faces-lesson-styling-1da325:public/v4-mock/normalization.pdf > "$PDF"
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -I scripts/studio/build_fixture.py "$PDF" 1-12 public/v4-mock/studio src/features/spaces/mocks/studio-normalization.json
```

Expected: a line like `12 pages, N source blocks, M clean blocks` with M < N; 12 `.webp` files in `public/v4-mock/studio/`; `du -sh public/v4-mock/studio` under 3 MB.

Then sanity-check page 2: its clean `markdown` values should read as list items and a heading, with no `\ue…` characters left.

```bash
grep -c $'\uE' src/features/spaces/mocks/studio-normalization.json
```

Expected: `0`.

- [ ] **Step 4: Enable JSON imports**

In `tsconfig.app.json`, add under `compilerOptions` (next to `"moduleResolution": "bundler"`):

```json
    "resolveJsonModule": true,
```

- [ ] **Step 5: Gates and commit**

```bash
npx tsc -p tsconfig.app.json --noEmit
git add scripts/studio/build_fixture.py src/features/spaces/studio/types.ts src/features/spaces/mocks/studio-normalization.json public/v4-mock/studio tsconfig.app.json
git commit -m "feat(studio): types and a real-page fixture from Normalization.pdf

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Scenario fixture and its guards

**Files:**
- Create: `src/features/spaces/mocks/studio-canvas.ts`
- Test: `src/features/spaces/mocks/__tests__/studio-canvas.test.ts`

**Interfaces:**
- Consumes: Task 1 types and JSON.
- Produces:
  - `STUDIO_MATERIAL: StudioMaterial` (id `m-norm`, filename `Normalization.pdf`, spaceId `s-dbs`)
  - `STUDIO_CANVAS: CanvasDoc` (id `c-norm`)
  - `studioPages: SourcePage[]`
  - `canvasById(id: string): CanvasDoc | undefined`
  - `materialById(id: string): StudioMaterial | undefined`
  - `pagesFor(materialIds: string[]): SourcePage[]`
  - `interface CanvasSummary { id: string; title: string; spaceName: string | null; updatedAt: string }`
  - `recentCanvases(): CanvasSummary[]`
- **Scenario ids:**
  - handwriting source block `p2-hw`, clean block `c-p2-hw`
  - written block `w-1`
  - page 3 is `geometry: 'page'`
  - exactly one extracted block on page 2 has `edited: true`

- [ ] **Step 1: Write the failing guard test**

`src/features/spaces/mocks/__tests__/studio-canvas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  STUDIO_CANVAS, STUDIO_MATERIAL, canvasById, materialById, pagesFor, recentCanvases, studioPages,
} from '../studio-canvas';
import type { ExtractedBlock } from '../../studio/types';

/**
 * Rule guards for the Studio fixture — the same pattern as fixtures.test.ts.
 * A citation or marker that points at nothing renders as a control leading
 * nowhere; these make that impossible to ship from the fixture.
 */
const extracted = STUDIO_CANVAS.blocks.filter((b): b is ExtractedBlock => b.origin === 'extracted');

describe('studio fixture', () => {
  it('has contiguous pages from 1', () => {
    expect(studioPages.map((p) => p.page)).toEqual(studioPages.map((_, i) => i + 1));
  });

  it('keeps every box inside its page and non-empty', () => {
    for (const p of studioPages)
      for (const b of p.blocks) {
        const [x0, y0, x1, y1] = b.bbox;
        expect(x0).toBeGreaterThanOrEqual(0);
        expect(y0).toBeGreaterThanOrEqual(0);
        expect(x1).toBeLessThanOrEqual(1);
        expect(y1).toBeLessThanOrEqual(1);
        expect(x1).toBeGreaterThan(x0);
        expect(y1).toBeGreaterThan(y0);
      }
  });

  it('gives page-geometry pages no blocks, and their clean blocks no block ids', () => {
    const pageOnly = studioPages.filter((p) => p.geometry === 'page');
    expect(pageOnly.map((p) => p.page)).toEqual([3]);
    expect(pageOnly[0].blocks).toEqual([]);
    for (const b of extracted.filter((b) => b.source.page === 3)) expect(b.source.blockIds).toEqual([]);
  });

  it('resolves every source reference', () => {
    for (const b of extracted) {
      const page = studioPages.find((p) => p.materialId === b.source.materialId && p.page === b.source.page);
      expect(page, b.id).toBeDefined();
      for (const id of b.source.blockIds) expect(page!.blocks.some((s) => s.id === id), `${b.id} → ${id}`).toBe(true);
    }
  });

  it('has unique ids on both sides', () => {
    const src = studioPages.flatMap((p) => p.blocks.map((b) => b.id));
    const canvas = STUDIO_CANVAS.blocks.map((b) => b.id);
    expect(new Set(src).size).toBe(src.length);
    expect(new Set(canvas).size).toBe(canvas.length);
  });

  it('has something for Morph to reveal as missing', () => {
    const mapped = new Set(extracted.flatMap((b) => b.source.blockIds));
    expect(studioPages.some((p) => p.blocks.some((s) => !mapped.has(s.id)))).toBe(true);
  });

  it('has the low-confidence handwriting scenario', () => {
    const hw = studioPages[1].blocks.find((b) => b.id === 'p2-hw');
    expect(hw?.kind).toBe('handwriting');
    expect(hw?.confidence).toBeLessThan(0.8);
    expect(extracted.find((b) => b.id === 'c-p2-hw')?.source.blockIds).toEqual(['p2-hw']);
  });

  it('has exactly one edited block and one written block', () => {
    expect(extracted.filter((b) => b.edited)).toHaveLength(1);
    const written = STUDIO_CANVAS.blocks.filter((b) => b.origin === 'written');
    expect(written.map((b) => b.id)).toEqual(['w-1']);
  });

  it('never puts markdown in a raw-HTML form', () => {
    for (const b of STUDIO_CANVAS.blocks) expect(b.markdown).not.toMatch(/<\/?[a-z][\s\S]*>/i);
  });

  it('looks things up', () => {
    expect(canvasById('c-norm')).toBe(STUDIO_CANVAS);
    expect(canvasById('nope')).toBeUndefined();
    expect(materialById('m-norm')).toBe(STUDIO_MATERIAL);
    expect(pagesFor(['m-norm'])).toBe(studioPages);
    expect(pagesFor(['other'])).toEqual([]);
    expect(recentCanvases()[0]).toMatchObject({ id: 'c-norm', title: 'Normalization.pdf', spaceName: 'Database Systems' });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/features/spaces/mocks/__tests__/studio-canvas.test.ts
```

Expected: FAIL, `Cannot find module '../studio-canvas'`.

- [ ] **Step 3: Write the fixture module**

`src/features/spaces/mocks/studio-canvas.ts`:

```ts
import raw from './studio-normalization.json';
import { spaceById } from './spaces';
import type { CanvasBlock, CanvasDoc, ExtractedBlock, SourcePage, StudioMaterial } from '../studio/types';

/**
 * The Studio canvas, canned — built on real pages of Normalization.pdf.
 *
 * `studio-normalization.json` is generated by `scripts/studio/build_fixture.py`
 * and never edited by hand. Everything below is the hand-made part: the
 * scenarios the UI has to handle that one clean PDF does not contain.
 *
 *   • page 3 has no coordinates (`geometry: 'page'`) — the PPTX/MarkItDown
 *     fallback. Peek shows the page without an outline; Morph converges.
 *   • a handwritten note on page 2, OCR'd with low confidence.
 *   • one block you reworded, and one note you wrote yourself.
 *   • running footers are already source-only (the script leaves them out of
 *     the clean version), so Morph has real "Not in your version" regions.
 */

const generated = raw as unknown as { pages: SourcePage[]; blocks: ExtractedBlock[] };

export const STUDIO_MATERIAL: StudioMaterial = {
  id: 'm-norm',
  filename: 'Normalization.pdf',
  spaceId: 's-dbs',
  sourceRemoved: false,
};

const HANDWRITING = {
  id: 'p2-hw',
  page: 2,
  bbox: [0.62, 0.8, 0.95, 0.88] as [number, number, number, number],
  kind: 'handwriting' as const,
  text: 'klausurrelevant!',
  confidence: 0.62,
  readingOrder: 999,
};

function buildPages(): SourcePage[] {
  return generated.pages.map((p) => {
    if (p.page === 2) return { ...p, blocks: [...p.blocks, HANDWRITING] };
    if (p.page === 3) return { ...p, geometry: 'page' as const, blocks: [] };
    return p;
  });
}

function buildBlocks(): CanvasBlock[] {
  const out: CanvasBlock[] = [];
  let editedDone = false;
  let writtenDone = false;
  for (const b of generated.blocks) {
    if (b.source.page === 3) {
      out.push({ ...b, source: { ...b.source, blockIds: [] } });
      continue;
    }
    if (b.source.page === 2 && !editedDone && !b.markdown.startsWith('#')) {
      out.push({ ...b, markdown: `${b.markdown} — in my words: start from what people need.`, edited: true });
      editedDone = true;
    } else {
      out.push(b);
    }
    if (b.source.page === 2 && b.markdown.startsWith('#') && !writtenDone) {
      out.push({ id: 'w-1', origin: 'written', markdown: 'My note: this is the roadmap for the whole topic.' });
      writtenDone = true;
    }
  }
  const lastOfPage2 = out.map((b) => b.origin === 'extracted' && b.source.page === 2).lastIndexOf(true);
  out.splice(lastOfPage2 + 1, 0, {
    id: 'c-p2-hw',
    origin: 'extracted',
    markdown: 'Klausurrelevant!',
    source: { materialId: 'm-norm', page: 2, blockIds: ['p2-hw'] },
    edited: false,
  });
  return out;
}

export const studioPages: SourcePage[] = buildPages();

export const STUDIO_CANVAS: CanvasDoc = {
  id: 'c-norm',
  materialIds: ['m-norm'],
  spaceId: 's-dbs',
  blocks: buildBlocks(),
  revision: 1,
  updatedAt: '2026-10-10T09:00:00Z',
};

export const canvasById = (id: string): CanvasDoc | undefined =>
  id === STUDIO_CANVAS.id ? STUDIO_CANVAS : undefined;

export const materialById = (id: string): StudioMaterial | undefined =>
  id === STUDIO_MATERIAL.id ? STUDIO_MATERIAL : undefined;

/** Same array every call: hook consumers can depend on its identity. */
export const pagesFor = (materialIds: string[]): SourcePage[] =>
  materialIds.includes(STUDIO_MATERIAL.id) ? studioPages : [];

export interface CanvasSummary {
  id: string;
  title: string;
  spaceName: string | null;
  updatedAt: string;
}

export const recentCanvases = (): CanvasSummary[] => [
  {
    id: STUDIO_CANVAS.id,
    title: STUDIO_MATERIAL.filename,
    spaceName: spaceById('s-dbs')?.name ?? null,
    updatedAt: STUDIO_CANVAS.updatedAt,
  },
];
```

- [ ] **Step 4: Run the guards; they pass**

```bash
npx vitest run src/features/spaces/mocks/__tests__/studio-canvas.test.ts
```

Expected: 10 passed. If "has exactly one edited block" fails, page 2 had no non-heading block: open the JSON, pick the page that does, and change `b.source.page === 2` in the edited branch and the test to that page.

- [ ] **Step 5: Gates and commit**

```bash
npx tsc -p tsconfig.app.json --noEmit && node scripts/check-vocabulary.mjs
git add src/features/spaces/mocks/studio-canvas.ts src/features/spaces/mocks/__tests__/studio-canvas.test.ts
git commit -m "feat(studio): scenario fixture (page-only geometry, OCR, edits) with rule guards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Geometry, editing, and the data seam

**Files:**
- Create: `src/features/spaces/studio/geometry.ts`, `src/features/spaces/studio/edit.ts`
- Modify: `src/features/spaces/data/useSpaces.ts` (append two hooks + imports)
- Test: `src/features/spaces/studio/__tests__/geometry.test.ts`, `edit.test.ts`, `src/features/spaces/studio/__tests__/useCanvas.test.tsx`

**Interfaces:**
- Consumes: Task 1 types, Task 2 lookups.
- Produces:
  - `unionBox(boxes: Box[]): Box | null`
  - `interface Region { page: SourcePage; box: Box | null }`
  - `regionFor(ref: SourceRef, pages: SourcePage[]): Region | null`
  - `regionForBlock(blocks: CanvasBlock[], pages: SourcePage[], blockId: string): Region | null`
  - `minConfidence(ref: SourceRef, pages: SourcePage[]): number | undefined`
  - `interface PageGroup { materialId: string; page: number; blocks: CanvasBlock[] }`
  - `groupByPage(blocks: CanvasBlock[]): PageGroup[]`
  - `unmappedSourceBlocks(page: SourcePage, blocks: CanvasBlock[]): SourceBlock[]`
  - `pickAnchorPage(rects: { page: number; top: number; bottom: number }[], viewportHeight: number): number | null`
  - `boxStyle(box: Box): { left: string; top: string; width: string; height: string }`
  - `markdownFor(block: SourceBlock): string`
  - `includeSourceBlock(doc: CanvasDoc, page: SourcePage, sourceBlockId: string): CanvasDoc`
  - `useCanvas(canvasId: string | undefined): CanvasResult`, where `CanvasResult = { state: LoadState; canvas: CanvasDoc | null; pages: SourcePage[]; material: StudioMaterial | null; spaceName: string | null }`
  - `useStudioHome(): { state: LoadState; recent: CanvasSummary[] }`

- [ ] **Step 1: Write failing geometry tests**

`src/features/spaces/studio/__tests__/geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  boxStyle, groupByPage, minConfidence, pickAnchorPage, regionFor, regionForBlock, unionBox, unmappedSourceBlocks,
} from '../geometry';
import type { CanvasBlock, SourcePage } from '../types';

const page = (n: number, geometry: 'block' | 'page' = 'block'): SourcePage => ({
  materialId: 'm', page: n, width: 720, height: 405, imageUrl: `/p${n}.webp`, geometry,
  blocks: geometry === 'page' ? [] : [
    { id: `p${n}-a`, page: n, bbox: [0.1, 0.1, 0.5, 0.2], kind: 'heading', text: 'A', readingOrder: 0 },
    { id: `p${n}-b`, page: n, bbox: [0.2, 0.3, 0.9, 0.4], kind: 'paragraph', text: 'B', readingOrder: 1, confidence: 0.6 },
    { id: `p${n}-c`, page: n, bbox: [0.1, 0.92, 0.3, 0.97], kind: 'paragraph', text: 'footer', readingOrder: 2 },
  ],
});
const pages = [page(1), page(2, 'page')];
const ex = (id: string, n: number, blockIds: string[]): CanvasBlock =>
  ({ id, origin: 'extracted', markdown: id, source: { materialId: 'm', page: n, blockIds }, edited: false });

describe('unionBox', () => {
  it('spans every box', () => {
    expect(unionBox([[0.1, 0.1, 0.5, 0.2], [0.2, 0.3, 0.9, 0.4]])).toEqual([0.1, 0.1, 0.9, 0.4]);
  });
  it('is null for nothing', () => expect(unionBox([])).toBeNull());
});

describe('regionFor', () => {
  it('outlines the referenced blocks', () => {
    expect(regionFor({ materialId: 'm', page: 1, blockIds: ['p1-a', 'p1-b'] }, pages))
      .toEqual({ page: pages[0], box: [0.1, 0.1, 0.9, 0.4] });
  });
  it('gives the whole page, unoutlined, without block ids or coordinates', () => {
    expect(regionFor({ materialId: 'm', page: 1, blockIds: [] }, pages)?.box).toBeNull();
    expect(regionFor({ materialId: 'm', page: 2, blockIds: [] }, pages)).toEqual({ page: pages[1], box: null });
  });
  it('is null for a page that does not exist', () => {
    expect(regionFor({ materialId: 'm', page: 9, blockIds: [] }, pages)).toBeNull();
  });
  it('finds a block by canvas id and refuses non-extracted ones', () => {
    const blocks: CanvasBlock[] = [ex('c1', 1, ['p1-a']), { id: 'w', origin: 'written', markdown: 'x' }];
    expect(regionForBlock(blocks, pages, 'c1')?.box).toEqual([0.1, 0.1, 0.5, 0.2]);
    expect(regionForBlock(blocks, pages, 'w')).toBeNull();
  });
});

describe('minConfidence', () => {
  it('is the lowest OCR confidence among referenced blocks', () => {
    expect(minConfidence({ materialId: 'm', page: 1, blockIds: ['p1-a', 'p1-b'] }, pages)).toBe(0.6);
    expect(minConfidence({ materialId: 'm', page: 1, blockIds: ['p1-a'] }, pages)).toBeUndefined();
  });
});

describe('groupByPage', () => {
  it('starts a group at each new page and keeps notes with the page above them', () => {
    const blocks: CanvasBlock[] = [
      { id: 'w0', origin: 'written', markdown: 'before' },
      ex('a', 1, []), { id: 'w1', origin: 'written', markdown: 'n' }, ex('b', 1, []), ex('c', 2, []),
    ];
    expect(groupByPage(blocks).map((g) => [g.page, g.blocks.map((b) => b.id)])).toEqual([
      [0, ['w0']], [1, ['a', 'w1', 'b']], [2, ['c']],
    ]);
  });
});

describe('unmappedSourceBlocks', () => {
  it('lists source blocks no clean block points at', () => {
    expect(unmappedSourceBlocks(pages[0], [ex('a', 1, ['p1-a', 'p1-b'])]).map((b) => b.id)).toEqual(['p1-c']);
  });
});

describe('pickAnchorPage', () => {
  it('picks the page with the most visible height', () => {
    expect(pickAnchorPage([
      { page: 1, top: -500, bottom: 100 }, { page: 2, top: 100, bottom: 900 }, { page: 3, top: 900, bottom: 1600 },
    ], 800)).toBe(2);
  });
  it('is null when nothing is on screen', () => {
    expect(pickAnchorPage([{ page: 1, top: 900, bottom: 1200 }], 800)).toBeNull();
  });
});

describe('boxStyle', () => {
  it('turns a box into percentages', () => {
    expect(boxStyle([0.1, 0.2, 0.5, 0.6])).toEqual({ left: '10%', top: '20%', width: '40%', height: '40%' });
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
npx vitest run src/features/spaces/studio/__tests__/geometry.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement geometry**

`src/features/spaces/studio/geometry.ts`:

```ts
import type { Box, CanvasBlock, SourceBlock, SourcePage, SourceRef } from './types';

/** Pure geometry for Peek and Morph. No DOM except `pickAnchorPage`'s input. */

export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

export interface Region {
  page: SourcePage;
  /** null = show the whole page without claiming a precise spot. */
  box: Box | null;
}

const findPage = (pages: SourcePage[], ref: SourceRef) =>
  pages.find((p) => p.materialId === ref.materialId && p.page === ref.page);

export function regionFor(ref: SourceRef, pages: SourcePage[]): Region | null {
  const page = findPage(pages, ref);
  if (!page) return null;
  if (page.geometry === 'page') return { page, box: null };
  const boxes = ref.blockIds
    .map((id) => page.blocks.find((b) => b.id === id)?.bbox)
    .filter((b): b is Box => !!b);
  return { page, box: unionBox(boxes) };
}

export function regionForBlock(blocks: CanvasBlock[], pages: SourcePage[], blockId: string): Region | null {
  const block = blocks.find((b) => b.id === blockId);
  return block?.origin === 'extracted' ? regionFor(block.source, pages) : null;
}

export function minConfidence(ref: SourceRef, pages: SourcePage[]): number | undefined {
  const page = findPage(pages, ref);
  const values = (page?.blocks ?? [])
    .filter((b) => ref.blockIds.includes(b.id) && b.confidence !== undefined)
    .map((b) => b.confidence as number);
  return values.length ? Math.min(...values) : undefined;
}

export interface PageGroup {
  materialId: string;
  /** 0 = blocks before the first page (notes written at the very top). */
  page: number;
  blocks: CanvasBlock[];
}

/** A note you wrote belongs to the page it sits under. */
export function groupByPage(blocks: CanvasBlock[]): PageGroup[] {
  const groups: PageGroup[] = [];
  let current: PageGroup | null = null;
  for (const b of blocks) {
    if (b.origin === 'extracted' && (!current || current.page !== b.source.page || current.materialId !== b.source.materialId)) {
      current = { materialId: b.source.materialId, page: b.source.page, blocks: [] };
      groups.push(current);
    } else if (!current) {
      current = { materialId: '', page: 0, blocks: [] };
      groups.push(current);
    }
    current.blocks.push(b);
  }
  return groups;
}

export function unmappedSourceBlocks(page: SourcePage, blocks: CanvasBlock[]): SourceBlock[] {
  const mapped = new Set(
    blocks.flatMap((b) =>
      b.origin === 'extracted' && b.source.page === page.page && b.source.materialId === page.materialId
        ? b.source.blockIds
        : [],
    ),
  );
  return page.blocks.filter((b) => !mapped.has(b.id));
}

export function pickAnchorPage(
  rects: { page: number; top: number; bottom: number }[],
  viewportHeight: number,
): number | null {
  let best: number | null = null;
  let bestVisible = 0;
  for (const r of rects) {
    const visible = Math.min(r.bottom, viewportHeight) - Math.max(r.top, 0);
    if (visible > bestVisible) {
      bestVisible = visible;
      best = r.page;
    }
  }
  return best;
}

export const boxStyle = (box: Box) => ({
  left: `${box[0] * 100}%`,
  top: `${box[1] * 100}%`,
  width: `${(box[2] - box[0]) * 100}%`,
  height: `${(box[3] - box[1]) * 100}%`,
});
```

- [ ] **Step 4: Run, expect pass**

```bash
npx vitest run src/features/spaces/studio/__tests__/geometry.test.ts
```

Expected: all pass.

- [ ] **Step 5: Write failing edit tests**

`src/features/spaces/studio/__tests__/edit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { includeSourceBlock, markdownFor } from '../edit';
import type { CanvasDoc, SourcePage } from '../types';

const page: SourcePage = {
  materialId: 'm', page: 1, width: 720, height: 405, imageUrl: '', geometry: 'block',
  blocks: [
    { id: 'a', page: 1, bbox: [0, 0, 1, 0.1], kind: 'heading', text: 'Title', readingOrder: 0 },
    { id: 'b', page: 1, bbox: [0, 0.2, 1, 0.3], kind: 'list', text: '• one\n• two', readingOrder: 1 },
    { id: 'c', page: 1, bbox: [0, 0.4, 1, 0.5], kind: 'paragraph', text: 'Body', readingOrder: 2 },
  ],
};
const doc: CanvasDoc = {
  id: 'd', materialIds: ['m'], spaceId: null, revision: 3, updatedAt: '',
  blocks: [
    { id: 'c-a', origin: 'extracted', markdown: '### Title', source: { materialId: 'm', page: 1, blockIds: ['a'] }, edited: false },
    { id: 'c-c', origin: 'extracted', markdown: 'Body', source: { materialId: 'm', page: 1, blockIds: ['c'] }, edited: false },
  ],
};

describe('markdownFor', () => {
  it('renders headings, lists and paragraphs', () => {
    expect(markdownFor(page.blocks[0])).toBe('### Title');
    expect(markdownFor(page.blocks[1])).toBe('- one\n- two');
    expect(markdownFor(page.blocks[2])).toBe('Body');
  });
});

describe('includeSourceBlock', () => {
  it('puts the block back in reading order and bumps the revision', () => {
    const next = includeSourceBlock(doc, page, 'b');
    expect(next.blocks.map((b) => b.id)).toEqual(['c-a', 'c-b', 'c-c']);
    expect(next.revision).toBe(4);
    expect(doc.blocks).toHaveLength(2); // not mutated
  });
  it('is a no-op for a block that is already included or unknown', () => {
    expect(includeSourceBlock(doc, page, 'a')).toBe(doc);
    expect(includeSourceBlock(doc, page, 'zzz')).toBe(doc);
  });
});
```

- [ ] **Step 6: Run, expect failure; then implement**

```bash
npx vitest run src/features/spaces/studio/__tests__/edit.test.ts
```

Expected: FAIL, module not found.

`src/features/spaces/studio/edit.ts`:

```ts
import type { CanvasDoc, ExtractedBlock, SourceBlock, SourcePage } from './types';

/** Pure edits on a CanvasDoc. Each returns a new doc with `revision + 1`, or the same doc if nothing changed. */

export function markdownFor(block: SourceBlock): string {
  const lines = block.text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (block.kind === 'heading') return `### ${lines.join(' ')}`;
  if (block.kind === 'list') return lines.map((l) => `- ${l.replace(/^•\s*/, '')}`).join('\n');
  return lines.join(' ');
}

/** "Add to your version" from Morph's diff reveal. */
export function includeSourceBlock(doc: CanvasDoc, page: SourcePage, sourceBlockId: string): CanvasDoc {
  const target = page.blocks.find((b) => b.id === sourceBlockId);
  if (!target) return doc;
  const onPage = (b: CanvasDoc['blocks'][number]): b is ExtractedBlock =>
    b.origin === 'extracted' && b.source.materialId === page.materialId && b.source.page === page.page;
  if (doc.blocks.some((b) => onPage(b) && b.source.blockIds.includes(sourceBlockId))) return doc;

  const order = (b: ExtractedBlock) =>
    Math.min(...b.source.blockIds.map((id) => page.blocks.find((s) => s.id === id)?.readingOrder ?? Infinity));
  let insertAt = -1;
  doc.blocks.forEach((b, i) => {
    if (onPage(b) && order(b) < target.readingOrder) insertAt = i;
  });
  if (insertAt === -1) {
    const first = doc.blocks.findIndex(onPage);
    insertAt = first === -1 ? doc.blocks.length - 1 : first - 1;
  }
  const block: ExtractedBlock = {
    id: `c-${sourceBlockId}`,
    origin: 'extracted',
    markdown: markdownFor(target),
    source: { materialId: page.materialId, page: page.page, blockIds: [sourceBlockId] },
    edited: false,
  };
  const blocks = [...doc.blocks];
  blocks.splice(insertAt + 1, 0, block);
  return { ...doc, blocks, revision: doc.revision + 1 };
}
```

Run again. Expected: PASS.

- [ ] **Step 7: Write the failing hook test**

`src/features/spaces/studio/__tests__/useCanvas.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCanvas, useStudioHome } from '../../data/useSpaces';

describe('useCanvas', () => {
  it('settles to the canvas, its pages, material and Space', async () => {
    const { result } = renderHook(() => useCanvas('c-norm'));
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.canvas?.id).toBe('c-norm');
    expect(result.current.pages.length).toBe(12);
    expect(result.current.material?.filename).toBe('Normalization.pdf');
    expect(result.current.spaceName).toBe('Database Systems');
  });

  it('reports an unknown canvas as empty, not as an error', async () => {
    const { result } = renderHook(() => useCanvas('nope'));
    await waitFor(() => expect(result.current.state).toBe('empty'));
    expect(result.current.canvas).toBeNull();
  });
});

describe('useStudioHome', () => {
  it('lists recent canvases', async () => {
    const { result } = renderHook(() => useStudioHome());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.recent.map((r) => r.id)).toEqual(['c-norm']);
  });
});
```

Run it. Expected: FAIL, `useCanvas` is not exported.

- [ ] **Step 8: Add the hooks to the seam**

In `src/features/spaces/data/useSpaces.ts`, add to the imports at the top:

```ts
import { canvasById, materialById, pagesFor, recentCanvases } from '../mocks/studio-canvas';
import type { CanvasSummary } from '../mocks/studio-canvas';
import type { CanvasDoc, SourcePage, StudioMaterial } from '../studio/types';
```

Append at the end of the file:

```ts
/* ── Studio canvas ────────────────────────────────────────────────────── */

export interface CanvasResult {
  state: LoadState;
  canvas: CanvasDoc | null;
  pages: SourcePage[];
  material: StudioMaterial | null;
  spaceName: string | null;
}

/** One Studio canvas and the source pages behind it. Unknown id → `empty`, like `useSpace`. */
export function useCanvas(canvasId: string | undefined): CanvasResult {
  const state = useSettled(useScenario());
  const canvas = canvasId ? canvasById(canvasId) ?? null : null;
  if (state !== 'ready' || !canvas) {
    return {
      state: !canvas && state === 'ready' ? 'empty' : state,
      canvas: null,
      pages: [],
      material: null,
      spaceName: null,
    };
  }
  return {
    state,
    canvas,
    pages: pagesFor(canvas.materialIds),
    material: materialById(canvas.materialIds[0]) ?? null,
    spaceName: canvas.spaceId ? spaceById(canvas.spaceId)?.name ?? null : null,
  };
}

export interface StudioHomeResult {
  state: LoadState;
  recent: CanvasSummary[];
}

export function useStudioHome(): StudioHomeResult {
  const state = useSettled(useScenario());
  return { state, recent: state === 'ready' ? recentCanvases() : [] };
}
```

`spaceById` is already imported in this file.

- [ ] **Step 9: Gates and commit**

```bash
npx vitest run src/features/spaces/studio src/features/spaces/mocks/__tests__/studio-canvas.test.ts
npx tsc -p tsconfig.app.json --noEmit && node scripts/check-vocabulary.mjs
git add src/features/spaces/studio src/features/spaces/data/useSpaces.ts
git commit -m "feat(studio): geometry, re-include edit, and the useCanvas seam

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Light surface, theme toggle, Markdown renderer

**Files:**
- Create: `src/features/spaces/studio/studio-surface.css`, `src/features/spaces/studio/useStudioTheme.ts`, `src/features/spaces/studio/components/Markdown.tsx`
- Modify: `package.json` / `package-lock.json` (streamdown), `tailwind.config.ts:7`
- Test: `src/features/spaces/studio/__tests__/useStudioTheme.test.ts`, `src/features/spaces/studio/__tests__/Markdown.test.tsx`

**Interfaces:**
- Produces:
  - `type StudioTheme = 'light' | 'dark'`
  - `THEME_KEY = 'learnstation:studio-theme'`
  - `useStudioTheme(): [StudioTheme, () => void]`
  - `<Markdown className?>{markdown}</Markdown>`
  - **CSS:**
    - class `.studio-surface` (with `data-theme="light"|"dark"`)
    - custom properties `--studio-paper`, `--studio-mark` (HSL triplets)
    - class `.studio-prose`

- [ ] **Step 1: Install Streamdown and point Tailwind at it**

```bash
npm install streamdown@2.7.0 --save-exact
```

In `tailwind.config.ts` line 7, extend `content`:

```ts
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}", "./node_modules/streamdown/dist/*.js"],
```

- [ ] **Step 2: Write failing tests**

`src/features/spaces/studio/__tests__/useStudioTheme.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { THEME_KEY, useStudioTheme } from '../useStudioTheme';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('useStudioTheme', () => {
  it('is light by default and remembers a toggle', () => {
    const { result } = renderHook(() => useStudioTheme());
    expect(result.current[0]).toBe('light');
    act(() => result.current[1]());
    expect(result.current[0]).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useStudioTheme());
    expect(result.current[0]).toBe('light');
    act(() => result.current[1]());
    expect(result.current[0]).toBe('dark');
  });
});
```

`src/features/spaces/studio/__tests__/Markdown.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from '../components/Markdown';

describe('Markdown', () => {
  it('renders headings and lists', () => {
    render(<Markdown>{'### Functional dependencies\n\n- one\n- two'}</Markdown>);
    expect(screen.getByRole('heading', { name: 'Functional dependencies' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('does not render raw HTML from Material text', () => {
    const { container } = render(<Markdown>{'<img src=x onerror="alert(1)">hello'}</Markdown>);
    expect(container.querySelector('img[onerror]')).toBeNull();
  });
});
```

Run both. Expected: FAIL, modules not found.

If the Markdown test then fails with an ESM/`require` error from `streamdown` or one of its dependencies, add it to `vitest.config.ts`:

```ts
      deps: {
        inline: ["@exodus/bytes", "streamdown"],
      },
```

- [ ] **Step 3: Implement**

`src/features/spaces/studio/useStudioTheme.ts`:

```ts
import { useCallback, useState } from 'react';

export type StudioTheme = 'light' | 'dark';
export const THEME_KEY = 'learnstation:studio-theme';

/** Light by default (spec §3.3). A per-viewer convenience: storage may be blocked, and that is fine. */
export function useStudioTheme(): [StudioTheme, () => void] {
  const [theme, setTheme] = useState<StudioTheme>(() => {
    try {
      return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: StudioTheme = t === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* not remembered — still switched */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}
```

`src/features/spaces/studio/components/Markdown.tsx`:

```tsx
import { memo } from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '@/lib/utils';

/**
 * The one renderer (spec §3.4). The clean page, AI answers and created items
 * all go through it, so the Material and the assistant read as one surface.
 * Streamdown sanitises and hardens by default; nothing here turns that off.
 */
export const Markdown = memo(function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return <Streamdown className={cn('studio-prose', className)}>{children}</Streamdown>;
});
```

`src/features/spaces/studio/studio-surface.css`:

```css
/*
 * Studio is light by default (spec §3.3). v4 defines only dark tokens on
 * :root, so this scope redefines the shadcn HSL tokens: anything written with
 * bg-background / text-foreground / border-border / bg-card flips for free.
 * Dark Studio simply doesn't override, and inherits the v4 values.
 */
.studio-surface:not([data-theme='dark']) {
  --background: 60 14% 97%;
  --foreground: 160 12% 14%;
  --card: 0 0% 100%;
  --card-foreground: 160 12% 14%;
  --popover: 0 0% 100%;
  --popover-foreground: 160 12% 14%;
  --muted: 60 9% 93%;
  --muted-foreground: 150 5% 38%;
  --border: 80 10% 86%;
  --input: 80 10% 86%;
  --primary: 235 62% 52%;
  --primary-foreground: 0 0% 100%;
  --ring: 235 62% 52%;
  color-scheme: light;
}

.studio-surface {
  /* Original pages always sit on paper, in both themes. */
  --studio-paper: 45 43% 98%;
  /* The amber of outlines, highlights and the flash. */
  --studio-mark: 36 90% 52%;
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
}

.studio-prose {
  font-size: 17px;
  line-height: 1.7;
}

.studio-prose > :first-child {
  margin-top: 0;
}

.studio-prose > :last-child {
  margin-bottom: 0;
}
```

- [ ] **Step 4: Run the tests, then the gates, then commit**

```bash
npx vitest run src/features/spaces/studio/__tests__/useStudioTheme.test.ts src/features/spaces/studio/__tests__/Markdown.test.tsx
npx tsc -p tsconfig.app.json --noEmit && node scripts/check-vocabulary.mjs
git add package.json package-lock.json tailwind.config.ts vitest.config.ts src/features/spaces/studio
git commit -m "feat(studio): light surface tokens, theme toggle, Streamdown renderer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: tests pass. (`vitest.config.ts` is only in the commit if you had to change it.)

---

### Task 5: Read-only canvas, Studio home, routes

**Files:**
- Create: `src/features/spaces/studio/motion.ts`, `src/features/spaces/studio/components/PageDivider.tsx`, `src/features/spaces/studio/components/CleanBlock.tsx`, `src/features/spaces/studio/components/CanvasPage.tsx`, `src/features/spaces/screens/StudioHomeScreen.tsx`, `src/features/spaces/screens/StudioCanvasScreen.tsx`
- Modify: `src/App.tsx` (lazy imports near line 107, routes before `/v4/library/:view`)
- Test: `src/features/spaces/studio/__tests__/screens.test.tsx`

**Interfaces:**
- Consumes: `useCanvas`, `useStudioHome`, `groupByPage`, `minConfidence`, `Markdown`, `useStudioTheme`.
- Produces:
  - **`motion.ts`:** `FLIGHT_EASE`, `FLIGHT_S = 0.6`, `STAGGER_S = 0.045`, `GLIDE_S = 0.25`, `FLASH_FRAMES`
  - **`CleanBlock` props:** `{ block: CanvasBlock; page: number; lowConfidence: boolean; active: boolean; flash: boolean; markerDisabled: boolean; onPointerEnter(blockId: string, pointerType: string): void; onPointerLeave(): void; onOpenPeek(blockId: string): void; onClosePeek(): void }`
  - **`CanvasPage` props (T5):** `{ groups: PageGroup[]; pages: SourcePage[]; activeBlockId: string | null; flashBlockId: string | null; sourceRemoved: boolean; onBlockPointerEnter; onBlockPointerLeave; onOpenPeek; onClosePeek }`
  - **DOM contract:**
    - each clean page section has `data-view="clean"` and `data-page-anchor={page}`
    - each block has `data-block-id` and `data-extracted="true"|"false"`
  - **Routes:**
    - `/v4/library/studio` → `StudioHomeScreen`
    - `/v4/library/studio/c/:canvasId` → `StudioCanvasScreen`

- [ ] **Step 1: Write the failing screen tests**

`src/features/spaces/studio/__tests__/screens.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudioHomeScreen from '../../screens/StudioHomeScreen';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/library/studio" element={<StudioHomeScreen />} />
        <Route path="/v4/library/studio/c/:canvasId" element={<StudioCanvasScreen />} />
      </Routes>
    </MemoryRouter>,
  );

describe('Studio home', () => {
  it('offers to open a Material and to continue recent work', async () => {
    at('/v4/library/studio');
    expect(await screen.findByRole('heading', { name: 'Studio' }, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByLabelText(/open material/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Normalization\.pdf/ })).toHaveAttribute('href', '/v4/library/studio/c/c-norm');
    expect(screen.getByRole('link', { name: 'Manage uploads' })).toHaveAttribute('href', '/v4/library/uploads');
  });
});

describe('Studio canvas', () => {
  it('shows the clean version page by page, with markers only on extracted blocks', async () => {
    const { container } = at('/v4/library/studio/c/c-norm');
    expect(await screen.findByRole('heading', { name: 'Normalization.pdf' }, { timeout: 2000 })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-view="clean"][data-page-anchor]').length).toBeGreaterThanOrEqual(10);
    expect(screen.getAllByRole('button', { name: /Show the original, page 2/ }).length).toBeGreaterThan(0);
    const written = container.querySelector('[data-block-id="w-1"]')!;
    expect(written.querySelector('button')).toBeNull();
  });

  it('underlines low-confidence OCR text', async () => {
    const { container } = at('/v4/library/studio/c/c-norm');
    await screen.findByRole('heading', { name: 'Normalization.pdf' }, { timeout: 2000 });
    expect(container.querySelector('[data-block-id="c-p2-hw"] .decoration-dotted')).not.toBeNull();
  });

  it('says so when the canvas does not exist', async () => {
    at('/v4/library/studio/c/nope');
    expect(await screen.findByText(/That Material isn’t here/, undefined, { timeout: 2000 })).toBeInTheDocument();
  });
});
```

Run it. Expected: FAIL, screens not found.

- [ ] **Step 2: Shared motion constants**

`src/features/spaces/studio/motion.ts`:

```ts
/** Studio's motion vocabulary (spec §4). One place, so Peek, Morph and the flash agree. */
export const FLIGHT_EASE = [0.2, 0.8, 0.2, 1] as const;
export const FLIGHT_S = 0.6;
export const STAGGER_S = 0.045;
export const GLIDE_S = 0.25;
export const TEXT_FADE_S = 0.24;
/** Amber in rgba because Motion cannot interpolate `var()`. Matches --studio-mark. */
export const FLASH_FRAMES = ['rgba(239,159,39,0.28)', 'rgba(239,159,39,0.28)', 'rgba(239,159,39,0)'];
```

- [ ] **Step 3: The clean block**

`src/features/spaces/studio/components/CleanBlock.tsx`:

```tsx
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { Markdown } from './Markdown';
import { FLASH_FRAMES } from '../motion';
import type { CanvasBlock } from '../types';

interface Props {
  block: CanvasBlock;
  page: number;
  lowConfidence: boolean;
  active: boolean;
  flash: boolean;
  /** The source file was removed: the marker stays as text, it leads nowhere. */
  markerDisabled: boolean;
  onPointerEnter(blockId: string, pointerType: string): void;
  onPointerLeave(): void;
  onOpenPeek(blockId: string): void;
  onClosePeek(): void;
}

/**
 * One block of your version.
 *
 * Only an `extracted` block has a place on the original, so only it gets a
 * page marker, a hover-intent and Space-to-peek. The marker is a real button
 * — the touch and keyboard way in — and on hover-capable screens it shows on
 * hover or focus to keep the margin quiet.
 */
export function CleanBlock({
  block, page, lowConfidence, active, flash, markerDisabled,
  onPointerEnter, onPointerLeave, onOpenPeek, onClosePeek,
}: Props) {
  const extracted = block.origin === 'extracted';
  return (
    <motion.div
      data-block-id={block.id}
      data-extracted={extracted ? 'true' : 'false'}
      tabIndex={extracted ? 0 : undefined}
      onPointerEnter={(e) => extracted && onPointerEnter(block.id, e.pointerType)}
      onPointerLeave={() => extracted && onPointerLeave()}
      onKeyDown={(e) => {
        if (!extracted) return;
        if (e.key === ' ') {
          e.preventDefault();
          onOpenPeek(block.id);
        } else if (e.key === 'Escape') {
          onClosePeek();
        }
      }}
      animate={flash ? { backgroundColor: FLASH_FRAMES } : undefined}
      transition={{ backgroundColor: { duration: 1.2, times: [0, 0.6, 1] } }}
      className={cn(
        'group relative -mx-3 rounded-lg px-3 py-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        active && 'bg-[hsl(var(--studio-mark)/0.14)]',
        block.origin === 'written' && 'border-l-2 border-primary/40',
      )}
    >
      {extracted &&
        (markerDisabled ? (
          <span className="absolute -left-14 top-1.5 w-11 text-right text-[11px] tabular-nums text-muted-foreground">
            p.{page}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onOpenPeek(block.id)}
            aria-label={`Show the original, page ${page}`}
            className="absolute -left-14 top-1 min-h-6 w-11 rounded-full border border-border bg-card text-[11px] tabular-nums text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
          >
            p.{page}
          </button>
        ))}
      <Markdown
        className={cn(lowConfidence && 'underline decoration-dotted decoration-muted-foreground underline-offset-4')}
      >
        {block.markdown}
      </Markdown>
    </motion.div>
  );
}
```

- [ ] **Step 4: The page column (read-only)**

`src/features/spaces/studio/components/PageDivider.tsx` (its own file, because `CanvasPage` and `OriginalPage` both use it and import each other otherwise):

```tsx
/** "page 12" above each page; page 0 (notes above the first page) has none. */
export function PageDivider({ page, original }: { page: number; original?: boolean }) {
  if (page === 0) return null;
  return (
    <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
      page {page}
      {original ? ' · original' : ''}
    </p>
  );
}
```

Then the column:

`src/features/spaces/studio/components/CanvasPage.tsx`:

```tsx
import { CleanBlock } from './CleanBlock';
import { PageDivider } from './PageDivider';
import { minConfidence } from '../geometry';
import type { PageGroup } from '../geometry';
import type { SourcePage } from '../types';

interface Props {
  groups: PageGroup[];
  pages: SourcePage[];
  activeBlockId: string | null;
  flashBlockId: string | null;
  sourceRemoved: boolean;
  onBlockPointerEnter(blockId: string, pointerType: string): void;
  onBlockPointerLeave(): void;
  onOpenPeek(blockId: string): void;
  onClosePeek(): void;
}

/** Your version, one section per page of the Material. */
export function CanvasPage(p: Props) {
  return (
    <div className="space-y-12">
      {p.groups.map((g) => (
        <section
          key={`${g.materialId}-${g.page}`}
          data-view="clean"
          data-page-anchor={g.page}
          aria-label={g.page ? `Page ${g.page}` : 'Your notes'}
        >
          <PageDivider page={g.page} />
          <div className="space-y-2">
            {g.blocks.map((b) => (
              <CleanBlock
                key={b.id}
                block={b}
                page={g.page}
                lowConfidence={b.origin === 'extracted' && (minConfidence(b.source, p.pages) ?? 1) < 0.8}
                active={p.activeBlockId === b.id}
                flash={p.flashBlockId === b.id}
                markerDisabled={p.sourceRemoved}
                onPointerEnter={p.onBlockPointerEnter}
                onPointerLeave={p.onBlockPointerLeave}
                onOpenPeek={p.onOpenPeek}
                onClosePeek={p.onClosePeek}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: The canvas screen (read-only version)**

`src/features/spaces/screens/StudioCanvasScreen.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Moon, Sun } from 'lucide-react';
import { ListSkeleton, NotFound, SpacesError } from '../components/states';
import { useCanvas } from '../data/useSpaces';
import { CanvasPage } from '../studio/components/CanvasPage';
import { groupByPage } from '../studio/geometry';
import { useStudioTheme } from '../studio/useStudioTheme';
import type { CanvasDoc } from '../studio/types';
import '../studio/studio-surface.css';

/** The Studio canvas — spec §3.2. The Material owns the screen. */
export default function StudioCanvasScreen() {
  const { canvasId } = useParams<{ canvasId: string }>();
  const { state, canvas, pages, material, spaceName } = useCanvas(canvasId);
  const [theme, toggleTheme] = useStudioTheme();
  /** Your edits this session, over the loaded canvas. */
  const [edited] = useState<CanvasDoc | null>(null);
  const doc = edited ?? canvas;
  const groups = useMemo(() => (doc ? groupByPage(doc.blocks) : []), [doc]);

  const frame = (children: React.ReactNode) => (
    <div className="studio-surface min-h-screen" data-theme={theme}>
      <div className="mx-auto max-w-3xl p-8">{children}</div>
    </div>
  );
  if (state === 'loading') return frame(<ListSkeleton />);
  if (state === 'error') return frame(<SpacesError what="this Material" />);
  if (!doc || !material)
    return frame(<NotFound what="Material" backTo="/v4/library/studio" backLabel="Back to Studio" />);

  return (
    <div className="studio-surface min-h-screen" data-theme={theme}>
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[90rem] items-center gap-3 px-4 py-3 md:px-6">
          <Link
            to="/v4/library/studio"
            aria-label="Back to Studio"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft aria-hidden className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{material.filename}</h1>
            <p className="truncate text-xs text-muted-foreground">{spaceName}</p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {theme === 'dark' ? <Sun aria-hidden className="h-4 w-4" /> : <Moon aria-hidden className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[90rem] gap-6 px-4 md:px-6 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,46rem)_minmax(18rem,1fr)]">
        <div className="hidden min-[1200px]:block" />
        <main className="min-w-0 py-10 pl-14 md:pl-16">
          <CanvasPage
            groups={groups}
            pages={pages}
            activeBlockId={null}
            flashBlockId={null}
            sourceRemoved={material.sourceRemoved}
            onBlockPointerEnter={() => {}}
            onBlockPointerLeave={() => {}}
            onOpenPeek={() => {}}
            onClosePeek={() => {}}
          />
        </main>
        <div className="hidden min-[1200px]:block" />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Studio home**

`src/features/spaces/screens/StudioHomeScreen.tsx`:

```tsx
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, FileText, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ListSkeleton, SpacesError } from '../components/states';
import { useStudioHome } from '../data/useSpaces';
import { STUDIO_CANVAS } from '../mocks/studio-canvas';
import { useStudioTheme } from '../studio/useStudioTheme';
import '../studio/studio-surface.css';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Studio's front door — spec §3.1. Calm, one primary action. */
export default function StudioHomeScreen() {
  const { state, recent } = useStudioHome();
  const [theme] = useStudioTheme();
  const navigate = useNavigate();

  /* Mock: any chosen file opens the sample canvas, and says so. */
  const open = () => {
    toast('Opened with sample pages', { description: 'Real import arrives with the file pipeline.' });
    navigate(`/v4/library/studio/c/${STUDIO_CANVAS.id}`);
  };

  return (
    <div className="studio-surface min-h-screen" data-theme={theme}>
      <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
        <Link
          to="/v4/library"
          className="mb-6 inline-flex min-h-6 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="h-4 w-4" /> Library
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Studio</h1>
        <p className="mt-2 max-w-[56ch] text-muted-foreground">
          Open a Material to read it clean, check it against the original, and make study material from it.
        </p>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) open();
          }}
          className="mt-8 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center hover:border-primary/50"
        >
          <Upload aria-hidden className="h-6 w-6 text-muted-foreground" />
          <span className="font-medium">Open Material</span>
          <span className="text-sm text-muted-foreground">PDF, PPTX or a photo — drop it here or choose a file</span>
          <input
            type="file"
            accept=".pdf,.pptx,image/*"
            aria-label="Open Material"
            className="sr-only"
            onChange={(e) => e.target.files?.length && open()}
          />
        </label>

        <h2 className="mt-12 text-sm font-semibold">Continue where you left off</h2>
        <div className="mt-3">
          {state === 'loading' ? (
            <ListSkeleton />
          ) : state === 'error' ? (
            <SpacesError what="your recent work" />
          ) : recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Materials you open show up here.</p>
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/v4/library/studio/c/${r.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted"
                  >
                    <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {[r.spaceName, formatDate(r.updatedAt)].filter(Boolean).join(' · ')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <nav aria-label="Manage your work" className="mt-12 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <Link to="/v4/library/uploads" className="hover:text-foreground">Manage uploads</Link>
          <Link to="/v4/library/drafts" className="hover:text-foreground">Your drafts</Link>
          <Link to="/v4/library/impact" className="hover:text-foreground">How your work landed</Link>
        </nav>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Routes**

In `src/App.tsx`, next to `const V4LibraryStudio = lazy(...)` (around line 107), add:

```tsx
const V4StudioHome = lazy(() => import("./features/spaces/screens/StudioHomeScreen"));
const V4StudioCanvas = lazy(() => import("./features/spaces/screens/StudioCanvasScreen"));
```

Directly above `<Route path="/v4/library/:view" element={<V4LibraryStudio />} />`, add:

```tsx
            {/* The Studio canvas (spec 2026-10-10). Declared before :view so "studio" is not read as a list view. */}
            <Route path="/v4/library/studio" element={<V4StudioHome />} />
            <Route path="/v4/library/studio/c/:canvasId" element={<V4StudioCanvas />} />
```

- [ ] **Step 8: Run tests and gates**

```bash
npx vitest run src/features/spaces/studio/__tests__/screens.test.tsx
npx tsc -p tsconfig.app.json --noEmit && node scripts/check-vocabulary.mjs && npx vitest run src/features/spaces
```

Expected: all pass. If the existing `components/__tests__/a11y.test.tsx` flags anything in the new files (icon labels, target sizes), fix the new file to the rule it states; don't edit the test.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/features/spaces/studio src/features/spaces/screens/StudioHomeScreen.tsx src/features/spaces/screens/StudioCanvasScreen.tsx
git commit -m "feat(studio): home and read-only canvas on real pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Peek state machine

**Files:**
- Create: `src/features/spaces/studio/usePeek.ts`
- Test: `src/features/spaces/studio/__tests__/usePeek.test.ts`

**Interfaces:**
- Produces:
  - `PEEK_INTENT_MS = 350`, `PEEK_GRACE_MS = 600`, `PEEK_FOLLOW_MS = 150`
  - `type PeekState = { status: 'closed' } | { status: 'open'; blockId: string; pinned: boolean }`
  - `usePeek(): PeekApi`, where `PeekApi = { state: PeekState; hoverBlock(blockId: string, pointerType: string): void; leaveBlock(): void; enterPeek(): void; leavePeek(): void; open(blockId: string): void; close(): void; togglePin(): void; follow(blockId: string): void }`
  - **All methods are referentially stable** (safe as effect dependencies).

- [ ] **Step 1: Write failing tests**

`src/features/spaces/studio/__tests__/usePeek.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { PEEK_FOLLOW_MS, PEEK_GRACE_MS, PEEK_INTENT_MS, usePeek } from '../usePeek';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = () => renderHook(() => usePeek());
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('usePeek', () => {
  it('opens after the pointer rests, not before', () => {
    const { result } = setup();
    act(() => result.current.hoverBlock('a', 'mouse'));
    tick(PEEK_INTENT_MS - 1);
    expect(result.current.state.status).toBe('closed');
    tick(1);
    expect(result.current.state).toEqual({ status: 'open', blockId: 'a', pinned: false });
  });

  it('ignores touch and pen hover', () => {
    const { result } = setup();
    act(() => result.current.hoverBlock('a', 'touch'));
    tick(PEEK_INTENT_MS * 2);
    expect(result.current.state.status).toBe('closed');
  });

  it('cancels when the pointer leaves before the delay', () => {
    const { result } = setup();
    act(() => result.current.hoverBlock('a', 'mouse'));
    tick(200);
    act(() => result.current.leaveBlock());
    tick(PEEK_INTENT_MS);
    expect(result.current.state.status).toBe('closed');
  });

  it('switches immediately once open', () => {
    const { result } = setup();
    act(() => result.current.open('a'));
    act(() => result.current.hoverBlock('b', 'mouse'));
    expect(result.current.state).toMatchObject({ blockId: 'b' });
  });

  it('stays open through the grace period and into the peek', () => {
    const { result } = setup();
    act(() => result.current.open('a'));
    act(() => result.current.leaveBlock());
    tick(PEEK_GRACE_MS - 1);
    act(() => result.current.enterPeek());
    tick(PEEK_GRACE_MS * 2);
    expect(result.current.state.status).toBe('open');
    act(() => result.current.leavePeek());
    tick(PEEK_GRACE_MS);
    expect(result.current.state.status).toBe('closed');
  });

  it('does not close a pinned peek on leave; close() does', () => {
    const { result } = setup();
    act(() => result.current.open('a'));
    act(() => result.current.togglePin());
    act(() => result.current.leaveBlock());
    tick(PEEK_GRACE_MS * 2);
    expect(result.current.state).toEqual({ status: 'open', blockId: 'a', pinned: true });
    act(() => result.current.close());
    expect(result.current.state.status).toBe('closed');
  });

  it('follows the reading line only when pinned, throttled', () => {
    const { result } = setup();
    act(() => result.current.open('a'));
    act(() => result.current.follow('b'));
    expect(result.current.state).toMatchObject({ blockId: 'a' });
    act(() => result.current.togglePin());
    tick(PEEK_FOLLOW_MS);
    act(() => result.current.follow('b'));
    expect(result.current.state).toMatchObject({ blockId: 'b' });
    act(() => result.current.follow('c'));
    expect(result.current.state).toMatchObject({ blockId: 'b' });
    tick(PEEK_FOLLOW_MS);
    act(() => result.current.follow('c'));
    expect(result.current.state).toMatchObject({ blockId: 'c' });
  });

  it('keeps its methods stable across renders', () => {
    const { result, rerender } = setup();
    const first = result.current.close;
    rerender();
    expect(result.current.close).toBe(first);
  });
});
```

Run it. Expected: FAIL, module not found.

- [ ] **Step 2: Implement**

`src/features/spaces/studio/usePeek.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Peek's state machine — spec §4.1.
 *
 *   closed ──hover(mouse) 350ms──▶ open ──leave 600ms──▶ closed
 *                  open ──togglePin──▶ open(pinned) ──close()──▶ closed
 *
 * Touch never hovers: it arrives through `open()` from the page marker.
 * Once open, hovering another block switches at once — the outline glides
 * rather than the peek closing and reopening.
 */

export const PEEK_INTENT_MS = 350;
export const PEEK_GRACE_MS = 600;
export const PEEK_FOLLOW_MS = 150;

export type PeekState = { status: 'closed' } | { status: 'open'; blockId: string; pinned: boolean };

export interface PeekApi {
  state: PeekState;
  hoverBlock(blockId: string, pointerType: string): void;
  leaveBlock(): void;
  enterPeek(): void;
  leavePeek(): void;
  open(blockId: string): void;
  close(): void;
  togglePin(): void;
  follow(blockId: string): void;
}

const CLOSED: PeekState = { status: 'closed' };

export function usePeek(): PeekApi {
  const [state, setState] = useState<PeekState>(CLOSED);
  const stateRef = useRef(state);
  stateRef.current = state;
  const intent = useRef<ReturnType<typeof setTimeout>>();
  const grace = useRef<ReturnType<typeof setTimeout>>();
  const lastFollow = useRef(0);

  const clearTimers = () => {
    clearTimeout(intent.current);
    clearTimeout(grace.current);
  };
  useEffect(() => clearTimers, []);

  const set = (next: PeekState) => {
    stateRef.current = next;
    setState(next);
  };

  const startGrace = useCallback(() => {
    const s = stateRef.current;
    if (s.status !== 'open' || s.pinned) return;
    clearTimeout(grace.current);
    grace.current = setTimeout(() => set(CLOSED), PEEK_GRACE_MS);
  }, []);

  const open = useCallback((blockId: string) => {
    clearTimers();
    const s = stateRef.current;
    set({ status: 'open', blockId, pinned: s.status === 'open' ? s.pinned : false });
  }, []);

  const hoverBlock = useCallback((blockId: string, pointerType: string) => {
    if (pointerType !== 'mouse') return;
    clearTimeout(grace.current);
    if (stateRef.current.status === 'open') {
      open(blockId);
      return;
    }
    clearTimeout(intent.current);
    intent.current = setTimeout(() => open(blockId), PEEK_INTENT_MS);
  }, [open]);

  const leaveBlock = useCallback(() => {
    clearTimeout(intent.current);
    startGrace();
  }, [startGrace]);

  const enterPeek = useCallback(() => clearTimeout(grace.current), []);
  const leavePeek = startGrace;

  const close = useCallback(() => {
    clearTimers();
    set(CLOSED);
  }, []);

  const togglePin = useCallback(() => {
    const s = stateRef.current;
    if (s.status !== 'open') return;
    clearTimeout(grace.current);
    lastFollow.current = Date.now();
    set({ ...s, pinned: !s.pinned });
  }, []);

  const follow = useCallback((blockId: string) => {
    const s = stateRef.current;
    if (s.status !== 'open' || !s.pinned || s.blockId === blockId) return;
    const now = Date.now();
    if (now - lastFollow.current < PEEK_FOLLOW_MS) return;
    lastFollow.current = now;
    set({ ...s, blockId });
  }, []);

  return useMemo(
    () => ({ state, hoverBlock, leaveBlock, enterPeek, leavePeek, open, close, togglePin, follow }),
    [state, hoverBlock, leaveBlock, enterPeek, leavePeek, open, close, togglePin, follow],
  );
}
```

- [ ] **Step 3: Run, gates, commit**

```bash
npx vitest run src/features/spaces/studio/__tests__/usePeek.test.ts
npx tsc -p tsconfig.app.json --noEmit
git add src/features/spaces/studio/usePeek.ts src/features/spaces/studio/__tests__/usePeek.test.ts
git commit -m "feat(studio): Peek state machine — intent, grace, pin, follow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 8 passed.

---

### Task 7: Peek on screen

**Files:**
- Create: `src/features/spaces/studio/useWide.ts`, `src/features/spaces/studio/useReadingLine.ts`, `src/features/spaces/studio/components/Peek.tsx`, `src/features/spaces/studio/components/FullPageDialog.tsx`
- Replace: `src/features/spaces/screens/StudioCanvasScreen.tsx`
- Test: `src/features/spaces/studio/__tests__/useReadingLine.test.ts`, `src/features/spaces/studio/__tests__/peek.test.tsx`

**Interfaces:**
- Consumes: `usePeek`, `regionForBlock`, `boxStyle`, `Region`, motion constants.
- Produces:
  - `useWide(query?: string): boolean` (default `'(min-width: 1200px)'`)
  - `READING_LINE = 0.4`
  - `useReadingLine(enabled: boolean, column: React.RefObject<HTMLElement>, onBlock: (blockId: string) => void): void`
  - `Peek` props: `{ region: Region; materialName: string; pinned: boolean; sourceRemoved: boolean; onTogglePin(): void; onFullPage(): void; onPointerEnter(): void; onPointerLeave(): void }`
  - `FullPageDialog` props: `{ open: boolean; onOpenChange(open: boolean): void; region: Region; materialName: string; theme: StudioTheme }`
  - The screen owns the peek, the full-page state and the page Esc handler.

- [ ] **Step 1: Write the failing tests**

`src/features/spaces/studio/__tests__/useReadingLine.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReadingLine } from '../useReadingLine';

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('useReadingLine', () => {
  it('reports the extracted block under the reading line on scroll, only when enabled', () => {
    document.body.innerHTML = '<main><div data-block-id="c-1" data-extracted="true"><p id="inner">x</p></div></main>';
    const inner = document.getElementById('inner')!;
    (document as unknown as { elementsFromPoint: unknown }).elementsFromPoint = vi.fn(() => [inner]);
    const column = { current: document.querySelector('main') as HTMLElement };
    const onBlock = vi.fn();
    const { rerender } = renderHook(({ on }) => useReadingLine(on, column, onBlock), { initialProps: { on: false } });
    window.dispatchEvent(new Event('scroll'));
    expect(onBlock).not.toHaveBeenCalled();
    rerender({ on: true });
    window.dispatchEvent(new Event('scroll'));
    expect(onBlock).toHaveBeenCalledWith('c-1');
  });
});
```

`src/features/spaces/studio/__tests__/peek.test.tsx`:

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

describe('Peek on the canvas', () => {
  it('opens on hover-rest with the page and an outline', async () => {
    const { container } = await mount();
    const block = container.querySelector('[data-block-id="c-p2-hw"]')!;
    fireEvent.pointerEnter(block, { pointerType: 'mouse' });
    await act(async () => { vi.advanceTimersByTime(350); });
    const peek = screen.getByRole('complementary', { name: 'Original page' });
    expect(peek).toHaveTextContent('Normalization.pdf · page 2');
    expect(screen.getByTestId('peek-outline')).toBeInTheDocument();
  });

  it('opens from the marker at once, and pins', async () => {
    await mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Show the original, page 2' })[0]);
    const pin = screen.getByRole('button', { name: 'Pin' });
    expect(pin).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(pin);
    expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the whole page without an outline when there are no coordinates', async () => {
    await mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Show the original, page 3' })[0]);
    expect(screen.getByRole('complementary', { name: 'Original page' })).toHaveTextContent('page 3');
    expect(screen.queryByTestId('peek-outline')).toBeNull();
  });

  it('closes on Escape', async () => {
    await mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Show the original, page 2' })[0]);
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.queryByRole('complementary', { name: 'Original page' })).toBeNull();
  });
});
```

Run both. Expected: FAIL.

Two happy-dom notes:
- If `pointerEnter` doesn't reach React's `onPointerEnter`, use `fireEvent.pointerOver(block, { pointerType: 'mouse' })`. React builds enter/leave from over/out.
- If the Escape test still finds the panel because Motion's exit animation never completes under fake timers, advance by 1000 ms instead of 300.

- [ ] **Step 2: Small hooks**

`src/features/spaces/studio/useWide.ts`:

```ts
import { useEffect, useState } from 'react';

/** True at or above the width where Peek gets the gutter instead of a bottom sheet. */
export function useWide(query = '(min-width: 1200px)'): boolean {
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, [query]);
  return wide;
}
```

`src/features/spaces/studio/useReadingLine.ts`:

```ts
import { useEffect } from 'react';

/** 40% from the top: where the eye reads, so a pinned Peek follows it (spec §4.1 rule 3). */
export const READING_LINE = 0.4;

export function useReadingLine(
  enabled: boolean,
  column: React.RefObject<HTMLElement>,
  onBlock: (blockId: string) => void,
): void {
  useEffect(() => {
    if (!enabled || typeof document.elementsFromPoint !== 'function') return;
    const check = () => {
      const r = column.current?.getBoundingClientRect();
      const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
      for (const el of document.elementsFromPoint(x, window.innerHeight * READING_LINE)) {
        const block = (el as HTMLElement).closest?.('[data-block-id][data-extracted="true"]') as HTMLElement | null;
        if (block?.dataset.blockId) {
          onBlock(block.dataset.blockId);
          return;
        }
      }
    };
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, [enabled, column, onBlock]);
}
```

- [ ] **Step 3: The Peek view**

`src/features/spaces/studio/components/Peek.tsx`:

```tsx
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Maximize2, Pin, PinOff, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { boxStyle } from '../geometry';
import type { Region } from '../geometry';
import { FLIGHT_EASE, GLIDE_S } from '../motion';

interface Props {
  region: Region;
  materialName: string;
  pinned: boolean;
  sourceRemoved: boolean;
  onTogglePin(): void;
  onFullPage(): void;
  onPointerEnter(): void;
  onPointerLeave(): void;
}

const action =
  'inline-flex min-h-6 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs hover:bg-muted';

/**
 * The original page, with the spot outlined — spec §4.1.
 *
 * The outline is animated, not re-mounted: moving to the next paragraph on
 * the same page glides it there. A different page crossfades the image.
 */
export function Peek({
  region, materialName, pinned, sourceRemoved, onTogglePin, onFullPage, onPointerEnter, onPointerLeave,
}: Props) {
  const { page, box } = region;
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const src = attempt ? `${page.imageUrl}?retry=${attempt}` : page.imageUrl;

  return (
    <motion.aside
      aria-label="Original page"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="rounded-2xl border border-border bg-card p-3 shadow-sm"
    >
      {sourceRemoved ? (
        <p className="p-3 text-sm text-muted-foreground">
          The original file was removed. Your clean version keeps working.
        </p>
      ) : failed === src ? (
        <div className="flex flex-col items-center gap-2 p-6 text-sm text-muted-foreground">
          Couldn’t load this page.
          <button type="button" className={action} onClick={() => setAttempt((a) => a + 1)}>
            <RotateCw aria-hidden className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      ) : (
        <div
          className="relative overflow-hidden rounded-lg border border-border bg-[hsl(var(--studio-paper))]"
          style={{ aspectRatio: `${page.width} / ${page.height}` }}
        >
          <AnimatePresence initial={false}>
            <motion.img
              key={src}
              src={src}
              alt={`Page ${page.page} of ${materialName}`}
              onError={() => setFailed(src)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 h-full w-full object-contain"
            />
          </AnimatePresence>
          {box && (
            <motion.div
              data-testid="peek-outline"
              aria-hidden
              initial={false}
              animate={boxStyle(box)}
              transition={{ duration: GLIDE_S, ease: FLIGHT_EASE }}
              className="absolute rounded-[4px] border-2 border-[hsl(var(--studio-mark))] bg-[hsl(var(--studio-mark)/0.18)]"
            />
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          Original · {materialName} · page {page.page}
        </span>
        <button type="button" aria-pressed={pinned} onClick={onTogglePin} className={cn(action, pinned && 'bg-muted')}>
          {pinned ? <PinOff aria-hidden className="h-3.5 w-3.5" /> : <Pin aria-hidden className="h-3.5 w-3.5" />}
          Pin
        </button>
        {!sourceRemoved && (
          <button type="button" onClick={onFullPage} className={action}>
            <Maximize2 aria-hidden className="h-3.5 w-3.5" /> Full page
          </button>
        )}
      </div>
    </motion.aside>
  );
}
```

- [ ] **Step 4: Full page dialog**

`src/features/spaces/studio/components/FullPageDialog.tsx`:

```tsx
import { useState } from 'react';
import { motion } from 'motion/react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { boxStyle } from '../geometry';
import type { Region } from '../geometry';
import { FLIGHT_EASE } from '../motion';
import type { StudioTheme } from '../useStudioTheme';

const ZOOMS = [1, 1.5, 2] as const;

/** The whole original page, opened with a page turn (spec §4.1 rule 7). Image-based in Plan 1. */
export function FullPageDialog({
  open, onOpenChange, region, materialName, theme,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  region: Region;
  materialName: string;
  theme: StudioTheme;
}) {
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const { page, box } = region;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="studio-surface max-w-5xl" data-theme={theme}>
        <DialogTitle className="text-sm font-semibold">
          {materialName} · page {page.page}
        </DialogTitle>
        <DialogDescription className="sr-only">The original page, with the selected spot outlined.</DialogDescription>
        <div className="flex gap-2" role="group" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              aria-pressed={zoom === z}
              onClick={() => setZoom(z)}
              className={cn('min-h-6 rounded-full border border-border px-3 text-xs', zoom === z && 'bg-muted')}
            >
              {z * 100}%
            </button>
          ))}
        </div>
        <div className="max-h-[75vh] overflow-auto rounded-lg border border-border">
          <motion.div
            initial={{ rotateY: 8, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            transition={{ duration: 0.3, ease: FLIGHT_EASE }}
            style={{ transformPerspective: 1200, width: `${zoom * 100}%` }}
          >
            <div
              className="relative bg-[hsl(var(--studio-paper))]"
              style={{ aspectRatio: `${page.width} / ${page.height}` }}
            >
              <img
                src={page.imageUrl}
                alt={`Page ${page.page} of ${materialName}`}
                className="absolute inset-0 h-full w-full object-contain"
              />
              {box && (
                <div
                  aria-hidden
                  style={boxStyle(box)}
                  className="absolute rounded-[4px] border-2 border-[hsl(var(--studio-mark))] bg-[hsl(var(--studio-mark)/0.18)]"
                />
              )}
            </div>
          </motion.div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Replace the screen with the Peek-enabled version**

`src/features/spaces/screens/StudioCanvasScreen.tsx` (whole file):

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { ChevronLeft, Moon, Sun } from 'lucide-react';
import { ListSkeleton, NotFound, SpacesError } from '../components/states';
import { useCanvas } from '../data/useSpaces';
import { CanvasPage } from '../studio/components/CanvasPage';
import { FullPageDialog } from '../studio/components/FullPageDialog';
import { Peek } from '../studio/components/Peek';
import { groupByPage, regionForBlock } from '../studio/geometry';
import { usePeek } from '../studio/usePeek';
import { useReadingLine } from '../studio/useReadingLine';
import { useStudioTheme } from '../studio/useStudioTheme';
import { useWide } from '../studio/useWide';
import type { CanvasDoc } from '../studio/types';
import '../studio/studio-surface.css';

/** The Studio canvas — spec §3.2. The Material owns the screen; Peek lives in the gutter. */
export default function StudioCanvasScreen() {
  const { canvasId } = useParams<{ canvasId: string }>();
  const { state, canvas, pages, material, spaceName } = useCanvas(canvasId);
  const [theme, toggleTheme] = useStudioTheme();
  const [edited] = useState<CanvasDoc | null>(null);
  const doc = edited ?? canvas;
  const groups = useMemo(() => (doc ? groupByPage(doc.blocks) : []), [doc]);

  const peek = usePeek();
  const wide = useWide();
  const column = useRef<HTMLElement>(null);
  const [fullPage, setFullPage] = useState(false);
  const peekOpen = peek.state.status === 'open';
  const pinned = peek.state.status === 'open' && peek.state.pinned;
  const region = doc && peek.state.status === 'open' ? regionForBlock(doc.blocks, pages, peek.state.blockId) : null;

  useReadingLine(pinned, column, peek.follow);
  useEffect(() => {
    if (!peekOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !fullPage) peek.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [peekOpen, fullPage, peek.close]);

  const frame = (children: React.ReactNode) => (
    <div className="studio-surface min-h-screen" data-theme={theme}>
      <div className="mx-auto max-w-3xl p-8">{children}</div>
    </div>
  );
  if (state === 'loading') return frame(<ListSkeleton />);
  if (state === 'error') return frame(<SpacesError what="this Material" />);
  if (!doc || !material)
    return frame(<NotFound what="Material" backTo="/v4/library/studio" backLabel="Back to Studio" />);

  const peekPanel = (
    <AnimatePresence>
      {region && peek.state.status === 'open' && (
        <Peek
          key="peek"
          region={region}
          materialName={material.filename}
          pinned={peek.state.pinned}
          sourceRemoved={material.sourceRemoved}
          onTogglePin={peek.togglePin}
          onFullPage={() => setFullPage(true)}
          onPointerEnter={peek.enterPeek}
          onPointerLeave={peek.leavePeek}
        />
      )}
    </AnimatePresence>
  );

  return (
    <div className="studio-surface min-h-screen" data-theme={theme}>
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[90rem] items-center gap-3 px-4 py-3 md:px-6">
          <Link
            to="/v4/library/studio"
            aria-label="Back to Studio"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft aria-hidden className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{material.filename}</h1>
            <p className="truncate text-xs text-muted-foreground">{spaceName}</p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {theme === 'dark' ? <Sun aria-hidden className="h-4 w-4" /> : <Moon aria-hidden className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[90rem] gap-6 px-4 md:px-6 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,46rem)_minmax(18rem,1fr)]">
        <div className="hidden min-[1200px]:block" />
        <main ref={column} className="min-w-0 py-10 pl-14 md:pl-16">
          <CanvasPage
            groups={groups}
            pages={pages}
            activeBlockId={peek.state.status === 'open' ? peek.state.blockId : null}
            flashBlockId={null}
            sourceRemoved={material.sourceRemoved}
            onBlockPointerEnter={peek.hoverBlock}
            onBlockPointerLeave={peek.leaveBlock}
            onOpenPeek={peek.open}
            onClosePeek={peek.close}
          />
        </main>
        <div className="hidden min-[1200px]:block">
          <div className="sticky top-24 py-10">{wide && peekPanel}</div>
        </div>
      </div>

      {!wide && <div className="fixed inset-x-3 bottom-3 z-30 max-h-[45vh] overflow-auto">{peekPanel}</div>}
      {region && (
        <FullPageDialog
          open={fullPage}
          onOpenChange={setFullPage}
          region={region}
          materialName={material.filename}
          theme={theme}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run tests and gates, then commit**

```bash
npx vitest run src/features/spaces/studio
npx tsc -p tsconfig.app.json --noEmit && node scripts/check-vocabulary.mjs && npx vitest run src/features/spaces
git add src/features/spaces/studio src/features/spaces/screens/StudioCanvasScreen.tsx
git commit -m "feat(studio): Peek — hover-rest, marker, pin that follows reading, full page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: all pass.

---

### Task 8: The Morph switch

**Files:**
- Create: `src/features/spaces/studio/useMorph.ts`, `src/features/spaces/studio/components/MorphSwitch.tsx`
- Test: `src/features/spaces/studio/__tests__/useMorph.test.ts`

**Interfaces:**
- Produces:
  - `type CanvasView = 'clean' | 'original'`
  - `MORPH_HOLD_MS = 250`
  - `VIEW_KEY = 'learnstation:studio-view'`
  - `useMorph(opts?: { onBeforeChange?: () => void }): MorphApi`, where `MorphApi = { view: CanvasView; shown: CanvasView; quickLook: boolean; setView(v: CanvasView): void; pressStart(): void; pressEnd(): void; pressCancel(): void }`
    - `view` is the committed choice; `shown` is what's on screen (differs during a quick look)
    - `onBeforeChange` runs synchronously before every change of `shown`
    - the hook installs the window `O`/`Escape` key handling itself
  - `MorphSwitch` props: `{ shown: CanvasView; onPressStart(): void; onPressEnd(): void; onPressCancel(): void; onToggle(): void }`

- [ ] **Step 1: Write failing tests**

`src/features/spaces/studio/__tests__/useMorph.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MORPH_HOLD_MS, VIEW_KEY, useMorph } from '../useMorph';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); document.body.innerHTML = ''; });

const key = (type: 'keydown' | 'keyup', k: string, target: EventTarget = window, extra: KeyboardEventInit = {}) =>
  act(() => { target.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, ...extra })); });

describe('useMorph', () => {
  it('a tap switches and stays, and is remembered', () => {
    const before = vi.fn();
    const { result } = renderHook(() => useMorph({ onBeforeChange: before }));
    act(() => result.current.pressStart());
    act(() => { vi.advanceTimersByTime(100); });
    act(() => result.current.pressEnd());
    expect(result.current.view).toBe('original');
    expect(result.current.shown).toBe('original');
    expect(before).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(VIEW_KEY)).toBe('original');
  });

  it('a hold is a quick look that springs back', () => {
    const { result } = renderHook(() => useMorph());
    act(() => result.current.pressStart());
    act(() => { vi.advanceTimersByTime(MORPH_HOLD_MS); });
    expect(result.current.shown).toBe('original');
    expect(result.current.quickLook).toBe(true);
    expect(result.current.view).toBe('clean');
    act(() => result.current.pressEnd());
    expect(result.current.shown).toBe('clean');
  });

  it('cancelling a press (pointer left) springs back without switching', () => {
    const { result } = renderHook(() => useMorph());
    act(() => result.current.pressStart());
    act(() => { vi.advanceTimersByTime(MORPH_HOLD_MS); });
    act(() => result.current.pressCancel());
    expect(result.current.shown).toBe('clean');
    act(() => result.current.pressStart());
    act(() => result.current.pressCancel());
    expect(result.current.view).toBe('clean');
  });

  it('O taps and holds like the switch, and Escape returns to clean', () => {
    const { result } = renderHook(() => useMorph());
    key('keydown', 'o');
    key('keyup', 'o');
    expect(result.current.view).toBe('original');
    key('keydown', 'Escape');
    expect(result.current.view).toBe('clean');
  });

  it('ignores O while typing, with modifiers, and on repeat', () => {
    const { result } = renderHook(() => useMorph());
    const input = document.createElement('input');
    document.body.appendChild(input);
    key('keydown', 'o', input);
    key('keyup', 'o', input);
    key('keydown', 'o', window, { metaKey: true });
    key('keyup', 'o', window, { metaKey: true });
    expect(result.current.view).toBe('clean');
  });

  it('restores the remembered view and survives blocked storage', () => {
    localStorage.setItem(VIEW_KEY, 'original');
    expect(renderHook(() => useMorph()).result.current.view).toBe('original');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useMorph());
    expect(result.current.view).toBe('clean');
    act(() => result.current.setView('original'));
    expect(result.current.view).toBe('original');
  });
});
```

Run it. Expected: FAIL, module not found.

- [ ] **Step 2: Implement the hook**

`src/features/spaces/studio/useMorph.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * The Clean | Original switch — spec §4.2. One control, two gestures:
 *   tap (< 250ms)  → switch and stay
 *   hold (≥ 250ms) → quick look; springs back on release
 * The `O` key behaves exactly like the switch. `Escape` returns to clean.
 */

export type CanvasView = 'clean' | 'original';
export const MORPH_HOLD_MS = 250;
export const VIEW_KEY = 'learnstation:studio-view';

export interface MorphApi {
  view: CanvasView;
  shown: CanvasView;
  quickLook: boolean;
  setView(v: CanvasView): void;
  pressStart(): void;
  pressEnd(): void;
  pressCancel(): void;
}

const other = (v: CanvasView): CanvasView => (v === 'clean' ? 'original' : 'clean');

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function useMorph(opts: { onBeforeChange?: () => void } = {}): MorphApi {
  const before = useRef(opts.onBeforeChange);
  before.current = opts.onBeforeChange;

  const [view, setViewState] = useState<CanvasView>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'original' ? 'original' : 'clean';
    } catch {
      return 'clean';
    }
  });
  const [quickLook, setQuickLook] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const hold = useRef<ReturnType<typeof setTimeout>>();
  const pressing = useRef(false);
  const held = useRef(false);

  const setView = useCallback((v: CanvasView) => {
    if (v === viewRef.current) return;
    before.current?.();
    viewRef.current = v;
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* not remembered — still switched */
    }
  }, []);

  const pressStart = useCallback(() => {
    if (pressing.current) return;
    pressing.current = true;
    held.current = false;
    clearTimeout(hold.current);
    hold.current = setTimeout(() => {
      held.current = true;
      before.current?.();
      setQuickLook(true);
    }, MORPH_HOLD_MS);
  }, []);

  const pressEnd = useCallback(() => {
    if (!pressing.current) return;
    pressing.current = false;
    clearTimeout(hold.current);
    if (held.current) {
      held.current = false;
      before.current?.();
      setQuickLook(false);
    } else {
      setView(other(viewRef.current));
    }
  }, [setView]);

  const pressCancel = useCallback(() => {
    if (!pressing.current) return;
    pressing.current = false;
    clearTimeout(hold.current);
    if (held.current) {
      held.current = false;
      before.current?.();
      setQuickLook(false);
    }
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && viewRef.current === 'original' && !pressing.current) {
        setView('clean');
        return;
      }
      if ((e.key === 'o' || e.key === 'O') && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        pressStart();
      }
    };
    const up = (e: KeyboardEvent) => {
      if ((e.key === 'o' || e.key === 'O') && !isTyping(e.target)) pressEnd();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      clearTimeout(hold.current);
    };
  }, [pressStart, pressEnd, setView]);

  const shown = quickLook ? other(view) : view;
  return useMemo(
    () => ({ view, shown, quickLook, setView, pressStart, pressEnd, pressCancel }),
    [view, shown, quickLook, setView, pressStart, pressEnd, pressCancel],
  );
}
```

Run the tests. Expected: 6 passed.

- [ ] **Step 3: The switch component**

`src/features/spaces/studio/components/MorphSwitch.tsx`:

```tsx
import { motion } from 'motion/react';
import { FileText, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CanvasView } from '../useMorph';

interface Props {
  shown: CanvasView;
  onPressStart(): void;
  onPressEnd(): void;
  onPressCancel(): void;
  /** Keyboard on the switch itself: Enter/Space toggles and stays. */
  onToggle(): void;
}

const option = 'relative z-10 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium';

/** Clean | Original — spec §4.2. Press-and-hold is a quick look; a tap stays. */
export function MorphSwitch({ shown, onPressStart, onPressEnd, onPressCancel, onToggle }: Props) {
  const original = shown === 'original';
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={original}
        aria-label="Show original"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          onPressStart();
        }}
        onPointerUp={onPressEnd}
        onPointerCancel={onPressCancel}
        onLostPointerCapture={onPressCancel}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="relative flex select-none items-center rounded-full border border-border bg-card p-0.5"
      >
        {(['clean', 'original'] as const).map((v) => (
          <span key={v} className={cn(option, shown === v ? 'text-foreground' : 'text-muted-foreground')}>
            {shown === v && (
              <motion.span
                layoutId="studio-switch-thumb"
                className="absolute inset-0 -z-10 rounded-full bg-muted"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
            {v === 'clean' ? <Sparkles aria-hidden className="h-3.5 w-3.5" /> : <FileText aria-hidden className="h-3.5 w-3.5" />}
            {v === 'clean' ? 'Clean' : 'Original'}
          </span>
        ))}
      </button>
      <kbd aria-hidden className="hidden rounded border border-border px-1.5 text-[11px] text-muted-foreground md:inline">
        O
      </kbd>
      <span className="sr-only" aria-live="polite">
        {original ? 'Showing original' : 'Showing clean version'}
      </span>
    </div>
  );
}
```

`onPointerUp` then fires `lostpointercapture`. `pressCancel` after `pressEnd` is a no-op because `pressing` is already false.

- [ ] **Step 4: Gates and commit**

```bash
npx vitest run src/features/spaces/studio/__tests__/useMorph.test.ts
npx tsc -p tsconfig.app.json --noEmit && node scripts/check-vocabulary.mjs
git add src/features/spaces/studio/useMorph.ts src/features/spaces/studio/components/MorphSwitch.tsx src/features/spaces/studio/__tests__/useMorph.test.ts
git commit -m "feat(studio): Morph switch — tap to stay, hold for a quick look, O key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Morph — paragraphs fly home

**Files:**
- Create: `src/features/spaces/studio/text.ts`, `src/features/spaces/studio/components/OriginalPage.tsx`
- Modify: `src/features/spaces/studio/components/CleanBlock.tsx` (add `index`, `count`, `morph`, `flying` props + `layoutId`)
- Replace: `src/features/spaces/studio/components/CanvasPage.tsx`, `src/features/spaces/screens/StudioCanvasScreen.tsx`
- Test: `src/features/spaces/studio/__tests__/text.test.ts`, `src/features/spaces/studio/__tests__/OriginalPage.test.tsx`, `src/features/spaces/studio/__tests__/morph.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `plainText(md: string): string`
  - `firstWords(md: string, n?: number): string`
  - `OriginalPage` props: `{ page: SourcePage; blocks: CanvasBlock[]; morph: boolean; materialName: string; onRegion(blockId: string): void; onInclude(sourceBlockId: string): void }`
  - **`layoutId` contract:** `morph-${canvasBlockId}`
    - clean side: carried by every extracted clean block, always
    - original side: carried only by overlays of the anchor page (`morph === true`)

**Why clean blocks always carry `layoutId`:** an exiting element keeps the props from its last render. If the clean side only got ids on the anchor page *after* the click, the departing paragraphs would have no ids and nothing would fly. So clean blocks always have ids, and the original side decides which pairs exist by giving ids only to the anchor page's overlays. Motion animates pairs only; unpaired clean blocks simply fade with their section.

- [ ] **Step 1: Write failing tests**

`src/features/spaces/studio/__tests__/text.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { firstWords, plainText } from '../text';

describe('text', () => {
  it('strips Markdown structure', () => {
    expect(plainText('### Normal forms')).toBe('Normal forms');
    expect(plainText('- one\n- two')).toBe('one two');
    expect(plainText('A **bold** and `code` move')).toBe('A bold and code move');
  });
  it('takes the first words with an ellipsis only when cut', () => {
    expect(firstWords('one two three', 6)).toBe('one two three');
    expect(firstWords('a b c d e f g h', 6)).toBe('a b c d e f…');
  });
});
```

`src/features/spaces/studio/__tests__/OriginalPage.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OriginalPage } from '../components/OriginalPage';
import type { CanvasBlock, SourcePage } from '../types';

const page: SourcePage = {
  materialId: 'm', page: 4, width: 720, height: 405, imageUrl: '/p4.webp', geometry: 'block',
  blocks: [
    { id: 'a', page: 4, bbox: [0.1, 0.1, 0.6, 0.2], kind: 'heading', text: 'Functional dependencies', readingOrder: 0 },
    { id: 'f', page: 4, bbox: [0.1, 0.93, 0.4, 0.97], kind: 'paragraph', text: 'footer', readingOrder: 1 },
  ],
};
const blocks: CanvasBlock[] = [
  { id: 'c-a', origin: 'extracted', markdown: '### Functional dependencies', source: { materialId: 'm', page: 4, blockIds: ['a'] }, edited: true },
];

describe('OriginalPage', () => {
  it('shows the real page, a way back per paragraph, and what was edited', () => {
    const onRegion = vi.fn();
    render(<OriginalPage page={page} blocks={blocks} morph={false} materialName="N.pdf" onRegion={onRegion} onInclude={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'Page 4 of N.pdf' })).toHaveAttribute('src', '/p4.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Back to: Functional dependencies' }));
    expect(onRegion).toHaveBeenCalledWith('c-a');
    expect(screen.getByText('Edited by you')).toBeInTheDocument();
  });

  it('reveals what is not in your version and offers to add it', () => {
    const onInclude = vi.fn();
    render(<OriginalPage page={page} blocks={blocks} morph={false} materialName="N.pdf" onRegion={vi.fn()} onInclude={onInclude} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not in your version' }));
    expect(onInclude).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add to your version' }));
    expect(onInclude).toHaveBeenCalledWith('f');
  });

  it('offers a single way back on a page without coordinates', () => {
    const onRegion = vi.fn();
    const flat = { ...page, geometry: 'page' as const, blocks: [] };
    const refs: CanvasBlock[] = [{ ...blocks[0], source: { materialId: 'm', page: 4, blockIds: [] } } as CanvasBlock];
    render(<OriginalPage page={flat} blocks={refs} morph={false} materialName="N.pdf" onRegion={onRegion} onInclude={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the clean version' }));
    expect(onRegion).toHaveBeenCalledWith('c-a');
  });
});
```

`src/features/spaces/studio/__tests__/morph.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

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
const run = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });

describe('Morph on the canvas', () => {
  it('a tap on the switch shows the originals', async () => {
    const { container } = await mount();
    const sw = screen.getByRole('switch', { name: 'Show original' });
    fireEvent.pointerDown(sw, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(sw, { pointerId: 1 });
    await run(400);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('img', { name: 'Page 2 of Normalization.pdf' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-view="original"]').length).toBeGreaterThan(0);
  });

  it('clicking a region flies back to that paragraph', async () => {
    const { container } = await mount();
    fireEvent.keyDown(window, { key: 'o' });
    fireEvent.keyUp(window, { key: 'o' });
    await run(400);
    fireEvent.click(screen.getByRole('button', { name: /^Back to: Klausurrelevant/ }));
    await run(700);
    expect(screen.getByRole('switch', { name: 'Show original' })).toHaveAttribute('aria-checked', 'false');
    expect(container.querySelector('[data-block-id="c-p2-hw"]')).not.toBeNull();
  });

  it('adding a missing block puts it in your version', async () => {
    const { container } = await mount();
    const before = container.querySelectorAll('[data-block-id]').length;
    fireEvent.keyDown(window, { key: 'o' });
    fireEvent.keyUp(window, { key: 'o' });
    await run(400);
    fireEvent.click(screen.getAllByRole('button', { name: 'Not in your version' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Add to your version' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    await run(400);
    expect(container.querySelectorAll('[data-block-id]').length).toBe(before + 1);
  });
});
```

Run all three. Expected: FAIL (modules not found or assertions failing).

- [ ] **Step 2: Text helpers**

`src/features/spaces/studio/text.ts`:

```ts
/** Markdown → readable plain text, for labels and the text that flies. */
export function plainText(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstWords(md: string, n = 6): string {
  const words = plainText(md).split(' ');
  return words.length > n ? `${words.slice(0, n).join(' ')}…` : words.join(' ');
}
```

- [ ] **Step 3: The original page**

`src/features/spaces/studio/components/OriginalPage.tsx`:

```tsx
import { useState } from 'react';
import { motion } from 'motion/react';
import { boxStyle, unionBox, unmappedSourceBlocks } from '../geometry';
import { FLIGHT_EASE, FLIGHT_S, STAGGER_S, TEXT_FADE_S } from '../motion';
import { firstWords, plainText } from '../text';
import type { Box, CanvasBlock, ExtractedBlock, SourcePage } from '../types';
import { PageDivider } from './PageDivider';

interface Props {
  page: SourcePage;
  /** This page's canvas blocks. */
  blocks: CanvasBlock[];
  /** The anchor page: its overlays carry layoutIds, so its paragraphs fly. */
  morph: boolean;
  materialName: string;
  onRegion(blockId: string): void;
  onInclude(sourceBlockId: string): void;
}

/** Where blocks without coordinates converge before fading (spec §4.2 rule 10). */
const CENTER: Box = [0.4, 0.45, 0.6, 0.55];
const flight = (i: number) => ({ layout: { duration: FLIGHT_S, ease: FLIGHT_EASE, delay: i * STAGGER_S } });

/**
 * One page of the Material as it really is — spec §4.2.
 *
 * Every paragraph of your version is a button over the spot it came from
 * (click → back to that paragraph). Source blocks your version doesn't
 * contain get a dashed outline: Morph shows what got lost, not only where
 * things came from.
 */
export function OriginalPage({ page, blocks, morph, materialName, onRegion, onInclude }: Props) {
  const [offer, setOffer] = useState<string | null>(null);
  const mapped = blocks.filter((b): b is ExtractedBlock => b.origin === 'extracted');
  const missing = unmappedSourceBlocks(page, blocks);

  return (
    <section data-view="original" data-page-anchor={page.page} aria-label={`Original page ${page.page}`}>
      <PageDivider page={page.page} original />
      <div
        className="relative overflow-hidden rounded-xl border border-border bg-[hsl(var(--studio-paper))]"
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
      >
        <img
          src={page.imageUrl}
          alt={`Page ${page.page} of ${materialName}`}
          className="absolute inset-0 h-full w-full object-contain"
        />

        {mapped.map((b, i) => {
          const box = unionBox(
            b.source.blockIds
              .map((id) => page.blocks.find((s) => s.id === id)?.bbox)
              .filter((x): x is Box => !!x),
          );
          if (!box) {
            return morph ? (
              <motion.div
                key={b.id}
                aria-hidden
                layoutId={`morph-${b.id}`}
                transition={flight(i)}
                style={boxStyle(CENTER)}
                initial={{ opacity: 1 }}
                animate={{ opacity: 0 }}
                className="absolute"
              />
            ) : null;
          }
          return (
            <motion.button
              key={b.id}
              type="button"
              layoutId={morph ? `morph-${b.id}` : undefined}
              transition={flight(i)}
              onClick={() => onRegion(b.id)}
              aria-label={`Back to: ${firstWords(b.markdown)}`}
              style={boxStyle(box)}
              className="absolute rounded-[4px] outline-none hover:bg-[hsl(var(--studio-mark)/0.18)] focus-visible:ring-2 focus-visible:ring-ring"
            >
              {morph && (
                <motion.span
                  aria-hidden
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: TEXT_FADE_S }}
                  className="block overflow-hidden text-left text-[13px] leading-snug text-[#2c2c2a]"
                >
                  {plainText(b.markdown)}
                </motion.span>
              )}
              {b.edited && (
                <span className="absolute -top-5 right-0 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                  Edited by you
                </span>
              )}
            </motion.button>
          );
        })}

        {missing.map((s) => (
          <div
            key={s.id}
            style={boxStyle(s.bbox)}
            className="absolute rounded-[4px] border-2 border-dashed border-muted-foreground/60"
          >
            {/* Figures can't be added as text in v1: they are labelled, not offered. */}
            {s.kind === 'figure' || !s.text ? (
              <span className="absolute -top-6 left-0 whitespace-nowrap rounded-full border border-border bg-card px-2 text-[11px] text-muted-foreground">
                Figure not in your version
              </span>
            ) : (
              <button
                type="button"
                onClick={() => (offer === s.id ? onInclude(s.id) : setOffer(s.id))}
                className="absolute -top-6 left-0 min-h-6 whitespace-nowrap rounded-full border border-border bg-card px-2 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {offer === s.id ? 'Add to your version' : 'Not in your version'}
              </button>
            )}
          </div>
        ))}

        {page.geometry === 'page' && mapped[0] && (
          <button
            type="button"
            onClick={() => onRegion(mapped[0].id)}
            className="absolute inset-x-0 bottom-3 mx-auto w-fit min-h-6 rounded-full border border-border bg-card px-3 text-xs"
          >
            Back to the clean version
          </button>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Give clean blocks their flight**

In `src/features/spaces/studio/components/CleanBlock.tsx`, extend the props:

```tsx
  /** Position within its page, for the reverse stagger on the way back. */
  index: number;
  count: number;
  /** True on the anchor page right after a switch: the text fades in after landing. */
  flying: boolean;
```

Add `index, count, flying` to the destructuring, and add these imports:

```tsx
import { FLIGHT_EASE, FLIGHT_S, STAGGER_S, TEXT_FADE_S } from '../motion';
```

Replace the outer `motion.div`'s `animate`/`transition` props and wrap `<Markdown>`:

```tsx
      layoutId={extracted ? `morph-${block.id}` : undefined}
      animate={flash ? { backgroundColor: FLASH_FRAMES } : undefined}
      transition={{
        layout: { duration: FLIGHT_S, ease: FLIGHT_EASE, delay: (count - 1 - index) * STAGGER_S },
        backgroundColor: { duration: 1.2, times: [0, 0.6, 1] },
      }}
```

```tsx
      <motion.div
        initial={extracted && flying ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ delay: FLIGHT_S * 0.6, duration: TEXT_FADE_S }}
      >
        <Markdown
          className={cn(lowConfidence && 'underline decoration-dotted decoration-muted-foreground underline-offset-4')}
        >
          {block.markdown}
        </Markdown>
      </motion.div>
```

- [ ] **Step 5: Replace the page column**

`src/features/spaces/studio/components/CanvasPage.tsx` (whole file):

```tsx
import { AnimatePresence, motion } from 'motion/react';
import { CleanBlock } from './CleanBlock';
import { OriginalPage } from './OriginalPage';
import { PageDivider } from './PageDivider';
import { minConfidence } from '../geometry';
import type { PageGroup } from '../geometry';
import type { CanvasView } from '../useMorph';
import type { SourcePage } from '../types';

interface Props {
  groups: PageGroup[];
  pages: SourcePage[];
  view: CanvasView;
  /** The page that flies; every other page crossfades. */
  morphPage: number | null;
  flying: boolean;
  activeBlockId: string | null;
  flashBlockId: string | null;
  sourceRemoved: boolean;
  materialName: string;
  onBlockPointerEnter(blockId: string, pointerType: string): void;
  onBlockPointerLeave(): void;
  onOpenPeek(blockId: string): void;
  onClosePeek(): void;
  onRegion(blockId: string): void;
  onInclude(page: SourcePage, sourceBlockId: string): void;
}

/**
 * Your version and the original, page by page — spec §4.2.
 *
 * `popLayout` takes the outgoing view out of flow while the incoming one
 * mounts, so both exist in the same frame and Motion can pair their layoutIds.
 */
export function CanvasPage(p: Props) {
  return (
    <div className="space-y-12">
      {p.groups.map((g) => {
        const page = p.pages.find((x) => x.materialId === g.materialId && x.page === g.page) ?? null;
        const morph = p.morphPage === g.page;
        const showOriginal = p.view === 'original' && page && !p.sourceRemoved;
        return (
          <div key={`${g.materialId}-${g.page}`} className="relative">
            <AnimatePresence initial={false} mode="popLayout">
              {showOriginal ? (
                <motion.div
                  key="original"
                  initial={{ opacity: morph ? 1 : 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <OriginalPage
                    page={page}
                    blocks={g.blocks}
                    morph={morph}
                    materialName={p.materialName}
                    onRegion={p.onRegion}
                    onInclude={(id) => p.onInclude(page, id)}
                  />
                </motion.div>
              ) : (
                <motion.section
                  key="clean"
                  data-view="clean"
                  data-page-anchor={g.page}
                  aria-label={g.page ? `Page ${g.page}` : 'Your notes'}
                  initial={{ opacity: morph ? 1 : 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <PageDivider page={g.page} />
                  <div className="space-y-2">
                    {g.blocks.map((b, i) => (
                      <CleanBlock
                        key={b.id}
                        block={b}
                        page={g.page}
                        index={i}
                        count={g.blocks.length}
                        flying={p.flying && morph}
                        lowConfidence={b.origin === 'extracted' && (minConfidence(b.source, p.pages) ?? 1) < 0.8}
                        active={p.activeBlockId === b.id}
                        flash={p.flashBlockId === b.id}
                        markerDisabled={p.sourceRemoved}
                        onPointerEnter={p.onBlockPointerEnter}
                        onPointerLeave={p.onBlockPointerLeave}
                        onOpenPeek={p.onOpenPeek}
                        onClosePeek={p.onClosePeek}
                      />
                    ))}
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Replace the screen (final Plan 1 version)**

`src/features/spaces/screens/StudioCanvasScreen.tsx` (whole file):

```tsx
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, LayoutGroup } from 'motion/react';
import { ChevronLeft, Moon, Sun } from 'lucide-react';
import { ListSkeleton, NotFound, SpacesError } from '../components/states';
import { useCanvas } from '../data/useSpaces';
import { CanvasPage } from '../studio/components/CanvasPage';
import { FullPageDialog } from '../studio/components/FullPageDialog';
import { MorphSwitch } from '../studio/components/MorphSwitch';
import { Peek } from '../studio/components/Peek';
import { includeSourceBlock } from '../studio/edit';
import { groupByPage, pickAnchorPage, regionForBlock } from '../studio/geometry';
import { FLIGHT_S } from '../studio/motion';
import { useMorph } from '../studio/useMorph';
import { usePeek } from '../studio/usePeek';
import { useReadingLine } from '../studio/useReadingLine';
import { useStudioTheme } from '../studio/useStudioTheme';
import { useWide } from '../studio/useWide';
import type { CanvasDoc, SourcePage } from '../studio/types';
import '../studio/studio-surface.css';

/**
 * The Studio canvas — spec §3.2, §4.
 *
 * The screen owns every piece of cross-cutting state (the view, the anchor
 * page, the open Peek, your edits) so nothing is lost when a panel unmounts.
 */
export default function StudioCanvasScreen() {
  const { canvasId } = useParams<{ canvasId: string }>();
  const { state, canvas, pages, material, spaceName } = useCanvas(canvasId);
  const [theme, toggleTheme] = useStudioTheme();
  const [edited, setEdited] = useState<CanvasDoc | null>(null);
  const doc = edited ?? canvas;
  const groups = useMemo(() => (doc ? groupByPage(doc.blocks) : []), [doc]);

  const peek = usePeek();
  const wide = useWide();
  const column = useRef<HTMLElement>(null);
  const [fullPage, setFullPage] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [morphPage, setMorphPage] = useState<number | null>(null);
  const [flying, setFlying] = useState(false);
  const anchor = useRef<{ page: number; top: number } | null>(null);
  const backTimer = useRef<ReturnType<typeof setTimeout>>();

  /** Runs right before the view changes: remember where you are, close Peek. */
  const beforeSwitch = useCallback(() => {
    const rects = Array.from(document.querySelectorAll<HTMLElement>('[data-page-anchor]')).map((el) => {
      const r = el.getBoundingClientRect();
      return { page: Number(el.dataset.pageAnchor), top: r.top, bottom: r.bottom };
    });
    const page = pickAnchorPage(rects, window.innerHeight);
    anchor.current = page === null ? null : { page, top: rects.find((r) => r.page === page)!.top };
    setMorphPage(page);
    setFlying(true);
    peek.close();
  }, [peek.close]);
  const morph = useMorph({ onBeforeChange: beforeSwitch });

  /* Keep your place: the anchor page's top stays where it was. */
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    const el = document.querySelector<HTMLElement>(`[data-view="${morph.shown}"][data-page-anchor="${a.page}"]`);
    if (el) window.scrollBy(0, el.getBoundingClientRect().top - a.top);
    anchor.current = null;
  }, [morph.shown]);

  useEffect(() => {
    if (!flying) return;
    const t = setTimeout(() => setFlying(false), FLIGHT_S * 1000 + 300);
    return () => clearTimeout(t);
  }, [flying, morph.shown]);
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 1200);
    return () => clearTimeout(t);
  }, [flashId]);
  useEffect(() => () => clearTimeout(backTimer.current), []);

  const peekOpen = peek.state.status === 'open';
  const pinned = peek.state.status === 'open' && peek.state.pinned;
  const region = doc && peek.state.status === 'open' ? regionForBlock(doc.blocks, pages, peek.state.blockId) : null;
  useReadingLine(pinned && morph.shown === 'clean', column, peek.follow);
  useEffect(() => {
    if (!peekOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !fullPage) peek.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [peekOpen, fullPage, peek.close]);

  const backToBlock = (blockId: string) => {
    morph.setView('clean');
    clearTimeout(backTimer.current);
    backTimer.current = setTimeout(() => {
      document.querySelector(`[data-block-id="${blockId}"]`)?.scrollIntoView?.({ block: 'center' });
      setFlashId(blockId);
    }, FLIGHT_S * 1000 + 50);
  };
  const include = (page: SourcePage, sourceBlockId: string) => {
    if (doc) setEdited(includeSourceBlock(doc, page, sourceBlockId));
  };

  const frame = (children: React.ReactNode) => (
    <div className="studio-surface min-h-screen" data-theme={theme}>
      <div className="mx-auto max-w-3xl p-8">{children}</div>
    </div>
  );
  if (state === 'loading') return frame(<ListSkeleton />);
  if (state === 'error') return frame(<SpacesError what="this Material" />);
  if (!doc || !material)
    return frame(<NotFound what="Material" backTo="/v4/library/studio" backLabel="Back to Studio" />);

  const peekPanel = (
    <AnimatePresence>
      {region && peek.state.status === 'open' && (
        <Peek
          key="peek"
          region={region}
          materialName={material.filename}
          pinned={peek.state.pinned}
          sourceRemoved={material.sourceRemoved}
          onTogglePin={peek.togglePin}
          onFullPage={() => setFullPage(true)}
          onPointerEnter={peek.enterPeek}
          onPointerLeave={peek.leavePeek}
        />
      )}
    </AnimatePresence>
  );

  return (
    <div className="studio-surface min-h-screen" data-theme={theme}>
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[90rem] items-center gap-3 px-4 py-3 md:px-6">
          <Link
            to="/v4/library/studio"
            aria-label="Back to Studio"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft aria-hidden className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{material.filename}</h1>
            <p className="truncate text-xs text-muted-foreground">{spaceName}</p>
          </div>
          {!material.sourceRemoved && (
            <MorphSwitch
              shown={morph.shown}
              onPressStart={morph.pressStart}
              onPressEnd={morph.pressEnd}
              onPressCancel={morph.pressCancel}
              onToggle={() => morph.setView(morph.view === 'clean' ? 'original' : 'clean')}
            />
          )}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {theme === 'dark' ? <Sun aria-hidden className="h-4 w-4" /> : <Moon aria-hidden className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[90rem] gap-6 px-4 md:px-6 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,46rem)_minmax(18rem,1fr)]">
        <div className="hidden min-[1200px]:block" />
        <main ref={column} className="min-w-0 py-10 pl-14 md:pl-16">
          <LayoutGroup>
            <CanvasPage
              groups={groups}
              pages={pages}
              view={morph.shown}
              morphPage={morphPage}
              flying={flying}
              activeBlockId={peek.state.status === 'open' ? peek.state.blockId : null}
              flashBlockId={flashId}
              sourceRemoved={material.sourceRemoved}
              materialName={material.filename}
              onBlockPointerEnter={peek.hoverBlock}
              onBlockPointerLeave={peek.leaveBlock}
              onOpenPeek={peek.open}
              onClosePeek={peek.close}
              onRegion={backToBlock}
              onInclude={include}
            />
          </LayoutGroup>
        </main>
        <div className="hidden min-[1200px]:block">
          <div className="sticky top-24 py-10">{wide && peekPanel}</div>
        </div>
      </div>

      {!wide && <div className="fixed inset-x-3 bottom-3 z-30 max-h-[45vh] overflow-auto">{peekPanel}</div>}
      {region && (
        <FullPageDialog
          open={fullPage}
          onOpenChange={setFullPage}
          region={region}
          materialName={material.filename}
          theme={theme}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run all Studio tests, then the gates**

```bash
npx vitest run src/features/spaces/studio
npx tsc -p tsconfig.app.json --noEmit && node scripts/check-vocabulary.mjs && npx vitest run src/features/spaces
```

Expected: all pass, including the Task 5 and Task 7 screen tests, which use the new screen.

- [ ] **Step 8: Commit**

```bash
git add src/features/spaces/studio src/features/spaces/screens/StudioCanvasScreen.tsx
git commit -m "feat(studio): Morph — paragraphs fly home, regions fly back, missing blocks revealed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: States, accessibility, and verification in the browser

**Files:**
- Modify: `.claude/launch.json` (add a `dev-studio` entry on port 5221)
- Modify only if a check below fails: the Studio files above

**Interfaces:** none new.

- [ ] **Step 1: All four states via `?mock=`.** Add to `src/features/spaces/studio/__tests__/screens.test.tsx`:

```tsx
describe('canvas states', () => {
  const setSearch = (q: string) => window.history.replaceState({}, '', `/?mock=${q}`);
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('renders the error state', async () => {
    setSearch('error');
    at('/v4/library/studio/c/c-norm');
    expect(await screen.findByText(/Couldn’t load this Material/, undefined, { timeout: 2000 })).toBeInTheDocument();
  });

  it('renders the loading state', () => {
    setSearch('loading');
    const { container } = at('/v4/library/studio/c/c-norm');
    expect(container.querySelector('.studio-surface')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Normalization.pdf' })).toBeNull();
  });
});
```

Add `afterEach` to that file's `vitest` import. Run it. Expected: pass. If the error copy differs, read `SpacesError` in `components/states.tsx` and match its exact title format (`Couldn’t load ${what}`).

- [ ] **Step 2: Full gates**

```bash
npx tsc -p tsconfig.app.json --noEmit
npx eslint src/features/spaces/studio src/features/spaces/screens/StudioHomeScreen.tsx src/features/spaces/screens/StudioCanvasScreen.tsx src/features/spaces/mocks/studio-canvas.ts
node scripts/check-vocabulary.mjs
npx vitest run src/features/spaces
```

Expected: all clean. Fix the code, not the gate.

- [ ] **Step 3: Start a dev server on its own port.** Ports 5173, 5199, 5202 and 5204 belong to other sessions. Add to `.claude/launch.json` `configurations`:

```json
    {
      "name": "dev-studio",
      "runtimeExecutable": "/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin/node",
      "runtimeArgs": ["node_modules/vite/bin/vite.js", "--port", "5221", "--strictPort"],
      "port": 5221,
      "autoPort": false
    }
```

If the app boots broken because this worktree has no `.env`, copy it from the main checkout (`cp /Users/abdullahabobaker/Desktop/ascend-academy/.env .env`). It is gitignored; never commit it. Start the server with `preview_start` (`name: "dev-studio"`) and open `http://localhost:5221/v4/library/studio`.

- [ ] **Step 4: Walk the checklist in the browser** at 1440×900 and 375×812, in light and dark:

1. Home: Open Material → the canvas opens with a toast. The Continue row opens the canvas.
2. Canvas: page dividers; markers appear on hover; the handwriting block is dotted-underlined; the written note has a left rule and no marker.
3. **Peek:**
   - rest on a paragraph, and the original appears after about ⅓ s with the outline
   - move down the same page, and the outline glides
   - Pin, then scroll: it follows the reading line
   - Full page opens with a page turn, and zoom works
   - `Esc` closes
   - page 3 shows no outline
4. **Morph:**
   - tap the switch: paragraphs fly to their spots, and the text fades onto the real page
   - hold `O`: a quick look that springs back on release
   - click a region: it flies back and the paragraph flashes
   - "Not in your version" → "Add to your version" adds the footer block
   - the scroll position stays on the same page
   - at 375px it still works, and Peek is a bottom sheet
5. Reduced motion (macOS: System Settings → Accessibility → Display → Reduce motion): the switch crossfades with no flight.
6. `read_console_messages`: no errors from Studio files.

For every item that fails: fix, re-run the gates, re-check. Take screenshots of Peek open, Morph mid-flight (screenshot within ~300 ms after tapping) and Original view with the diff reveal.

- [ ] **Step 5: Commit**

```bash
git add src/features/spaces .claude/launch.json
git commit -m "test(studio): states, a11y and browser verification for Plan 1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After Plan 1

- **Plan 2** (written after this lands, against the real code): composer, streamed answers with citations, the interactive answer blocks ported from `components/reader/iui/` (spec §5.1a), Keep/Discard, the create menu and the shelf with job states, the publish dialog with the role mapping (spec §7), the Sources drawer, and an "Open Studio" link from Library.
- **Separate spec:** the real pipeline (MarkItDown + PaddleOCR + PyMuPDF geometry), using spec §6.1–6.2 as its contract.
