import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import LibraryScreen from '../../screens/LibraryScreen';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';
import * as shelf from '../../mocks/shelf';
import { resetNotes } from '../../mocks/notes';
import { resetReanchors } from '../../mocks/reanchor';

/** One Library §5.4–5.5: the cover becomes the page, and the page says where it stands. */

const Probe = () => {
  const l = useLocation();
  const from = (l.state as { from?: string } | null)?.from ?? '';
  return <p data-testid="loc">{`${l.pathname}|${from}`}</p>;
};

type Entry = string | { pathname: string; state: unknown };
const at = (entry: Entry) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/v4/library" element={<LibraryScreen />} />
        <Route path="/v4/library/m/:materialId" element={<StudioCanvasScreen />} />
      </Routes>
      <Probe />
    </MemoryRouter>,
  );

const run = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });
const loc = () => screen.getByTestId('loc').textContent ?? '';
const journey = () => screen.getByRole('list', { name: 'Where this page is' });
const step = (name: string) => within(journey()).getByText(name).closest('li')!;

let scrolled: Element[] = [];
const into = Element.prototype.scrollIntoView;

beforeEach(() => {
  vi.useFakeTimers();
  shelf.__reset();
  resetNotes();
  resetReanchors();
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});
afterEach(() => {
  vi.useRealTimers();
  shelf.__reset();
  localStorage.clear();
  Element.prototype.scrollIntoView = into;
});

describe('the zoom-through', () => {
  it('clicking a cover plays first, then opens the page with the shelf as its origin', async () => {
    at('/v4/library');
    await run(700);
    const list = screen.getByRole('list', { name: 'Your shelf' });
    const cover = within(list).getByRole('link', { name: /^Normalization\.pdf,/ });
    const notPrevented = fireEvent.click(cover);
    expect(notPrevented).toBe(false);
    expect(screen.getByTestId('zoom-through')).toBeInTheDocument();
    expect(loc()).toBe('/v4/library|');
    await run(600);
    expect(loc()).toBe('/v4/library/m/m-norm|shelf');
  });

  it('the Continue card zooms through the same way', async () => {
    at('/v4/library');
    await run(700);
    fireEvent.click(screen.getByRole('link', { name: /Continue reading/ }));
    await run(600);
    expect(loc()).toBe('/v4/library/m/m-norm|shelf');
  });

  it('⌘-click keeps the link a link (a new tab), with no zoom', async () => {
    at('/v4/library');
    await run(700);
    const list = screen.getByRole('list', { name: 'Your shelf' });
    const cover = within(list).getByRole('link', { name: /^Normalization\.pdf,/ });
    fireEvent.click(cover, { metaKey: true });
    expect(screen.queryByTestId('zoom-through')).toBeNull();
    await run(600);
    expect(loc()).toBe('/v4/library|');
  });
});

describe('the page header', () => {
  it('reads Library · filename, with Share saying where the page stands', async () => {
    at('/v4/library/m/m-norm');
    await run(700);
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumb).getByRole('link', { name: 'Library' })).toHaveAttribute('href', '/v4/library');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Normalization.pdf');
    expect(screen.getByRole('button', { name: 'Shared · 3 likes' })).toBeInTheDocument();
  });

  it('a draft says where it is drafted', async () => {
    at('/v4/library/m/m-axioms');
    await run(700);
    expect(screen.getByRole('button', { name: 'Draft in Intro to Linear Algebra' })).toBeInTheDocument();
  });

  it('a private page offers Share', async () => {
    at('/v4/library/m/m-design-notes');
    await run(700);
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });
});

describe('the Journey', () => {
  it('m-norm: shared and landed', async () => {
    at('/v4/library/m/m-norm');
    await run(700);
    expect(within(journey()).getAllByRole('listitem')).toHaveLength(4);
    expect(step('Brought in')).toHaveAttribute('data-state', 'done');
    expect(step('Shared')).toHaveAttribute('data-state', 'done');
    expect(step('Landed')).toHaveAttribute('data-state', 'done');
    expect(step('Shared')).toHaveTextContent(/done/);
  });

  it('a draft: Shared is where you are now', async () => {
    at('/v4/library/m/m-axioms');
    await run(700);
    expect(step('Shared')).toHaveAttribute('data-state', 'now');
    expect(step('Shared')).toHaveTextContent(/now/);
    expect(step('Landed')).toHaveAttribute('data-state', 'todo');
  });
});

describe('your place', () => {
  it('opened from the shelf: fades in, scrolls to the last page, says "Back on page 6" for 4 s', async () => {
    at({ pathname: '/v4/library/m/m-norm', state: { from: 'shelf' } });
    await run(700);
    const six = document.querySelector('[data-view="clean"][data-page-anchor="6"]');
    expect(six).not.toBeNull();
    expect(scrolled).toContain(six);
    expect(screen.getByText('Back on page 6')).toBeInTheDocument();
    await run(4100);
    expect(screen.queryByText('Back on page 6')).toBeNull();
  });

  it('a page never read past page 1 opens at the top, with the usual hint', async () => {
    at('/v4/library/m/m-design-notes');
    await run(700);
    expect(scrolled).toHaveLength(0);
    expect(screen.queryByText(/Back on page/)).toBeNull();
  });
});
