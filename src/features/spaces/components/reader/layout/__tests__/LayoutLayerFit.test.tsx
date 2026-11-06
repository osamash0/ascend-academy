import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const fitLayer = vi.fn<(el: HTMLElement) => void>();
const checkLayer = vi.fn<(el: HTMLElement) => { pass: boolean; reasons: string[] }>();
vi.mock('../fit', () => ({ fitLayer: (el: HTMLElement) => fitLayer(el) }));
vi.mock('../layoutGate', () => ({ checkLayer: (el: HTMLElement) => checkLayer(el) }));

import { LayoutLayer } from '../LayoutLayer';
import type { LayoutReady } from '../types';

const page: LayoutReady = {
  page: 3,
  verdict: 'layout',
  reasons: [],
  version: 1,
  paths: [],
  blocks: [
    { id: 'h', kind: 'heading', bbox: [0.05, 0.05, 0.9, 0.15], text: 'Title of the page' },
    { id: 'a', kind: 'paragraph', bbox: [0.05, 0.2, 0.5, 0.4], text: 'A long paragraph that cannot fit.' },
    { id: 'b', kind: 'paragraph', bbox: [0.05, 0.5, 0.5, 0.7], text: 'Another paragraph that fits.' },
  ],
};

let width = 400;
let observers: Array<(w: number) => void> = [];

beforeEach(() => {
  width = 400;
  observers = [];
  fitLayer.mockReset();
  checkLayer.mockReset().mockReturnValue({ pass: true, reasons: [] });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width, height: 300, left: 0, top: 0, right: width, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private cb: (e: Array<{ contentRect: { width: number } }>) => void;
      constructor(cb: (e: Array<{ contentRect: { width: number } }>) => void) {
        this.cb = cb;
        observers.push((w) => this.cb([{ contentRect: { width: w } }]));
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const markOver = (ids: string[]) => (el: HTMLElement) => {
  el.querySelectorAll('.blk').forEach((e) => e.removeAttribute('data-over'));
  ids.forEach((id) => el.querySelector(`.blk[data-id="${id}"]`)?.setAttribute('data-over', '1'));
};

describe('LayoutLayer fit and check', () => {
  it('fits the layer, then checks it, and tells the caller once', () => {
    const onChecked = vi.fn();
    render(<LayoutLayer page={page} onChecked={onChecked} />);
    expect(fitLayer).toHaveBeenCalledTimes(1);
    expect(checkLayer).toHaveBeenCalledTimes(1);
    expect(onChecked).toHaveBeenCalledTimes(1);
    expect(onChecked).toHaveBeenCalledWith(true);
  });

  it('passes on a failing check', () => {
    checkLayer.mockReturnValue({ pass: false, reasons: ['1 lines collide'] });
    const onChecked = vi.fn();
    render(<LayoutLayer page={page} onChecked={onChecked} />);
    expect(onChecked).toHaveBeenCalledTimes(1);
    expect(onChecked).toHaveBeenCalledWith(false);
  });

  it('never fits or checks at width 0 (a hidden pane would pass by accident)', () => {
    width = 0;
    const onChecked = vi.fn();
    render(<LayoutLayer page={page} onChecked={onChecked} />);
    expect(fitLayer).not.toHaveBeenCalled();
    expect(checkLayer).not.toHaveBeenCalled();
    expect(onChecked).not.toHaveBeenCalled();
  });

  it('fits once it gets a width', () => {
    width = 0;
    const onChecked = vi.fn();
    render(<LayoutLayer page={page} onChecked={onChecked} />);
    act(() => observers[0](420));
    expect(fitLayer).toHaveBeenCalledTimes(1);
    expect(onChecked).toHaveBeenCalledTimes(1);
  });

  it('renders an overflowing block as a window, then checks once', () => {
    fitLayer.mockImplementation((el) => markOver(fitLayer.mock.calls.length === 1 ? ['a'] : [])(el));
    const onChecked = vi.fn();
    const { container } = render(<LayoutLayer page={page} onChecked={onChecked} />);
    const a = container.querySelector<HTMLElement>('[data-id="a"]')!;
    expect(a.dataset.kind).toBe('window');
    expect(a.dataset.group).toBe('fig');
    expect(a.textContent).toBe('');
    // The window is a hole in the ground, so the page shows through it.
    expect(container.querySelector('svg[data-ground] path')!.getAttribute('d')).toBe(
      'M0 0H1000V1000H0Z M50 200H500V400H50Z',
    );
    expect(container.querySelector<HTMLElement>('[data-id="b"]')!.dataset.kind).toBe('p');
    expect(fitLayer).toHaveBeenCalledTimes(2);
    expect(checkLayer).toHaveBeenCalledTimes(1);
    expect(onChecked).toHaveBeenCalledTimes(1);
  });

  it('stops after the windows are applied even when the fitter keeps marking the same block', () => {
    fitLayer.mockImplementation(markOver(['a']));
    const onChecked = vi.fn();
    render(<LayoutLayer page={page} onChecked={onChecked} />);
    expect(fitLayer.mock.calls.length).toBeLessThanOrEqual(3);
    expect(onChecked).toHaveBeenCalledTimes(1);
  });

  it('refits when the width changed by more than 1 px, and not for less', () => {
    const onChecked = vi.fn();
    render(<LayoutLayer page={page} onChecked={onChecked} />);
    act(() => observers[0](400.8));
    expect(fitLayer).toHaveBeenCalledTimes(1);
    act(() => observers[0](460));
    expect(fitLayer).toHaveBeenCalledTimes(2);
    expect(onChecked).toHaveBeenCalledTimes(2);
  });

  it('does not refit when the pane is hidden (width 0 or under 50)', () => {
    render(<LayoutLayer page={page} onChecked={vi.fn()} />);
    act(() => observers[0](0));
    act(() => observers[0](30));
    expect(fitLayer).toHaveBeenCalledTimes(1);
  });

  it('gives windows back their text at a new width, and fits again from scratch', () => {
    fitLayer.mockImplementation((el) => markOver(fitLayer.mock.calls.length === 1 ? ['a'] : [])(el));
    const { container } = render(<LayoutLayer page={page} onChecked={vi.fn()} />);
    expect(container.querySelector<HTMLElement>('[data-id="a"]')!.dataset.kind).toBe('window');
    fitLayer.mockReset().mockImplementation(markOver([]));
    act(() => observers[0](900));
    expect(container.querySelector<HTMLElement>('[data-id="a"]')!.dataset.kind).toBe('p');
  });

  it('draws and fits nothing for a held page', () => {
    const onChecked = vi.fn();
    render(<LayoutLayer page={{ page: 3, verdict: 'original', reasons: ['x'], version: 1 }} onChecked={onChecked} />);
    expect(fitLayer).not.toHaveBeenCalled();
    expect(onChecked).not.toHaveBeenCalled();
  });
});
