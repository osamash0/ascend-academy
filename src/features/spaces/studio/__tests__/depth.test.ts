import { describe, expect, it } from 'vitest';
import { blocksAtDepth, coveringBlock, depthsFor, DEPTHS, levelFor, shownAt } from '../depth';
import type { PageGroup } from '../geometry';
import type { CanvasBlock, SourceBlock, SourcePage } from '../types';

const sb = (id: string, order: number, kind: SourceBlock['kind'], text: string): SourceBlock => ({
  id, page: 1, bbox: [0, 0, 1, 1], kind, text, readingOrder: order,
});
const page: SourcePage = {
  materialId: 'm1', page: 1, width: 100, height: 100, imageUrl: 'p1.png', geometry: 'block',
  blocks: [
    sb('b1', 1, 'heading', 'Normal forms'), sb('b2', 2, 'paragraph', 'A relation is in 1NF.'),
    sb('b3', 3, 'paragraph', 'Second normal form.'), sb('b4', 4, 'paragraph', 'Page 4 footer'),
    sb('f1', 5, 'figure', ''),
  ],
};
const ref = (ids: string[]) => ({ materialId: 'm1', page: 1, blockIds: ids });
const s1: CanvasBlock = { id: 's1', origin: 'summary', markdown: 'g', source: ref(['b2', 'b1']), gist: true, edited: false };
const w1: CanvasBlock = { id: 'w1', origin: 'written', markdown: 'mine' };
const s2: CanvasBlock = { id: 's2', origin: 'summary', markdown: 'x', source: ref(['b3']), gist: false, edited: false };
const a1: CanvasBlock = { id: 'a1', origin: 'generated', markdown: 'ans', citations: [], askedAs: 'q', anchorId: 's2' };
const h1: CanvasBlock = { id: 'h1', origin: 'extracted', markdown: 'hw', source: ref(['hw']), edited: false };
const group: PageGroup = { materialId: 'm1', page: 1, blocks: [s1, w1, s2, a1, h1] };
const ids = (bs: CanvasBlock[]) => bs.map((b) => b.id);

describe('blocksAtDepth', () => {
  it('summary returns the group unchanged', () => {
    expect(blocksAtDepth(group, 'summary', [page])).toEqual(group.blocks);
  });
  it('gist keeps gist summaries and every non-summary block', () => {
    expect(ids(blocksAtDepth(group, 'gist', [page]))).toEqual(['s1', 'w1', 'a1', 'h1']);
  });
  it('full swaps summaries for the extracted blocks they cover', () => {
    const out = blocksAtDepth(group, 'full', [page]);
    expect(ids(out)).toEqual(['full-b1', 'full-b2', 'w1', 'full-b3', 'a1', 'h1']);
    expect(out[0]).toEqual({
      id: 'full-b1', origin: 'extracted', markdown: '### Normal forms',
      source: { materialId: 'm1', page: 1, blockIds: ['b1'] }, edited: false,
    });
  });
  it('full skips figures and uncovered blocks', () => {
    const s: CanvasBlock = { ...(s2 as object), source: ref(['b3', 'f1']) } as CanvasBlock;
    const out = blocksAtDepth({ ...group, blocks: [s] }, 'full', [page]);
    expect(ids(out)).toEqual(['full-b3']);
  });
  it('page returns nothing', () => {
    expect(blocksAtDepth(group, 'page', [page])).toEqual([]);
  });
  it('full keeps a summary that covers nothing it can open', () => {
    const none: CanvasBlock = { ...(s2 as object), id: 'n0', source: ref([]) } as CanvasBlock;
    const lost: CanvasBlock = { ...(s2 as object), id: 'n1', source: ref(['gone']) } as CanvasBlock;
    const figs: CanvasBlock = { ...(s2 as object), id: 'n2', source: ref(['f1']) } as CanvasBlock;
    const out = blocksAtDepth({ ...group, blocks: [none, s1, lost, figs] }, 'full', [page]);
    expect(ids(out)).toEqual(['n0', 'full-b1', 'full-b2', 'n1', 'n2']);
  });
  it('full never repeats a block your version already holds as text', () => {
    const own: CanvasBlock = { id: 'c-b2', origin: 'extracted', markdown: 'A relation is in 1NF.', source: ref(['b2']), edited: false };
    const out = blocksAtDepth({ ...group, blocks: [s1, own] }, 'full', [page]);
    expect(ids(out)).toEqual(['full-b1', 'c-b2']);
  });
  it('an answer anchored to a note or to handwriting follows it at Full and at Gist', () => {
    const onNote: CanvasBlock = { ...(a1 as object), id: 'a2', anchorId: 'w1' } as CanvasBlock;
    const onHand: CanvasBlock = { ...(a1 as object), id: 'a3', anchorId: 'h1' } as CanvasBlock;
    const g: PageGroup = { ...group, blocks: [s1, w1, onNote, s2, h1, onHand] };
    expect(ids(blocksAtDepth(g, 'full', [page]))).toEqual(['full-b1', 'full-b2', 'w1', 'a2', 'full-b3', 'h1', 'a3']);
    expect(ids(blocksAtDepth(g, 'gist', [page]))).toEqual(['s1', 'w1', 'a2', 'h1', 'a3']);
  });
  it('full without its source page returns the group unchanged', () => {
    expect(blocksAtDepth(group, 'full', [])).toBe(group.blocks);
  });
  it('is computed once per group and depth', () => {
    const pages = [page];
    expect(blocksAtDepth(group, 'full', pages)).toBe(blocksAtDepth(group, 'full', pages));
    expect(blocksAtDepth(group, 'gist', pages)).toBe(blocksAtDepth(group, 'gist', pages));
  });
});

