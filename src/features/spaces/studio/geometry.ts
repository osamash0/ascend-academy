import { hasSource } from './edit';
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
  return block && hasSource(block) ? regionFor(block.source, pages) : null;
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
    if (hasSource(b) && (!current || current.page !== b.source.page || current.materialId !== b.source.materialId)) {
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

const pageOf = (pages: SourcePage[], g: PageGroup) =>
  pages.find((p) => p.materialId === g.materialId && p.page === g.page);

/**
 * The pages that have a section in `view`, in order. In Original a group
 * shows its page only if the page exists (notes above page 1 have none, and
 * stay clean); the canvas renders by the same rule.
 */
export function pagesInView(groups: PageGroup[], pages: SourcePage[], view: 'clean' | 'original'): number[] {
  return groups.filter((g) => view === 'clean' || !!pageOf(pages, g)).map((g) => g.page);
}

export function unmappedSourceBlocks(page: SourcePage, blocks: CanvasBlock[]): SourceBlock[] {
  const mapped = new Set(
    blocks.flatMap((b) =>
      hasSource(b) && b.source.page === page.page && b.source.materialId === page.materialId
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
