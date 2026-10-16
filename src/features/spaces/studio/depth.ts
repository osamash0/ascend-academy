/**
 * Depth: how much of a page Learn shows (Learn deeper spec, Part 3).
 * Gist, your summary, the full text your summary covers, or the page itself.
 */

import { hasSource, markdownFor } from './edit';
import type { PageGroup } from './geometry';
import type { CanvasBlock, ExtractedBlock, SourceBlock, SourcePage } from './types';

export type Depth = 'gist' | 'summary' | 'full' | 'page';
export const DEPTHS: Depth[] = ['gist', 'summary', 'full', 'page'];

/** The prefix of a paragraph of the page's own text, shown at Full. */
const FULL = 'full-';

const pageOf = (pages: SourcePage[], g: PageGroup) =>
  pages.find((p) => p.materialId === g.materialId && p.page === g.page);

/** Text Full can open a summary into: a real block on the page, not a figure, not empty. */
const opens = (s: SourceBlock | undefined): s is SourceBlock => !!s && s.kind !== 'figure' && !!s.text.trim();

/** Once per (group, depth, pages): a group is a new object whenever its blocks change. */
const memo = new WeakMap<PageGroup, Map<string, { pages: SourcePage[]; out: CanvasBlock[] }>>();
function cached(group: PageGroup, key: string, pages: SourcePage[], make: () => CanvasBlock[]): CanvasBlock[] {
  let byKey = memo.get(group);
  if (!byKey) memo.set(group, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit && hit.pages === pages) return hit.out;
  const out = make();
  byKey.set(key, { pages, out });
  return out;
}

/** What Learn renders for one page group at a depth. 'page' returns [] — the caller shows OriginalPage. */
export function blocksAtDepth(group: PageGroup, depth: Depth, pages: SourcePage[]): CanvasBlock[] {
  if (depth === 'summary') return group.blocks;
  if (depth === 'page') return [];
  return cached(group, depth, pages, () => (depth === 'gist' ? gistOf(group) : fullOf(group, pages)));
}

const gistOf = (group: PageGroup) => group.blocks.filter((b) => b.origin !== 'summary' || b.gist);

function fullOf(group: PageGroup, pages: SourcePage[]): CanvasBlock[] {
  const source = pageOf(pages, group);
  if (!source) return group.blocks;
  const present = new Set(group.blocks.flatMap((b) => (b.origin === 'extracted' ? b.source.blockIds : [])));
  const out: CanvasBlock[] = [];
  for (const b of group.blocks) {
    if (b.origin !== 'summary') {
      out.push(b);
      continue;
    }
    const resolvable = source.blocks.filter((s) => b.source.blockIds.includes(s.id) && opens(s));
    // Nothing to open into (no blocks, gone, only figures): the summary is the only text there is.
    if (resolvable.length === 0) {
      out.push(b);
      continue;
    }
    const covered = resolvable.filter((s) => !present.has(s.id)).sort((x, y) => x.readingOrder - y.readingOrder);
    for (const s of covered) {
      present.add(s.id);
      const block: ExtractedBlock = {
        id: `${FULL}${s.id}`,
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

/** Yours, not the page's: an answer, a note you wrote, or your handwriting on it. */
function isYours(b: CanvasBlock, page: SourcePage | undefined): boolean {
  if (b.origin === 'generated' || b.origin === 'written') return true;
  return (
    !!page &&
    b.origin === 'extracted' &&
    page.blocks.some((s) => s.kind === 'handwriting' && b.source.blockIds.includes(s.id))
  );
}

/** Every block Learn shows for a page at its level: at Page, your own blocks follow the page itself. */
export function shownAt(group: PageGroup, level: Depth, pages: SourcePage[]): CanvasBlock[] {
  if (level !== 'page') return blocksAtDepth(group, level, pages);
  return cached(group, 'yours', pages, () => {
    const page = pageOf(pages, group);
    return group.blocks.filter((b) => isYours(b, page));
  });
}

/** Depths this page offers: no 'full' without block geometry or text blocks; no 'page' without a page image. */
export function depthsFor(group: PageGroup, pages: SourcePage[]): Depth[] {
  const source = pageOf(pages, group);
  if (!source) return ['summary'];
  const hasText = source.geometry === 'block' && source.blocks.some((b) => b.kind !== 'figure' && b.text.trim());
  return DEPTHS.filter((d) => (d === 'full' ? hasText : d === 'page' ? !!source.imageUrl : true));
}

/** What the dial offers on this page: no Page once the source file is removed. */
export const optionsFor = (group: PageGroup, pages: SourcePage[], sourceRemoved: boolean): Depth[] =>
  depthsFor(group, pages).filter((d) => d !== 'page' || !sourceRemoved);

/** Where a page reads: the depth you chose if it offers it, else Summary. The one rule screen and canvas share. */
export function levelFor(
  group: PageGroup,
  pages: SourcePage[],
  depth: Record<number, Depth>,
  sourceRemoved: boolean,
): Depth {
  const wanted = depth[group.page] ?? 'summary';
  return wanted === 'summary' || optionsFor(group, pages, sourceRemoved).includes(wanted) ? wanted : 'summary';
}

/**
 * A paragraph of the full text stands in for the summary that covers it: an
 * answer asked from it belongs under that summary. Any other id is itself.
 */
export function coveringBlock(blocks: CanvasBlock[], id: string | null): string | null {
  if (!id?.startsWith(FULL)) return id;
  const sourceId = id.slice(FULL.length);
  const covering = blocks.find((b) => b.origin === 'summary' && hasSource(b) && b.source.blockIds.includes(sourceId));
  return covering?.id ?? id;
}
