import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock('motion/react', async (original) => ({
  ...(await original<typeof import('motion/react')>()),
  useReducedMotion: () => motion.reduce,
}));
const checkLayer = vi.fn<(el: HTMLElement) => { pass: boolean; reasons: string[] }>();
vi.mock('../fit', () => ({ fitLayer: () => {} }));
vi.mock('../layoutGate', () => ({ checkLayer: (el: HTMLElement) => checkLayer(el) }));

import { LayoutLayer } from '../LayoutLayer';
import { MORPH, delayOf, morphIn, settle } from '../morph';
import type { LayoutBlock, LayoutReady } from '../types';

interface Call {
  el: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  anim: { finish: ReturnType<typeof vi.fn>; playState: string };
}
let calls: Call[] = [];
let fontsDone: (() => void) | undefined;

const blocks = (n: number): LayoutBlock[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `b${i}`,
    kind: 'paragraph' as const,
    bbox: [0.05, 0.04 * i, 0.9, 0.04 * i + 0.03] as [number, number, number, number],
    text: `Line ${i}`,
  }));
const page = (n: number, p = 4): LayoutReady => ({ page: p, verdict: 'layout', reasons: [], version: 1, paths: [], blocks: blocks(n) });

beforeEach(() => {
  calls = [];
  motion.reduce = false;
  checkLayer.mockReset().mockReturnValue({ pass: true, reasons: [] });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width: 400, height: 300, left: 0, top: 0, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  );
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (
    this: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    const anim = { playState: 'running', finish: vi.fn(() => (anim.playState = 'finished')) };
    calls.push({ el: this, keyframes, options, anim });
    return anim;
  };
  fontsDone = undefined;
  vi.stubGlobal('ResizeObserver', undefined);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      status: 'loaded',
      ready: Promise.resolve(),
      addEventListener: (_: string, f: () => void) => (fontsDone = f),
      removeEventListener: () => {},
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  delete (document as unknown as { fonts?: unknown }).fonts;
});

describe('the morph, by numbers', () => {
  it('staggers 12 ms per block in reading order, capped at 180 ms', () => {
    expect([0, 1, 2, 10, 15, 16, 40].map(delayOf)).toEqual([0, 12, 24, 120, 180, 180, 180]);
    expect(MORPH).toMatchObject({ fade: 240, rise: 4, stagger: 12, cap: 180 });
  });

  it('animates opacity and transform only: the layer fades, each block rises 4 px', () => {
    const root = document.createElement('div');
    for (let i = 0; i < 3; i++) root.appendChild(Object.assign(document.createElement('div'), { className: 'blk' }));
    morphIn(root);
    expect(calls).toHaveLength(4);
    const [layer, ...rest] = calls;
    expect(layer.el).toBe(root);
    expect(layer.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(layer.options.duration).toBe(240);
    rest.forEach((c, i) => {
      expect(c.keyframes).toEqual([{ transform: 'translateY(4px)' }, { transform: 'none' }]);
      expect(c.options.delay).toBe(i * 12);
    });
    const props = calls.flatMap((c) => c.keyframes.flatMap((k) => Object.keys(k)));
    expect(new Set(props)).toEqual(new Set(['opacity', 'transform']));
    expect(JSON.stringify(calls.map((c) => c.keyframes))).not.toMatch(/blur|filter/);
  });

  it('settle ends a running morph at once, so the layer is measured at rest', () => {
    const root = document.createElement('div');
    root.appendChild(Object.assign(document.createElement('div'), { className: 'blk' }));
    morphIn(root);
    settle(root);
    calls.forEach((c) => expect(c.anim.finish).toHaveBeenCalledTimes(1));
  });

  it('does nothing where the browser has no Web Animations', () => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    const root = document.createElement('div');
    expect(() => {
      morphIn(root);
      settle(root);
    }).not.toThrow();
  });
});

describe('LayoutLayer enters with the morph', () => {
  it('morphs once the page has passed its checks', () => {
    const { container } = render(<LayoutLayer page={page(3)} />);
    const root = container.querySelector('.ls-layout')!;
    expect(calls.map((c) => c.el)).toEqual([root, ...root.querySelectorAll('.blk')]);
  });

  it('is instant under reduced motion: no animation at all', () => {
    motion.reduce = true;
    render(<LayoutLayer page={page(3)} />);
    expect(calls).toHaveLength(0);
  });

  it('never morphs a page that failed its checks', () => {
    checkLayer.mockReturnValue({ pass: false, reasons: ['1 lines collide'] });
    render(<LayoutLayer page={page(3)} />);
    expect(calls).toHaveLength(0);
  });

  it('measures a recheck at rest and does not morph the same page twice', async () => {
    render(<LayoutLayer page={page(3)} />);
    const first = calls.length;
    const seen: number[] = [];
    checkLayer.mockImplementation(() => {
      seen.push(calls.filter((c) => c.anim.playState === 'running').length);
      return { pass: true, reasons: [] };
    });
    await act(async () => fontsDone?.());
    expect(checkLayer).toHaveBeenCalled();
    expect(seen.every((n) => n === 0)).toBe(true);
    expect(calls.length).toBe(first);
  });

  it('is hidden from screen readers: the page underneath carries the same words', () => {
    const { container } = render(<LayoutLayer page={page(1)} />);
    expect(container.querySelector('.ls-layout')).toHaveAttribute('aria-hidden', 'true');
  });

  it('can be kept out of sight while it waits for a later check', () => {
    const { container } = render(<LayoutLayer page={page(1)} shown={false} />);
    expect(container.querySelector('.ls-layout')).toHaveAttribute('data-veiled');
  });
});
