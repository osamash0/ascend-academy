import { describe, expect, it } from 'vitest';
import { collisions, cropShare, struck, tinyBlocks, underWindow, type DOMRectLike } from '../layoutGate';

const rect = (left: number, top: number, width: number, height: number): DOMRectLike => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe('collisions', () => {
  it('counts two overlapping lines of different blocks', () => {
    expect(collisions([[0, rect(0, 0, 100, 20)], [1, rect(10, 5, 100, 20)]])).toBe(1);
  });

  it('ignores lines of the same block', () => {
    expect(collisions([[0, rect(0, 0, 100, 20)], [0, rect(10, 5, 100, 20)]])).toBe(0);
  });

  it('ignores lines that only touch or sit under one another', () => {
    expect(collisions([[0, rect(0, 0, 100, 20)], [1, rect(0, 20, 100, 20)]])).toBe(0);
    expect(collisions([[0, rect(0, 0, 100, 20)], [1, rect(100, 0, 100, 20)]])).toBe(0);
  });

  it('ignores a graze: under a quarter of the smaller line', () => {
    expect(collisions([[0, rect(0, 0, 100, 20)], [1, rect(0, 18, 100, 20)]])).toBe(0);
  });

  it('counts every colliding pair', () => {
    const l: Array<[number, DOMRectLike]> = [
      [0, rect(0, 0, 100, 20)],
      [1, rect(0, 0, 100, 20)],
      [2, rect(0, 0, 100, 20)],
    ];
    expect(collisions(l)).toBe(3);
  });
});

describe('tinyBlocks', () => {
  it('counts sizes under 0.8 page widths', () => {
    expect(tinyBlocks([0.7, 1])).toBe(1);
    expect(tinyBlocks([0.8, 1.2])).toBe(0);
    expect(tinyBlocks([])).toBe(0);
  });
});

describe('struck', () => {
  const line = rect(0, 100, 200, 20);

  it('counts a thin stroke through the middle of a line of type', () => {
    expect(struck([rect(20, 109, 80, 1)], [[0, line]])).toBe(1);
  });

  it('ignores a stroke under or over the line (an underline, a rule)', () => {
    expect(struck([rect(20, 121, 80, 1)], [[0, line]])).toBe(0);
    expect(struck([rect(20, 99, 80, 1)], [[0, line]])).toBe(0);
  });

  it('ignores a stroke that is not a horizontal line (tall, or short)', () => {
    expect(struck([rect(20, 100, 1, 20)], [[0, line]])).toBe(0);
    expect(struck([rect(20, 109, 5, 1)], [[0, line]])).toBe(0);
    expect(struck([rect(20, 100, 80, 6)], [[0, line]])).toBe(0);
  });

  it('ignores a stroke that only brushes the end of the line', () => {
    expect(struck([rect(196, 109, 80, 1)], [[0, line]])).toBe(0);
  });

  it('counts each stroke once however many lines it crosses', () => {
    expect(struck([rect(20, 109, 80, 1)], [[0, line], [1, line]])).toBe(1);
  });
});

describe('underWindow', () => {
  const win = rect(0, 0, 100, 100);

  it('counts lines lying on a window', () => {
    expect(underWindow([win], [rect(10, 10, 50, 10), rect(10, 200, 50, 10)])).toBe(1);
  });

  it('ignores a line that only grazes the window (under 30% of it)', () => {
    expect(underWindow([win], [rect(0, 98, 50, 20)])).toBe(0);
  });

  it('takes the share to count as a third argument', () => {
    expect(underWindow([win], [rect(0, 90, 50, 40)], 0.3)).toBe(0);
    expect(underWindow([win], [rect(0, 90, 50, 40)], 0.2)).toBe(1);
  });

  it('is 0 without windows', () => {
    expect(underWindow([], [rect(10, 10, 50, 10)])).toBe(0);
  });
});

describe('cropShare', () => {
  it('is the windows area over the text area, capped at 1', () => {
    expect(cropShare([10, 15], [100])).toBe(0.25);
    expect(cropShare([300], [100])).toBe(1);
  });

  it('is 0 when the page has no text area', () => {
    expect(cropShare([10], [])).toBe(0);
    expect(cropShare([], [])).toBe(0);
  });
});
