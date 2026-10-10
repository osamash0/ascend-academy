import { describe, expect, it } from 'vitest';
import {
  STUDIO_CANVAS, STUDIO_MATERIAL, canvasById, materialById, pagesFor, recentCanvases, studioPages,
} from '../studio-canvas';
import type { ExtractedBlock } from '../../studio/types';

/**
 * Rule guards for the Studio fixture — the same pattern as fixtures.test.ts.
 * A citation or marker that points at nothing renders as a control leading
 * nowhere; these make that impossible to ship from the fixture.
 */
const extracted = STUDIO_CANVAS.blocks.filter((b): b is ExtractedBlock => b.origin === 'extracted');

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
    for (const b of extracted.filter((b) => b.source.page === 3)) expect(b.source.blockIds).toEqual([]);
  });

  it('resolves every source reference', () => {
    for (const b of extracted) {
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
    const mapped = new Set(extracted.flatMap((b) => b.source.blockIds));
    expect(studioPages.some((p) => p.blocks.some((s) => !mapped.has(s.id)))).toBe(true);
  });

  it('has the low-confidence handwriting scenario', () => {
    const hw = studioPages[1].blocks.find((b) => b.id === 'p2-hw');
    expect(hw?.kind).toBe('handwriting');
    expect(hw?.confidence).toBeLessThan(0.8);
    expect(extracted.find((b) => b.id === 'c-p2-hw')?.source.blockIds).toEqual(['p2-hw']);
  });

  it('has exactly one edited block and one written block', () => {
    expect(extracted.filter((b) => b.edited)).toHaveLength(1);
    const written = STUDIO_CANVAS.blocks.filter((b) => b.origin === 'written');
    expect(written.map((b) => b.id)).toEqual(['w-1']);
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
