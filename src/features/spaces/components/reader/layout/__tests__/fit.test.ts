import { describe, expect, it } from 'vitest';
import { RANGE, fitLayer, ownSize, sharedSize } from '../fit';

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

describe('fitLayer', () => {
  /** A block that fits its box up to `limit` cqw (jsdom cannot lay out text, so the metrics are defined). */
  const block = (group: string, limit: number, text = 'Some text') => {
    const e = document.createElement('div');
    e.className = 'blk';
    e.dataset.group = group;
    e.textContent = text;
    /* jsdom's CSS parser drops the cqw unit, so the element's style is a plain object here. */
    Object.defineProperty(e, 'style', { value: { fontSize: '' } });
    const size = () => parseFloat(e.style.fontSize);
    Object.defineProperty(e, 'scrollHeight', { get: () => (size() <= limit ? 10 : 30) });
    Object.defineProperty(e, 'clientHeight', { get: () => 10 });
    Object.defineProperty(e, 'scrollWidth', { get: () => 10 });
    Object.defineProperty(e, 'clientWidth', { get: () => 10 });
    return e;
  };
  const layer = (...els: HTMLElement[]) => {
    const root = document.createElement('div');
    root.className = 'ls-layout';
    els.forEach((e) => root.appendChild(e));
    return root;
  };
  const px = (e: HTMLElement) => parseFloat(e.style.fontSize);

  it('sets the group top size, in cqw, where every block fits', () => {
    const a = block('body', 9);
    const h = block('h', 9);
    fitLayer(layer(a, h));
    expect(a.style.fontSize).toBe('2.3cqw');
    expect(h.style.fontSize).toBe('3.5cqw');
  });

  it('shares one size per group: the cramped block takes its own, the rest the shared one', () => {
    const fine = Array.from({ length: 7 }, () => block('body', 1.9));
    const cramped = block('body', 1.2);
    fitLayer(layer(cramped, ...fine));
    fine.forEach((e) => expect(px(e)).toBeGreaterThan(1.89));
    fine.forEach((e) => expect(px(e)).toBeLessThanOrEqual(1.9));
    expect(px(cramped)).toBeLessThanOrEqual(1.2);
    expect(px(cramped)).toBeGreaterThan(1.1);
  });

  it('does not let a block with hardly any text pull the shared size down', () => {
    const fine = Array.from({ length: 7 }, () => block('body', 1.9));
    const cramped = block('body', 1.2);
    const short = block('body', 1.06, 'ab');
    fitLayer(layer(short, cramped, ...fine));
    fine.forEach((e) => expect(px(e)).toBeGreaterThan(1.89));
    expect(px(short)).toBeLessThanOrEqual(1.06);
  });

  it('marks a block that fits no size data-over, and leaves its neighbours alone', () => {
    const lost = block('body', 0.5);
    const ok = block('body', 9);
    fitLayer(layer(lost, ok));
    expect(lost.dataset.over).toBe('1');
    expect(ok.dataset.over).toBeUndefined();
  });

  it('clears a mark from an earlier pass', () => {
    const e = block('row', 9);
    e.dataset.over = '1';
    fitLayer(layer(e));
    expect(e.dataset.over).toBeUndefined();
    expect(e.style.fontSize).toBe('1.45cqw');
  });

  it('never touches a hole (a figure or window) and measures each group in its own range', () => {
    const hole = block('fig', 0.1);
    const row = block('row', 0.9);
    fitLayer(layer(hole, row));
    expect(hole.style.fontSize).toBe('');
    expect(hole.dataset.over).toBeUndefined();
    expect(px(row)).toBeLessThanOrEqual(0.9);
    expect(px(row)).toBeGreaterThan(0.8);
  });
});