describe('shownAt', () => {
  const hwPage: SourcePage = { ...page, blocks: [...page.blocks, sb('hw', 9, 'handwriting', 'note')] };
  it('at Page keeps only your own blocks: answers, notes, handwriting', () => {
    expect(ids(shownAt(group, 'page', [hwPage]))).toEqual(['w1', 'a1', 'h1']);
  });
  it('elsewhere is blocksAtDepth', () => {
    expect(shownAt(group, 'gist', [hwPage])).toEqual(blocksAtDepth(group, 'gist', [hwPage]));
  });
});

describe('levelFor', () => {
  it('is the wanted depth when the page offers it, else Summary', () => {
    expect(levelFor(group, [page], { 1: 'full' }, false)).toBe('full');
    expect(levelFor(group, [page], {}, false)).toBe('summary');
    expect(levelFor(group, [{ ...page, geometry: 'page', blocks: [] }], { 1: 'full' }, false)).toBe('summary');
  });
  it('has no Page once the source is removed', () => {
    expect(levelFor(group, [page], { 1: 'page' }, false)).toBe('page');
    expect(levelFor(group, [page], { 1: 'page' }, true)).toBe('summary');
  });
});

describe('coveringBlock', () => {
  it('maps a paragraph of the full text to the summary that covers it', () => {
    expect(coveringBlock(group.blocks, 'full-b3')).toBe('s2');
    expect(coveringBlock(group.blocks, 's1')).toBe('s1');
    expect(coveringBlock(group.blocks, 'full-zz')).toBe('full-zz');
    expect(coveringBlock(group.blocks, null)).toBeNull();
  });
});

describe('depthsFor', () => {
  it('offers everything on a normal page', () => {
    expect(depthsFor(group, [page])).toEqual(DEPTHS);
  });
  it('drops full on page-geometry pages', () => {
    expect(depthsFor(group, [{ ...page, geometry: 'page', blocks: [] }])).toEqual(['gist', 'summary', 'page']);
  });
  it('drops page without an image', () => {
    expect(depthsFor(group, [{ ...page, imageUrl: '' }])).toEqual(['gist', 'summary', 'full']);
  });
  it('offers only summary without a source page', () => {
    expect(depthsFor({ materialId: '', page: 0, blocks: [w1] }, [page])).toEqual(['summary']);
  });
});
