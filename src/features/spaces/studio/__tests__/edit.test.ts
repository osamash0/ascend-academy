import { describe, expect, it } from 'vitest';
import {
  hasSource, includeSourceBlock, insertAnswer, markdownFor, placeAfterCovering, removeBlock, resolveAnchor, restoreBlock,
} from '../edit';
import type { CanvasBlock, CanvasDoc, GeneratedBlock, SourcePage } from '../types';

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
