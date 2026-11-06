import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode, RefObject } from 'react';
import type { LayoutReady } from '../reader/layout/types';

/*
 * The Layout switch on the Page face, in the reader itself: where it stands,
 * when it is there at all, the L key, and the layer it puts over the page.
 *
 * The stand-in pager draws the overlay it is handed, as the real one does
 * over the page in view, so the layer and the Spotlight are both there to see.
 */
const flags = vi.hoisted(() => ({}) as Record<string, boolean>);
vi.mock('@/lib/featureFlags', async (original) => {
  const real = await original<typeof import('@/lib/featureFlags')>();
  Object.assign(flags, real.FEATURES, { layoutFace: true });
  return { ...real, FEATURES: flags };
});

const mock = vi.hoisted(() => ({ layouts: new Map<number, unknown>() }));
/* The layer's own fit and browser checks are tested on their own; here every page passes. */
vi.mock('../reader/layout/fit', () => ({ fitLayer: () => {} }));
vi.mock('../reader/layout/layoutGate', () => ({ checkLayer: () => ({ pass: true, reasons: [] }) }));
vi.mock('../../data/useReader', async (original) => {
  const real = await original<typeof import('../../data/useReader')>();
  return {
    ...real,
    useReaderContent: (...a: Parameters<typeof real.useReaderContent>) => ({
      ...real.useReaderContent(...a),
      layouts: mock.layouts,
    }),
  };
});

