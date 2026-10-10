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
