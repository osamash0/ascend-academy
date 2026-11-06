import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkLayer, collisions, cropShare, struck, tinyBlocks, underWindow, type DOMRectLike } from '../layoutGate';

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

describe('checkLayer', () => {
  /*
   * jsdom cannot lay out text, so the rects are given: an element's own box in `data-rect`,
   * the lines of a block's text in `data-lines`, both as [left, top, width, height].
   */
  type R = [number, number, number, number];
  const toRect = ([l, t, w, h]: R): DOMRectLike => rect(l, t, w, h);
  const had = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');

  beforeEach(() => {
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const raw = (this as HTMLElement).dataset?.rect;
      return (raw ? toRect(JSON.parse(raw)) : rect(0, 0, 0, 0)) as DOMRect;
    };
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      writable: true,
      value(this: Range) {
        const raw = (this.startContainer.parentElement as HTMLElement | null)?.dataset?.lines;
        return (raw ? (JSON.parse(raw) as R[]).map(toRect) : []) as unknown as DOMRectList;
      },
    });
  });
  afterEach(() => {
    delete (Element.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    if (had) Object.defineProperty(Range.prototype, 'getClientRects', had);
    else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
  });

  let n = 0;
  const blk = (o: { kind?: string; group?: string; box?: R; lines?: R[]; size?: string; html?: string }) =>
    `<div class="blk" data-id="b${n++}" data-kind="${o.kind ?? 'p'}" data-group="${o.group ?? 'body'}"` +
    ` data-rect='${JSON.stringify(o.box ?? [0, 0, 0, 0])}' data-lines='${JSON.stringify(o.lines ?? [])}'` +
    ` ${o.size ? `data-size="${o.size}"` : ''}>${o.html ?? 'Some words'}</div>`;
  const layer = (inner: string, extra = '') => {
    const el = document.createElement('div');
    el.className = 'ls-layout';
    el.innerHTML = extra + inner;
    /* jsdom's CSS parser drops the cqw unit, so a set size lives in a plain style object. */
    el.querySelectorAll<HTMLElement>('[data-size]').forEach((e) =>
      Object.defineProperty(e, 'style', { value: { fontSize: e.dataset.size } }),
    );
    return el;
  };

  it('passes a layer whose lines keep apart', () => {
    const el = layer(
      blk({ box: [0, 0, 400, 100], lines: [[0, 0, 300, 20], [0, 30, 300, 20]], size: '1.5cqw' }) +
        blk({ box: [0, 200, 400, 100], lines: [[0, 200, 300, 20]], size: '1.5cqw' }),
    );
    expect(checkLayer(el)).toEqual({ pass: true, reasons: [] });
  });

  it('fails lines of two blocks on top of each other', () => {
    const el = layer(
      blk({ box: [0, 0, 400, 100], lines: [[0, 0, 300, 20]] }) + blk({ box: [0, 300, 400, 100], lines: [[10, 5, 300, 20]] }),
    );
    const r = checkLayer(el);
    expect(r.pass).toBe(false);
    expect(r.reasons).toEqual(['1 lines collide']);
  });

  it('leaves out sub- and superscripts when it reads lines', () => {
    const el = layer(
      blk({ box: [0, 0, 400, 100], lines: [[0, 0, 300, 20]] }) +
        blk({ box: [0, 300, 400, 100], html: 'x<sub data-lines=\'[[10,5,300,20]]\'>i</sub>' }),
    );
    expect(checkLayer(el).pass).toBe(true);
  });

  it('fails a block set under 0.8 page widths, and reads a block with no set size as fine', () => {
    expect(checkLayer(layer(blk({ size: '0.7cqw' }))).reasons).toEqual(['1 blocks too small']);
    expect(checkLayer(layer(blk({ size: '1cqw' }))).pass).toBe(true);
    expect(checkLayer(layer(blk({}))).pass).toBe(true);
    expect(checkLayer(layer(blk({ size: '0.7cqw', html: '  ' }))).pass).toBe(true);
  });

  it('fails a thin stroke drawn through a line of type', () => {
    const stroke = '<svg class="reink"><path data-rect="[20,109,80,1]"></path></svg>';
    const el = layer(blk({ box: [0, 100, 300, 20], lines: [[0, 100, 200, 20]] }), stroke);
    expect(checkLayer(el).reasons).toEqual(['1 strokes cross type']);
  });

  it('fails type that lies on a window (figure or window block), by its lines or its box', () => {
    const el = layer(
      blk({ kind: 'fig', group: 'fig', box: [0, 0, 100, 100], html: '' }) +
        blk({ box: [300, 300, 100, 100], lines: [[10, 10, 50, 10]] }),
    );
    expect(checkLayer(el).reasons).toEqual(['1 lines under a window']);
    const byBox = layer(
      blk({ kind: 'fig', group: 'fig', box: [0, 0, 100, 100], html: '' }) + blk({ box: [0, 50, 100, 100], lines: [] }),
    );
    expect(checkLayer(byBox).reasons).toEqual(['1 lines under a window']);
  });

  it('fails when more than 35% of the text area is windows, and does not count figures as text', () => {
    const text = blk({ box: [0, 0, 100, 100] });
    const win = blk({ kind: 'window', group: 'fig', box: [200, 0, 100, 100], html: '' });
    expect(checkLayer(layer(text + win)).reasons).toEqual(['50% of the text is windows']);
    const fig = blk({ kind: 'fig', group: 'fig', box: [200, 0, 1000, 1000], html: '' });
    expect(checkLayer(layer(text + fig)).pass).toBe(true);
    const small = blk({ kind: 'window', group: 'fig', box: [200, 0, 10, 100], html: '' });
    expect(checkLayer(layer(text + small)).pass).toBe(true);
  });

  it('gives every reason it finds', () => {
    const el = layer(
      blk({ box: [0, 0, 100, 100], lines: [[0, 0, 50, 10]], size: '0.5cqw' }) +
        blk({ box: [500, 0, 100, 100], lines: [[0, 0, 50, 10]] }),
    );
    expect(checkLayer(el).reasons).toEqual(['1 lines collide', '1 blocks too small']);
  });
});
