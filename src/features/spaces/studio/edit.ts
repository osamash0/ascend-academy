import type { CanvasBlock, CanvasDoc, ExtractedBlock, GeneratedBlock, SourceBlock, SourcePage, SourcedBlock } from './types';

/** Pure edits on a CanvasDoc. Each returns a new doc with `revision + 1`, or the same doc if nothing changed. */

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
  const ok = (id?: string | null) => !!id && blocks.some((b) => b.id === id && b.origin !== 'generated');
  for (const id of [hints.selection, hints.cited, hints.readingLine]) if (ok(id)) return id!;
  return null;
}

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
  const onPage = (b: CanvasBlock): b is SourcedBlock =>
    hasSource(b) && b.source.materialId === page.materialId && b.source.page === page.page;
  if (doc.blocks.some((b) => onPage(b) && b.source.blockIds.includes(sourceBlockId))) return doc;

  const order = (b: SourcedBlock) =>
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
  return bump(doc, blocks);
}
