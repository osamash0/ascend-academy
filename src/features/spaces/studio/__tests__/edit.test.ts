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
