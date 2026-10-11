import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import LibraryScreen from '../../screens/LibraryScreen';
import * as shelf from '../../mocks/shelf';
import { resetNotes } from '../../mocks/notes';
import { resetReanchors } from '../../mocks/reanchor';

const Probe = () => {
  const l = useLocation();
  return <p data-testid="loc">{l.pathname + l.search}</p>;
};

const at = (path = '/v4/library') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/library" element={<LibraryScreen />} />
      </Routes>
      <Probe />
    </MemoryRouter>,
  );

const settle = () =>
  act(async () => {
    vi.advanceTimersByTime(700);
  });
const loc = () => screen.getByTestId('loc').textContent ?? '';
const shelfList = () => screen.getByRole('list', { name: 'Your shelf' });
const coverNames = () =>
  within(shelfList())
    .queryAllByRole('link')
    .map((a) => a.getAttribute('aria-label') ?? '');

beforeEach(() => {
  vi.useFakeTimers();
  shelf.__reset();
  resetNotes();
  resetReanchors();
});
afterEach(() => {
  vi.useRealTimers();
  shelf.__reset();
});

describe('the shelf', () => {
  it('stands in Library chrome with the lede and no old doors', async () => {
    at();
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument();
    expect(
      screen.getByText('What you brought in, what you made of it, and what you shared.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Studio' })).toBeNull();
    expect(screen.queryByRole('link', { name: /How your work landed/ })).toBeNull();
  });

  it('renders a cover per item, named by file, state and progress', async () => {
    at();
    await settle();
    const names = coverNames();
    expect(names.length).toBe(shelf.getItems().length);
    expect(names).toContain(
      'Normalization.pdf, Shared in Database Systems, Read 6/12, Recall 9/31, 2 answers, 1 note',
    );
    expect(names.some((n) => n.startsWith('Design process — my notes.pdf, Only you'))).toBe(true);
    expect(names.some((n) => n.startsWith('Axioms cheat sheet.pdf, Draft in'))).toBe(true);
    const norm = within(shelfList()).getByRole('link', { name: /^Normalization\.pdf,/ });
    expect(norm).toHaveAttribute('href', '/v4/library/m/m-norm');
  });

  it('gives every cover a separate menu with Share (live) and Remove (not yet wired)', async () => {
    at();
    await settle();
    const more = screen.getByRole('button', { name: 'More for Normalization.pdf' });
    // Radix opens on pointerdown, not click.
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Share/ })).not.toHaveAttribute('aria-disabled');
    expect(within(menu).getByRole('menuitem', { name: /Remove/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('leaves the first cell for bringing something in', async () => {
    at();
    await settle();
    const first = within(shelfList()).getAllByRole('listitem')[0];
    expect(first).toHaveTextContent('Bring something in');
  });
});

describe('Continue', () => {
  it('picks up m-norm at page 6 of 12, as one link', async () => {
    at();
    await settle();
    const cont = screen.getByRole('link', { name: /Continue reading/ });
    expect(cont).toHaveAttribute('href', '/v4/library/m/m-norm');
    expect(cont).toHaveTextContent('Pick up where you left off · page 6 of 12');
    expect(cont).toHaveTextContent('Normalization.pdf');
    expect(cont.querySelector('img')?.getAttribute('src')).toBe('/v4-mock/studio/normalization-p6.webp');
  });

  it('turns the page into its summary on hover', async () => {
    at();
    await settle();
    const cont = screen.getByRole('link', { name: /Continue reading/ });
    expect(within(cont).queryByTestId('glance')).toBeNull();
    fireEvent.mouseEnter(cont);
    const glance = within(cont).getByTestId('glance');
    expect(glance.querySelectorAll('p').length).toBeGreaterThan(0);
    expect(glance.querySelectorAll('p').length).toBeLessThanOrEqual(2);
  });

  it('is not offered on Shared or Your words', async () => {
    at('/v4/library?f=shared');
    await settle();
    expect(screen.queryByRole('link', { name: /Continue reading/ })).toBeNull();
  });
});

describe('filters', () => {
  it('narrows to Shared and writes ?f=', async () => {
    at();
    await settle();
    const all = coverNames().length;
    fireEvent.click(screen.getByRole('tab', { name: /Shared/ }));
    await settle();
    expect(loc()).toContain('f=shared');
    const shared = coverNames();
    expect(shared.length).toBeLessThan(all);
    expect(shared.some((n) => n.includes('Only you'))).toBe(false);
    expect(screen.getByRole('tab', { name: /Shared/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('narrows to Reading and writes ?f=', async () => {
    shelf.markRead('m-norm', 12);
    at();
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: /Reading/ }));
    await settle();
    expect(loc()).toContain('f=reading');
    // Shared and fully read: nothing left to read.
    expect(coverNames().some((n) => n.startsWith('Normalization.pdf'))).toBe(false);
  });

  it('reads the filter from the URL', async () => {
    at('/v4/library?f=words');
    await settle();
    expect(screen.getByRole('tab', { name: /Your words/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('list', { name: 'Your shelf' })).toBeNull();
  });

  it('counts each filter', async () => {
    at();
    await settle();
    expect(screen.getByRole('tab', { name: /Everything/ })).toHaveTextContent(String(shelf.getItems().length));
  });
});

describe('search, sort and group appear from 9 items', () => {
  it('hides them on a small shelf', async () => {
    expect(shelf.getItems().length).toBeLessThan(9);
    at();
    await settle();
    expect(screen.queryByRole('searchbox', { name: 'Search your Library' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Group by Space' })).toBeNull();
  });

  it('searches a big shelf, writes ?q=, and / focuses the field', async () => {
    let n = 0;
    while (shelf.getItems().length < 10) shelf.bringIn(`Extra ${++n}.pdf`, `2026-09-0${n}T10:00:00Z`);
    at();
    await settle();
    const box = screen.getByRole('searchbox', { name: 'Search your Library' });
    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: 'axioms' } });
    await settle();
    expect(loc()).toContain('q=axioms');
    expect(coverNames()).toHaveLength(1);
    expect(coverNames()[0]).toMatch(/^Axioms cheat sheet\.pdf/);
  });

  it('sorts A–Z and groups by Space', async () => {
    let n = 0;
    while (shelf.getItems().length < 10) shelf.bringIn(`Extra ${++n}.pdf`, `2026-09-0${n}T10:00:00Z`);
    at();
    await settle();
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'az' } });
    const names = coverNames();
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    fireEvent.click(screen.getByRole('button', { name: 'Group by Space' }));
    expect(screen.getByRole('heading', { name: 'Only you' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Database Systems' })).toBeInTheDocument();
  });
});

describe('Your words', () => {
  it('lists your notes and your writing on the page, with deep links', async () => {
    at('/v4/library?f=words');
    await settle();
    expect(screen.getAllByRole('button', { name: /^Edit note:/ }).length).toBeGreaterThan(0);
    const deep = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => h.includes('#b-'));
    expect(deep).toContain('/v4/library/m/m-norm#b-w-1');
    const metas = [...document.querySelectorAll('p')].map((p) => p.textContent ?? '');
    expect(metas).toContain('Note · Normalization.pdf · page 2');
  });

  it('keeps orphan contributions under Needs a new home', async () => {
    at('/v4/library?f=words');
    await settle();
    expect(screen.getByRole('heading', { name: 'Needs a new home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Find it a new home/ })).toBeInTheDocument();
  });
});

describe('states', () => {
  it('turns an empty Library into one calm invitation', async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('mock', 'empty');
    window.history.replaceState({}, '', url);
    try {
      at();
      await settle();
      expect(screen.getByText(/Bring in your first file/)).toBeInTheDocument();
      expect(screen.queryByRole('tablist')).toBeNull();
    } finally {
      url.searchParams.delete('mock');
      window.history.replaceState({}, '', url);
    }
  });
});
