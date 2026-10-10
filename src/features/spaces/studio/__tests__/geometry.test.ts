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
