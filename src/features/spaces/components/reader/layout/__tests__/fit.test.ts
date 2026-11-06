import { describe, expect, it } from 'vitest';
import { RANGE, ownSize, sharedSize } from '../fit';

describe('RANGE', () => {
  it('holds the demo ranges, in page widths, for the four fitted groups', () => {
    expect(RANGE).toEqual({ h: [1.6, 3.5], body: [1.05, 2.3], small: [0.9, 1.55], row: [0.8, 1.45] });
  });
});

describe('ownSize', () => {
  it('takes the top of the range when it already fits', () => {
    expect(ownSize(() => true, 1, 2.3)).toBe(2.3);
  });

  it('finds the largest fitting size below the top, to within the eight halvings', () => {
    const s = ownSize((x) => x <= 1.7, 1, 2.3);
    expect(s).toBeLessThanOrEqual(1.7);
    expect(s).toBeGreaterThan(1.7 - (2.3 - 0.8) / 2 ** 8 - 1e-9);
  });

  it('may go under the floor of the range, down to 80% of it', () => {
    const s = ownSize((x) => x <= 0.85, 1, 2.3);
    expect(s).toBeGreaterThan(0.8);
    expect(s).toBeLessThanOrEqual(0.85);
  });

  it('is 0 when it cannot fit even at 80% of the floor', () => {
    expect(ownSize((x) => x <= 0.79, 1, 2.3)).toBe(0);
  });

  it('only ever asks about sizes between 80% of the floor and the top', () => {
    const asked: number[] = [];
    ownSize((x) => (asked.push(x), x <= 1.2), 1, 2.3);
    expect(Math.min(...asked)).toBeGreaterThanOrEqual(0.8);
    expect(Math.max(...asked)).toBeLessThanOrEqual(2.3);
    expect(asked.length).toBeLessThanOrEqual(10);
  });
});

describe('sharedSize', () => {
  it('ignores one cramped outlier among many blocks', () => {
    const sizes = [0.9, ...Array.from({ length: 9 }, () => 1.9)];
    expect(sharedSize(sizes, 1.05, 2.3)).toBe(1.9);
  });

  it('is the 15th percentile of the real sizes', () => {
    const sizes = Array.from({ length: 20 }, (_, i) => 1.1 + i * 0.05);
    // floor(20 * 0.15) = 3: the fourth smallest.
    expect(sharedSize(sizes, 1.05, 2.3)).toBeCloseTo(1.25, 10);
  });

  it('is clamped to the range', () => {
    expect(sharedSize([0.7, 0.7, 0.7], 1.05, 2.3)).toBe(1.05);
    expect(sharedSize([5, 5, 5], 1.05, 2.3)).toBe(2.3);
  });

  it('leaves out blocks that did not fit at all (0)', () => {
    expect(sharedSize([0, 0, 1.5], 1.05, 2.3)).toBe(1.5);
  });

  it('is the floor of the range when no block has a size', () => {
    expect(sharedSize([], 1.05, 2.3)).toBe(1.05);
    expect(sharedSize([0, 0], 1.05, 2.3)).toBe(1.05);
  });
});
