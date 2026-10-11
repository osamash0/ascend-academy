/**
 * Depth: how much of a page Learn shows (Learn deeper spec, Part 3).
 * Gist, your summary, the full text your summary covers, or the page itself.
 */

import { markdownFor } from './edit';
import type { PageGroup } from './geometry';
import type { CanvasBlock, ExtractedBlock, SourcePage } from './types';

export type Depth = 'gist' | 'summary' | 'full' | 'page';
export const DEPTHS: Depth[] = ['gist', 'summary', 'full', 'page'];

const pageOf = (pages: SourcePage[], g: PageGroup) =>
  pages.find((p) => p.materialId === g.materialId && p.page === g.page);

/** What Learn renders for one page group at a depth. 'page' returns [] — the caller shows OriginalPage. */
export function blocksAtDepth(group: PageGroup, depth: Depth, pages: SourcePage[]): CanvasBlock[] {
  if (depth === 'summary') return group.blocks;
  if (depth === 'page') return [];
  if (depth === 'gist') return group.blocks.filter((b) => b.origin !== 'summary' || b.gist);

  const source = pageOf(pages, group);
  if (!source) return group.blocks;
  const present = new Set(
    group.blocks.flatMap((b) => (b.origin === 'extracted' ? b.source.blockIds : [])),
  );
  const out: CanvasBlock[] = [];
  for (const b of group.blocks) {
    if (b.origin !== 'summary') {
      out.push(b);
      continue;
    }
    const covered = source.blocks
      .filter((s) => b.source.blockIds.includes(s.id) && s.kind !== 'figure' && !present.has(s.id))
      .sort((x, y) => x.readingOrder - y.readingOrder);
    for (const s of covered) {
      present.add(s.id);
      const block: ExtractedBlock = {
        id: `full-${s.id}`,
        origin: 'extracted',
        markdown: markdownFor(s),
        source: { materialId: source.materialId, page: source.page, blockIds: [s.id] },
        edited: false,
      };
      out.push(block);
    }
  }
  return out;
}

/** Depths this page offers: no 'full' without block geometry or text blocks; no 'page' without a page image. */
export function depthsFor(group: PageGroup, pages: SourcePage[]): Depth[] {
  const source = pageOf(pages, group);
  if (!source) return ['summary'];
  const hasText = source.geometry === 'block' && source.blocks.some((b) => b.kind !== 'figure' && b.text.trim());
  return DEPTHS.filter((d) => (d === 'full' ? hasText : d === 'page' ? !!source.imageUrl : true));
}
