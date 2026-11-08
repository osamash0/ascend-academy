import { describe, expect, it } from 'vitest';
import { isLayoutPage, readyLayouts } from '../types';

/* The contract example: what the backend serves for a page it has re-set. */
const ready = () => ({
  page: 5,
  verdict: 'layout',
  reasons: [],
  blocks: [
    { id: 'p5-b0', kind: 'heading', bbox: [0.07, 0.06, 0.62, 0.12], text: 'Normalization' },
    { id: 't5-0', kind: 'table', bbox: [0.1, 0.2, 0.9, 0.5], text: 'a | b', rows: [['a', 'b']], colW: [0.2, 0.3] },
    { id: 'pic5-0', kind: 'figure', bbox: [0.1, 0.5, 0.5, 0.9], text: '', picture: true },
    { id: 'p5-b3', kind: 'list', bbox: [0.5, 0.5, 0.9, 0.9], text: '• one\n• two', linked: true },
  ],
  paths: [{ d: 'M10.0,20.0L30.0,40.0', bbox: [0.1, 0.1, 0.3, 0.4], fill: false }],
  version: 1,
});

/* An original page is served as its verdict only: no blocks, no paths. */
const held = () => ({ page: 7, verdict: 'original', reasons: ['3 of 40 words missing'], version: 1 });

describe('isLayoutPage', () => {
  it('accepts the contract example', () => {
    expect(isLayoutPage(ready())).toBe(true);
  });

  it('accepts an original page that carries only its verdict', () => {
    expect(isLayoutPage(held())).toBe(true);
  });

  it('rejects a page with no verdict', () => {
    const { verdict: _v, ...rest } = ready();
    expect(isLayoutPage(rest)).toBe(false);
    const { verdict: _w, ...restHeld } = held();
    expect(isLayoutPage(restHeld)).toBe(false);
  });

  it('rejects an unknown verdict', () => {
    expect(isLayoutPage({ ...ready(), verdict: 'maybe' })).toBe(false);
  });

  it('rejects a bbox of three numbers', () => {
    const p = ready();
    p.blocks[0].bbox = [0.1, 0.2, 0.3];
    expect(isLayoutPage(p)).toBe(false);
  });

  it('rejects a bbox that holds a non-number', () => {
    const p = ready();
    (p.paths[0].bbox as unknown[])[2] = 'x';
    expect(isLayoutPage(p)).toBe(false);
  });

  it('rejects a layout page without its blocks or its paths', () => {
    const { blocks: _b, ...noBlocks } = ready();
    expect(isLayoutPage(noBlocks)).toBe(false);
    const { paths: _p, ...noPaths } = ready();
    expect(isLayoutPage(noPaths)).toBe(false);
  });

  it('rejects an unknown block kind', () => {
    const p = ready();
    (p.blocks[0] as { kind: string }).kind = 'banner';
    expect(isLayoutPage(p)).toBe(false);
  });

  it('rejects things that are not pages', () => {
    for (const x of [null, undefined, 3, 'layout', [], {}]) expect(isLayoutPage(x)).toBe(false);
    expect(isLayoutPage({ ...ready(), page: '5' })).toBe(false);
    expect(isLayoutPage({ ...ready(), reasons: 'none' })).toBe(false);
    expect(isLayoutPage({ ...ready(), version: undefined })).toBe(false);
  });
});

describe('readyLayouts', () => {
  it('maps pages with a layout verdict by page number', () => {
    const m = readyLayouts([ready()]);
    expect([...m.keys()]).toEqual([5]);
    expect(m.get(5)?.blocks).toHaveLength(4);
  });

  it('gives an original page no entry, so there is no switch', () => {
    const m = readyLayouts([ready(), held()]);
    expect(m.has(7)).toBe(false);
    expect(m.size).toBe(1);
  });

  it('skips malformed rows and is empty when there is nothing', () => {
    expect(readyLayouts([{ page: 1 }, null, ready()]).size).toBe(1);
    expect(readyLayouts(undefined).size).toBe(0);
    expect(readyLayouts('nope').size).toBe(0);
  });
});
