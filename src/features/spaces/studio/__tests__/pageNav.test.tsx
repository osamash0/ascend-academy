import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';
import { PageRail } from '../components/PageRail';
import { PagerPill } from '../components/PagerPill';
import { pagesInView } from '../geometry';
import type { PageGroup } from '../geometry';
import { usePageNav } from '../usePageNav';
import type { CanvasView } from '../useMorph';
import type { SourcePage } from '../types';

let scrolled: Element[] = [];
const original = Element.prototype.scrollIntoView;

beforeEach(() => {
  vi.useFakeTimers();
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  Element.prototype.scrollIntoView = original;
  document.body.innerHTML = '';
});

const mount = async () => {
  const utils = render(
    <MemoryRouter initialEntries={['/v4/library/m/m-norm']}>
      <Routes>
        <Route path="/v4/library/m/:materialId" element={<StudioCanvasScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => { vi.advanceTimersByTime(700); });
  return utils;
};
const pager = () => screen.getByRole('group', { name: 'Page' });
const lastScrolled = () => scrolled[scrolled.length - 1] as HTMLElement | undefined;

describe('the pager', () => {
  it('next and previous move the current page and scroll to it', async () => {
    await mount();
    expect(pager()).toHaveTextContent(/^1 \/ \d+$/);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(pager()).toHaveTextContent(/^2 \//);
    expect(lastScrolled()).toHaveAttribute('data-view', 'clean');
    expect(lastScrolled()).toHaveAttribute('data-page-anchor', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(pager()).toHaveTextContent(/^1 \//);
    expect(lastScrolled()).toHaveAttribute('data-page-anchor', '1');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });

  it('← and → turn pages', async () => {
    await mount();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(pager()).toHaveTextContent(/^3 \//);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(pager()).toHaveTextContent(/^2 \//);
    expect(lastScrolled()).toHaveAttribute('data-page-anchor', '2');
  });

  it('ignores the arrows while typing or inside a dialog', async () => {
    await mount();
    const input = document.body.appendChild(document.createElement('input'));
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    const inside = dialog.appendChild(document.createElement('button'));
    fireEvent.keyDown(inside, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight', metaKey: true });
    expect(pager()).toHaveTextContent(/^1 \//);
    expect(scrolled).toHaveLength(0);
  });

  it('turns pages in the view you are in', async () => {
    await mount();
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await act(async () => { vi.advanceTimersByTime(400); });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(lastScrolled()).toHaveAttribute('data-view', 'original');
    expect(lastScrolled()).toHaveAttribute('data-page-anchor', '2');
  });
});

describe('the contents rail', () => {
  it('has one entry per page, and a click goes to that page', async () => {
    const { container } = await mount();
    const rail = screen.getByRole('navigation', { name: 'Pages of this Material' });
    const entries = within(rail).getAllByRole('button');
    const sections = container.querySelectorAll('[data-view="clean"][data-page-anchor]');
    expect(entries).toHaveLength(sections.length);
    expect(entries[0]).toHaveAttribute('aria-current', 'location');

    fireEvent.click(entries[3]);
    expect(lastScrolled()).toHaveAttribute('data-page-anchor', (sections[3] as HTMLElement).dataset.pageAnchor);
    expect(entries[3]).toHaveAttribute('aria-current', 'location');
    expect(entries[0]).not.toHaveAttribute('aria-current');
    expect(pager()).toHaveTextContent(new RegExp(`^${(sections[3] as HTMLElement).dataset.pageAnchor} /`));
  });

  it('labels each entry with its page number and first words', async () => {
    await mount();
    const rail = screen.getByRole('navigation', { name: 'Pages of this Material' });
    const first = within(rail).getAllByRole('button')[0];
    expect(first.textContent).toMatch(/^1\S/);
    expect(first.textContent!.length).toBeGreaterThan(2);
  });
});

/** Lay out sections: `boxes[page] = [top, bottom]` for `view`; everything else has no box. */
const layout = (view: CanvasView, boxes: Record<number, [number, number]>) => {
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const el = this as HTMLElement;
    const box = el.dataset.view === view && el.dataset.pageAnchor ? boxes[Number(el.dataset.pageAnchor)] : undefined;
    const [top, bottom] = box ?? [0, 0];
    return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON() {} } as DOMRect;
  };
  return () => { Element.prototype.getBoundingClientRect = rect; };
};
const run = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
const railEntry = (page: number) =>
  within(screen.getByRole('navigation', { name: 'Pages of this Material' }))
    .getAllByRole('button')
    .find((b) => b.textContent!.startsWith(String(page)))!;

describe('following the scroll', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the rail and the counter follow the page that fills the screen', async () => {
    await mount();
    const restore = layout('clean', { 3: [-200, 100], 4: [100, 900] });
    try {
      fireEvent.scroll(window);
      await run(20);
      expect(pager()).toHaveTextContent(/^4 \//);
      expect(railEntry(4)).toHaveAttribute('aria-current', 'location');
      expect(railEntry(1)).not.toHaveAttribute('aria-current');
    } finally {
      restore();
    }
  });

  it('ignores the turn\'s own scroll, then picks up where you ended up once it settles', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(pager()).toHaveTextContent(/^2 \//);
    // You scrolled on, during the turn: page 5 fills the screen, page 2 is gone.
    const restore = layout('clean', { 5: [0, 800] });
    try {
      fireEvent.scroll(window);
      await run(100);
      fireEvent.scroll(window);
      await run(100);
      expect(pager()).toHaveTextContent(/^2 \//);
      await run(100); // 150ms after the last scroll: settled, one check runs
      expect(pager()).toHaveTextContent(/^5 \//);
      expect(railEntry(5)).toHaveAttribute('aria-current', 'location');
    } finally {
      restore();
    }
  });

  it('keeps a short page you turned to, even when its neighbour fills more of the screen', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    const restore = layout('clean', { 2: [100, 300], 3: [300, 900] });
    try {
      fireEvent.scroll(window);
      await run(1000);
      expect(pager()).toHaveTextContent(/^2 \//);
    } finally {
      restore();
    }
  });
});

describe('notes above page 1', () => {
  const page = (n: number): SourcePage => ({
    materialId: 'm', page: n, width: 1, height: 1, imageUrl: '', geometry: 'page', blocks: [],
  });
  const PAGES = [page(1), page(2)];
  const GROUPS: PageGroup[] = [
    { materialId: '', page: 0, blocks: [{ id: 'w', origin: 'written', markdown: 'My plan' }] },
    { materialId: 'm', page: 1, blocks: [{ id: 'a', origin: 'extracted', markdown: '# One', source: { materialId: 'm', page: 1, blockIds: [] }, edited: false }] },
    { materialId: 'm', page: 2, blocks: [{ id: 'b', origin: 'extracted', markdown: '# Two', source: { materialId: 'm', page: 2, blockIds: [] }, edited: false }] },
  ];
  /** The screen's wiring, without the screen: the notes stay clean in Original, as the canvas renders them. */
  function Harness({ view }: { view: CanvasView }) {
    const viewPages = pagesInView(GROUPS, PAGES, view);
    const nav = usePageNav(viewPages, view);
    return (
      <>
        {GROUPS.map((g) => (
          <section key={g.page} data-view={g.page === 0 ? 'clean' : view} data-page-anchor={g.page} />
        ))}
        <PageRail groups={GROUPS.filter((g) => viewPages.includes(g.page))} current={nav.current} onPage={nav.go} />
        <PagerPill
          current={nav.counter}
          last={nav.last}
          canBack={nav.index > 0}
          canForward={nav.index >= 0 && nav.index < viewPages.length - 1}
          hint={null}
          onStep={nav.step}
        />
      </>
    );
  }
  const rail = () => within(screen.getByRole('navigation', { name: 'Pages of this Material' })).getAllByRole('button');

  it('in Original they are not a stop: stepping skips them, and rail and counter agree', () => {
    render(<Harness view="original" />);
    expect(rail().map((b) => b.textContent)).toEqual(['1One', '2Two']);
    expect(pager()).toHaveTextContent('1 / 2');
    expect(rail()[0]).toHaveAttribute('aria-current', 'location');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(pager()).toHaveTextContent('1 / 2');
    expect(scrolled).toHaveLength(0);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(pager()).toHaveTextContent('1 / 2');
    expect(rail()[0]).toHaveAttribute('aria-current', 'location');
    expect(lastScrolled()).toHaveAttribute('data-view', 'original');
    expect(lastScrolled()).toHaveAttribute('data-page-anchor', '1');
  });

  it('in Clean they are a stop, and the counter never says 0', () => {
    const { rerender } = render(<Harness view="clean" />);
    expect(rail()).toHaveLength(3);
    expect(rail()[0]).toHaveAttribute('aria-current', 'location');
    expect(pager()).toHaveTextContent('1 / 2');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    // Switching to Original while on the notes lands you on page 1, everywhere at once.
    rerender(<Harness view="original" />);
    expect(rail()).toHaveLength(2);
    expect(rail()[0]).toHaveAttribute('aria-current', 'location');
    expect(pager()).toHaveTextContent('1 / 2');
  });
});
