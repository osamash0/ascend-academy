import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';

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
    <MemoryRouter initialEntries={['/v4/library/studio/c/c-norm']}>
      <Routes>
        <Route path="/v4/library/studio/c/:canvasId" element={<StudioCanvasScreen />} />
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
    fireEvent.keyDown(window, { key: 'o' });
    fireEvent.keyUp(window, { key: 'o' });
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
