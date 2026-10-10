import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

const mount = async () => {
  const utils = render(
    <MemoryRouter initialEntries={['/v4/library/studio/c/c-norm']}>
      <Routes>
        <Route path="/v4/library/studio/c/:canvasId" element={<StudioCanvasScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => { vi.advanceTimersByTime(700); });
  return utils;
};
const run = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });

describe('Morph on the canvas', () => {
  it('a tap on the switch shows the originals', async () => {
    const { container } = await mount();
    const sw = screen.getByRole('switch', { name: 'Show source' });
    fireEvent.pointerDown(sw, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(sw, { pointerId: 1 });
    await run(400);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('img', { name: 'Page 2 of Normalization.pdf' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-view="original"]').length).toBeGreaterThan(0);
  });

  it('clicking a region flies back to that paragraph', async () => {
    const { container } = await mount();
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await run(400);
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      fireEvent.click(screen.getByRole('button', { name: /^Back to: Klausurrelevant/ }));
      await run(700);
      expect(screen.getByRole('switch', { name: 'Show source' })).toHaveAttribute('aria-checked', 'false');
      const landed = container.querySelector('[data-block-id="c-p2-hw"]');
      expect(landed).not.toBeNull();
      expect(scrolled).toContain(landed);
      expect(landed).toHaveAttribute('data-flash', 'true');
      await run(1300);
      expect(landed).not.toHaveAttribute('data-flash');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('adding a missing block puts it in your version', async () => {
    const { container } = await mount();
    const before = container.querySelectorAll('[data-block-id]').length;
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await run(400);
    fireEvent.click(screen.getAllByRole('button', { name: /^Not in your version: / })[0]);
    fireEvent.click(screen.getByRole('button', { name: /^Add to your version: / }));
    fireEvent.keyDown(window, { key: 'Escape' });
    await run(400);
    expect(container.querySelectorAll('[data-block-id]').length).toBe(before + 1);
  });

  it('gives layoutIds to the page you are on, and only to it', async () => {
    const { container } = await mount();
    const firstPage = container.querySelector<HTMLElement>('[data-view="clean"][data-page-anchor]')!.dataset.pageAnchor;
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await run(400);
    // jsdom has no layout, so the anchor falls back to the first page shown.
    const flying = Array.from(container.querySelectorAll('[data-view="original"] [data-morph="true"]'));
    expect(flying.length).toBeGreaterThan(0);
    for (const el of flying) {
      expect(el.closest('[data-page-anchor]')).toHaveAttribute('data-page-anchor', firstPage);
    }
  });

  it('flies back the page in view, already carrying its ids as it leaves', async () => {
    const { container } = await mount();
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await run(400);
    // While reading the original you scroll to page 4.
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const inView = this.matches('[data-view="original"][data-page-anchor="4"]');
      return { top: 0, bottom: inView ? 700 : 0, left: 0, right: 0, width: 0, height: inView ? 700 : 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    };
    try {
      fireEvent.keyDown(window, { key: 's' });
      fireEvent.keyUp(window, { key: 's' });
      // Same frame as the switch: the leaving page 4 overlays were remounted with ids.
      const leaving = container.querySelectorAll('[data-view="original"][data-page-anchor="4"] [data-morph="true"]');
      expect(leaving.length).toBeGreaterThan(0);
      expect(container.querySelectorAll('[data-view="original"][data-page-anchor="1"] [data-morph="true"]')).toHaveLength(0);
      await run(400);
      const page4 = container.querySelector('[data-view="clean"][data-page-anchor="4"]')!;
      const landing = page4.querySelectorAll('[data-extracted="true"]');
      expect(page4.querySelectorAll('[data-morph="true"]')).toHaveLength(landing.length);
      expect(container.querySelectorAll('[data-view="clean"] [data-morph="true"]')).toHaveLength(landing.length);
    } finally {
      Element.prototype.getBoundingClientRect = rect;
    }
  });

  it('clicking a region flies back the clicked region\'s page, not the one in view', async () => {
    const { container } = await mount();
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await run(400);
    // Page 2 is in view, but the region clicked is on page 4.
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const inView = this.matches('[data-view="original"][data-page-anchor="2"]');
      return { top: 0, bottom: inView ? 700 : 0, left: 0, right: 0, width: 0, height: inView ? 700 : 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    };
    try {
      const region = container.querySelector<HTMLElement>('[data-view="original"][data-page-anchor="4"] button[aria-label^="Back to"]')!;
      fireEvent.click(region);
      const leaving = container.querySelectorAll('[data-view="original"][data-page-anchor="4"] [data-morph="true"]');
      expect(leaving.length).toBeGreaterThan(0);
      expect(container.querySelectorAll('[data-view="original"][data-page-anchor="2"] [data-morph="true"]')).toHaveLength(0);
      await run(700);
      const page4 = container.querySelector('[data-view="clean"][data-page-anchor="4"]')!;
      expect(page4.querySelectorAll('[data-morph="true"]').length).toBeGreaterThan(0);
    } finally {
      Element.prototype.getBoundingClientRect = rect;
    }
  });

  it('with laid-out sections but none visible there is no flight and no scroll anchoring', async () => {
    const { container } = await mount();
    const rect = Element.prototype.getBoundingClientRect;
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    Element.prototype.getBoundingClientRect = function () {
      return { top: 5000, bottom: 5700, left: 0, right: 0, width: 0, height: 700, x: 0, y: 5000, toJSON() {} } as DOMRect;
    };
    try {
      fireEvent.keyDown(window, { key: 's' });
      fireEvent.keyUp(window, { key: 's' });
      expect(container.querySelectorAll('[data-morph="true"]')).toHaveLength(0);
      await run(400);
      expect(scrollBy).not.toHaveBeenCalled();
    } finally {
      Element.prototype.getBoundingClientRect = rect;
      scrollBy.mockRestore();
    }
  });
});
