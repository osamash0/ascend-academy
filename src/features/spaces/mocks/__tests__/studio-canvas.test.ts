import { describe, expect, it } from 'vitest';
import {
  STUDIO_CANVAS, STUDIO_MATERIAL, canvasById, materialById, pagesFor, recentCanvases, studioPages,
} from '../studio-canvas';
import { hasSource } from '../../studio/edit';

/**
 * Rule guards for the Studio fixture — the same pattern as fixtures.test.ts.
 * A citation or marker that points at nothing renders as a control leading
 * nowhere; these make that impossible to ship from the fixture.
 */
const sourced = STUDIO_CANVAS.blocks.filter(hasSource);

describe('studio fixture', () => {
  it('has contiguous pages from 1', () => {
    expect(studioPages.map((p) => p.page)).toEqual(studioPages.map((_, i) => i + 1));
  });

  it('keeps every box inside its page and non-empty', () => {
    for (const p of studioPages)
      for (const b of p.blocks) {
        const [x0, y0, x1, y1] = b.bbox;
        expect(x0).toBeGreaterThanOrEqual(0);
        expect(y0).toBeGreaterThanOrEqual(0);
        expect(x1).toBeLessThanOrEqual(1);
        expect(y1).toBeLessThanOrEqual(1);
        expect(x1).toBeGreaterThan(x0);
        expect(y1).toBeGreaterThan(y0);
      }
  });

  it('gives page-geometry pages no blocks, and their clean blocks no block ids', () => {
    const pageOnly = studioPages.filter((p) => p.geometry === 'page');
    expect(pageOnly.map((p) => p.page)).toEqual([3]);
    expect(pageOnly[0].blocks).toEqual([]);
    for (const b of sourced.filter((b) => b.source.page === 3)) expect(b.source.blockIds).toEqual([]);
  });

  it('resolves every source reference', () => {
    for (const b of sourced) {
      const page = studioPages.find((p) => p.materialId === b.source.materialId && p.page === b.source.page);
      expect(page, b.id).toBeDefined();
      for (const id of b.source.blockIds) expect(page!.blocks.some((s) => s.id === id), `${b.id} → ${id}`).toBe(true);
    }
  });

  it('has unique ids on both sides', () => {
    const src = studioPages.flatMap((p) => p.blocks.map((b) => b.id));
    const canvas = STUDIO_CANVAS.blocks.map((b) => b.id);
    expect(new Set(src).size).toBe(src.length);
    expect(new Set(canvas).size).toBe(canvas.length);
  });

  it('has something for Morph to reveal as missing', () => {
    const mapped = new Set(sourced.flatMap((b) => b.source.blockIds));
    expect(studioPages.some((p) => p.blocks.some((s) => !mapped.has(s.id)))).toBe(true);
  });

  it('has the low-confidence handwriting scenario', () => {
    const hw = studioPages[1].blocks.find((b) => b.id === 'p2-hw');
    expect(hw?.kind).toBe('handwriting');
    expect(hw?.confidence).toBeLessThan(0.8);
    expect(sourced.find((b) => b.id === 'c-p2-hw')?.source.blockIds).toEqual(['p2-hw']);
  });

  it('opens on the summary: every page has one, the first is the gist', () => {
    const summaries = STUDIO_CANVAS.blocks.filter((b) => b.origin === 'summary');
    for (const p of studioPages) {
      const mine = summaries.filter((b) => b.origin === 'summary' && b.source.page === p.page);
      expect(mine.length, `page ${p.page}`).toBeGreaterThanOrEqual(1);
      expect(mine.map((b) => b.origin === 'summary' && b.gist)).toEqual(mine.map((_, i) => i === 0));
    }
    expect(STUDIO_CANVAS.blocks.filter((b) => b.origin === 'extracted').map((b) => b.id)).toEqual(['c-p2-hw']);
  });

  it('keeps every summary on one page, short, with real block ids', () => {
    for (const b of STUDIO_CANVAS.blocks) {
      if (b.origin !== 'summary') continue;
      const sentences = b.markdown.split(/(?<=[.!?])\s+/).filter(Boolean).length;
      expect(sentences, b.id).toBeLessThanOrEqual(4);
      const page = studioPages.find((p) => p.page === b.source.page)!;
      for (const id of b.source.blockIds) expect(page.blocks.some((s) => s.id === id), `${b.id} → ${id}`).toBe(true);
    }
  });

  it('has exactly one edited paragraph and one written note, placed by the §2.5 rule', () => {
    expect(STUDIO_CANVAS.blocks.filter((b) => hasSource(b) && b.edited).map((b) => b.id)).toEqual(['s-p2-2']);
    const ids = STUDIO_CANVAS.blocks.map((b) => b.id);
    expect(ids.filter((id) => id.startsWith('w-'))).toEqual(['w-1']);
    expect(ids.indexOf('w-1')).toBe(ids.indexOf('s-p2-1') + 1);
    expect(ids.indexOf('c-p2-hw')).toBe(ids.indexOf('s-p2-2') + 1);
  });

  it('never puts markdown in a raw-HTML form', () => {
    for (const b of STUDIO_CANVAS.blocks) expect(b.markdown).not.toMatch(/<\/?[a-z][\s\S]*>/i);
  });

  it('looks things up', () => {
    expect(canvasById('c-norm')).toBe(STUDIO_CANVAS);
    expect(canvasById('nope')).toBeUndefined();
    expect(materialById('m-norm')).toBe(STUDIO_MATERIAL);
    expect(pagesFor(['m-norm'])).toBe(studioPages);
    expect(pagesFor(['other'])).toEqual([]);
    expect(recentCanvases()[0]).toMatchObject({ id: 'c-norm', title: 'Normalization.pdf', spaceName: 'Database Systems' });
  });
});