vi.mock('@/components/pdf', async () => {
  const { useEffect } = await import('react');
  return {
    PdfPage: ({ page }: { page: number }) => <div data-testid="sheet" data-page={page} />,
    PdfPager: ({ rootRef, page, overlay, onAspect, onLoad, onFirstRender }: { rootRef: RefObject<HTMLDivElement>; page: number; overlay?: ReactNode; onAspect?: (a: number) => void; onLoad?: (n: number) => void; onFirstRender?: (c: HTMLCanvasElement | null) => void }) => {
      useEffect(() => {
        onAspect?.(405 / 720);
        onLoad?.(4);
        onFirstRender?.(null);
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return (
        <div ref={rootRef} data-testid="document">
          <div data-pdf-page={page} data-testid="slot">
            {overlay}
          </div>
        </div>
      );
    },
    PdfScroll: ({ scrollRef }: { scrollRef: RefObject<HTMLDivElement> }) => <div ref={scrollRef} data-testid="scroll" />,
    scrollToPdfPage: () => {},
    pdfPageId: (p: number) => `pdf-page-${p}`,
    sampleAccent: () => null,
    warmPdfWorker: () => {},
  };
});

import LessonFacesScreen from '../../screens/LessonFacesScreen';
import { LAYOUT_FACE_KEY } from '../reader/layout/useLayoutFace';

const ready = (page: number): LayoutReady => ({
  page,
  verdict: 'layout',
  reasons: [],
  version: 1,
  paths: [],
  blocks: [{ id: `p${page}-b0`, kind: 'heading', bbox: [0.05, 0.05, 0.9, 0.15], text: 'A page re-set' }],
});

const open = async () => {
  render(
    <MemoryRouter initialEntries={['/v4/space/s-dbs/lesson/l-s-dbs-4/faces']}>
      <Routes>
        <Route path="/v4/space/:spaceId/lesson/:lessonId/faces" element={<LessonFacesScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryByTestId('document')).not.toBeNull(), { timeout: 4000 });
  await act(async () => {});
};

const layer = () => document.querySelector('.ls-layout');
const key = (k: string, target: Element | Window = window) => act(() => void fireEvent.keyDown(target, { key: k }));

beforeEach(() => {
  flags.layoutFace = true;
  mock.layouts = new Map([[1, ready(1)]]);
  window.localStorage.removeItem(LAYOUT_FACE_KEY);
});

afterEach(() => {
  window.localStorage.removeItem(LAYOUT_FACE_KEY);
});

describe('the Layout switch on the Page face', () => {
  it('stands at the end of the view tabs, off, with no layer yet', async () => {
    await open();
    const s = screen.getByRole('switch', { name: 'Layout' });
    expect(s).toHaveAttribute('aria-checked', 'false');
    const tabs = screen.getByRole('tablist', { name: 'How to read this page' });
    /* In the tabs' row, after them, and not one of them. */
    expect(tabs.contains(s)).toBe(false);
    expect(tabs.parentElement).toBe(s.parentElement);
    expect(tabs.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(layer()).toBeNull();
  });

  it('puts the layer over the page, under the Spotlight, and remembers it', async () => {
    await open();
    fireEvent.click(screen.getByRole('switch', { name: 'Layout' }));
    expect(screen.getByRole('switch', { name: 'Layout' })).toHaveAttribute('aria-checked', 'true');
    const slot = screen.getByTestId('slot');
    const l = layer()!;
    expect(slot.contains(l)).toBe(true);
    expect(l).toHaveAttribute('data-layout-page', '1');
    /* The Spotlight is drawn after the layer, so it stays on top. */
    expect(slot.lastElementChild).not.toBe(l);
    expect(window.localStorage.getItem(LAYOUT_FACE_KEY)).toBe('1');
  });

  it('opens with the layer on when it was left on', async () => {
    window.localStorage.setItem(LAYOUT_FACE_KEY, '1');
    await open();
    expect(screen.getByRole('switch', { name: 'Layout' })).toHaveAttribute('aria-checked', 'true');
    expect(layer()).not.toBeNull();
  });

  it('toggles with L, but not while typing', async () => {
    await open();
    await key('l');
    expect(layer()).not.toBeNull();
    await key('L');
    expect(layer()).toBeNull();
    const field = document.createElement('input');
    document.body.appendChild(field);
    await key('l', field);
    expect(layer()).toBeNull();
    field.remove();
  });

  it('is not there on a page with no Layout, and L does nothing', async () => {
    mock.layouts = new Map();
    await open();
    expect(screen.queryByRole('switch', { name: 'Layout' })).toBeNull();
    await key('l');
    expect(window.localStorage.getItem(LAYOUT_FACE_KEY)).toBeNull();
    expect(layer()).toBeNull();
  });

  it('is not there with the flag off, even when it was left on', async () => {
    flags.layoutFace = false;
    window.localStorage.setItem(LAYOUT_FACE_KEY, '1');
    await open();
    expect(screen.queryByRole('switch', { name: 'Layout' })).toBeNull();
    expect(layer()).toBeNull();
  });

  it('hands focus to the Page tab when a page turn takes the focused switch away', async () => {
    await open();
    const s = screen.getByRole('switch', { name: 'Layout' });
    s.focus();
    /* Page 2 has no Layout: the switch goes. */
    await key('ArrowRight', s);
    expect(screen.queryByRole('switch', { name: 'Layout' })).toBeNull();
    expect(screen.getByTestId('slot')).toHaveAttribute('data-pdf-page', '2');
    const views = screen.getByRole('tablist', { name: 'How to read this page' });
    expect(document.activeElement).toBe(within(views).getByRole('tab', { selected: true }));
  });

  it('belongs to the Page view: Explain has neither the switch nor the layer', async () => {
    window.localStorage.setItem(LAYOUT_FACE_KEY, '1');
    await open();
    expect(layer()).not.toBeNull();
    await key('2');
    expect(screen.queryByRole('switch', { name: 'Layout' })).toBeNull();
    expect(layer()).toBeNull();
    await key('l');
    expect(window.localStorage.getItem(LAYOUT_FACE_KEY)).toBe('1');
  });
});

describe('the morph belongs to switching Layout on, not to turning pages', () => {
  /* The layers each animation was started on, in order. */
  let animated: Element[] = [];

  beforeEach(() => {
    animated = [];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: 640, height: 360, left: 0, top: 0, right: 640, bottom: 360, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    );
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: Element) {
      animated.push(this);
      return { playState: 'running', finish: () => {} };
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  it('plays when the switch is turned on', async () => {
    await open();
    fireEvent.click(screen.getByRole('switch', { name: 'Layout' }));
    expect(animated[0]).toBe(layer());
  });

  it('does not play on a page turn: the next page shows re-set at once, even after a page without a Layout', async () => {
    mock.layouts = new Map([
      [1, ready(1)],
      [2, ready(2)],
      [4, ready(4)],
    ]);
    await open();
    fireEvent.click(screen.getByRole('switch', { name: 'Layout' }));
    const entered = animated.length;
    expect(entered).toBeGreaterThan(0);
    await key('ArrowRight');
    expect(layer()).toHaveAttribute('data-layout-page', '2');
    await key('ArrowRight');
    expect(layer()).toBeNull();
    await key('ArrowRight');
    expect(layer()).toHaveAttribute('data-layout-page', '4');
    expect(animated.length).toBe(entered);
  });

  it('does not play again on coming back to the Page face', async () => {
    await open();
    fireEvent.click(screen.getByRole('switch', { name: 'Layout' }));
    const entered = animated.length;
    expect(entered).toBeGreaterThan(0);
    await key('2');
    expect(layer()).toBeNull();
    await key('1');
    expect(layer()).not.toBeNull();
    expect(animated.length).toBe(entered);
  });

  it('does not play when the Lesson opens with Layout left on', async () => {
    window.localStorage.setItem(LAYOUT_FACE_KEY, '1');
    await open();
    expect(layer()).not.toBeNull();
    expect(animated).toHaveLength(0);
  });

  it('switching off is instant: the layer is gone at once', async () => {
    await open();
    fireEvent.click(screen.getByRole('switch', { name: 'Layout' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Layout' }));
    expect(layer()).toBeNull();
  });
});
