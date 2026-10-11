import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import LibraryScreen from '../../screens/LibraryScreen';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';
import { To } from '../../studio/LibraryRedirects';
import * as shelf from '../../mocks/shelf';
import * as libraryMocks from '../../mocks/library';
import { resetNotes } from '../../mocks/notes';
import { resetReanchors } from '../../mocks/reanchor';
import { continueItem, type ShelfItem } from '../../studio/shelf';

/** The final fix round: one source for answers, honest sharing, links that land, focus that returns. */

const Probe = () => {
  const l = useLocation();
  return <p data-testid="loc">{l.pathname + l.search + l.hash}</p>;
};

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/library" element={<LibraryScreen />} />
        <Route path="/v4/library/m/:materialId" element={<StudioCanvasScreen />} />
        <Route path="/v4/library/studio" element={<To to="/v4/library" />} />
        <Route path="/v4/space/:spaceId/lesson/:lessonId" element={<p>lesson</p>} />
      </Routes>
      <Probe />
      <Link to="/v4/library">shelf link</Link>
    </MemoryRouter>,
  );

const run = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });
const settle = () => run(700);
const item = (id: string) => shelf.getItems().find((i) => i.id === id)!;
const woven = () => Array.from(document.querySelectorAll('[data-woven]')).map((e) => e.getAttribute('data-block-id'));
const loc = () => screen.getByTestId('loc').textContent ?? '';
const openMenu = async (button: HTMLElement) => {
  fireEvent.pointerDown(button, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await run(50);
};
const ask = async (q: string) => {
  const box = screen.getByRole('textbox', { name: 'Ask about this Material' });
  fireEvent.change(box, { target: { value: q } });
  fireEvent.submit(box.closest('form')!);
  await run(700);
};

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
  window.history.replaceState({}, '', '/');
});

describe('1 · answers have one source', () => {
  it('the seed agrees: m-norm says 2 answers and its page shows 2', async () => {
    expect(item('m-norm').progress.answers).toBe(2);
    at('/v4/library/m/m-norm');
    await settle();
    expect(woven()).toHaveLength(2);
  });

  it('an asked answer survives leaving the page, and the cover count matches', async () => {
    at('/v4/library/m/m-norm');
    await settle();
    await ask('Why does repeated data cause problems?');
    expect(woven()).toHaveLength(3);
    fireEvent.click(screen.getByRole('link', { name: 'shelf link' }));
    await settle();
    expect(
      within(screen.getByRole('list', { name: 'Your shelf' })).getByRole('link', { name: /^Normalization\.pdf,.*3 answers/ }),
    ).toBeInTheDocument();
    expect(item('m-norm').progress.answers).toBe(3);
  });

  it('a sample item has its own page: nothing of m-norm’s, and its answers stay its own', async () => {
    at('/v4/library/m/m-design-notes');
    await settle();
    expect(woven()).toHaveLength(0);
    await ask('Why does repeated data cause problems?');
    expect(item('m-design-notes').progress.answers).toBe(1);
    expect(item('m-norm').progress.answers).toBe(2);
    expect(shelf.canvasFor('m-norm')!.blocks.filter((b) => b.origin === 'generated')).toHaveLength(2);
  });

  it('Your words lists the same answers, each linking to its own page', async () => {
    shelf.saveCanvas(
      'm-design-notes',
      (() => {
        const base = shelf.canvasFor('m-norm')!;
        const ans = base.blocks.find((b) => b.origin === 'generated')!;
        return { ...base, blocks: [{ ...ans, id: 'mine-1' }] };
      })(),
    );
    at('/v4/library?f=words');
    await settle();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    const seeded = shelf.canvasFor('m-norm')!.blocks.filter((b) => b.origin === 'generated');
    for (const b of seeded) expect(links).toContain(`/v4/library/m/m-norm#b-${b.id}`);
    expect(links).toContain('/v4/library/m/m-design-notes#b-mine-1');
  });
});

describe('2 · Your words links land on their block', () => {
  it('scrolls to, focuses and flashes the block named in the hash, not the last page', async () => {
    const id = shelf.canvasFor('m-norm')!.blocks.find((b) => b.origin === 'generated')!.id;
    at(`/v4/library/m/m-norm#b-${id}`);
    await settle();
    const el = document.querySelector(`[data-block-id="${id}"]`) as HTMLElement;
    expect(scrolled).toContain(el);
    expect(document.activeElement).toBe(el);
    expect(el).toHaveAttribute('data-flash', 'true');
    expect(screen.queryByText('Back on page 6')).toBeNull();
  });
});

describe('3 · Share is honest about a file not ready yet', () => {
  it('the page offers no Share for a developing file, and says why', async () => {
    const id = shelf.bringIn('Fresh.pdf');
    at(`/v4/library/m/${id}`);
    await settle();
    const button = screen.getByRole('button', { name: 'Share' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('It can be shared once it’s ready.');
  });

  it('store share reports whether it shared', () => {
    const id = shelf.bringIn('Fresh.pdf');
    expect(shelf.share(id, 's-dbs', 'member', 'guided')).toBe(false);
    shelf.settleDeveloping(id, true);
    expect(shelf.share(id, 's-dbs', 'member', 'guided')).toBe(true);
  });
});

describe('4 · one set of share actions', () => {
  it('a shared cover’s menu opens its Space and can take it back; it never re-shares', async () => {
    at('/v4/library');
    await settle();
    await openMenu(screen.getByRole('button', { name: 'More for Normalization.pdf' }));
    expect(screen.getByRole('menuitem', { name: 'Open in Database Systems' })).toHaveAttribute('href', '/v4/space/s-dbs');
    expect(screen.getByRole('menuitem', { name: 'Take back to only you' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Share' })).toBeNull();
  });

  it('a drafted cover’s menu publishes', async () => {
    at('/v4/library');
    await settle();
    await openMenu(screen.getByRole('button', { name: 'More for Axioms cheat sheet.pdf' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Publish to Intro to Linear Algebra' }));
    expect(item('m-axioms').share.kind).toBe('shared');
  });

  it('the store never re-shares: likes stay', () => {
    expect(shelf.share('m-norm', 's-linalg', 'owner', 'open')).toBe(false);
    expect(item('m-norm').share).toMatchObject({ kind: 'shared', spaceId: 's-dbs', likes: 3 });
  });
});

describe('5 · a Lesson-backed cover never becomes Continue', () => {
  it('opening it does not touch it', async () => {
    const lesson = shelf.getItems().find((i) => i.opens.kind === 'lesson')!;
    at(`/v4/library/m/${lesson.id}`);
    await settle();
    expect(item(lesson.id).lastOpenedAt).toBeNull();
  });

  it('continueItem wants a canvas with a cover', () => {
    const base = item('m-norm');
    const lessonItem: ShelfItem = {
      ...base,
      id: 'x',
      cover: '',
      opens: { kind: 'lesson', spaceId: 's-dbs', lessonId: 'l-s-dbs-4' },
      lastOpenedAt: '2030-01-01T00:00:00Z',
    };
    expect(continueItem([base, lessonItem])?.id).toBe('m-norm');
  });
});

describe('6 · development outlives the cover', () => {
  it('a file opened mid-development still settles', async () => {
    const id = shelf.bringIn('Fresh.pdf');
    at(`/v4/library/m/${id}`);
    await run(4000);
    expect(item(id).stage).toBe('ready');
  });

  it('bringing in on a filter that hides it shows Everything', async () => {
    at('/v4/library?f=shared');
    await settle();
    fireEvent.change(screen.getByLabelText('Bring something in'), {
      target: { files: [new File(['x'], 'Hidden.pdf', { type: 'application/pdf' })] },
    });
    await run(50);
    expect(loc()).not.toContain('f=shared');
    expect(screen.getByRole('link', { name: /^Hidden\.pdf, Developing…/ })).toBeInTheDocument();
  });

  it('the “· ready” pulse clears after about two seconds', async () => {
    at('/v4/library');
    await settle();
    shelf.bringIn('Pulse.pdf');
    await run(3400);
    expect(screen.getByText(/· ready/)).toBeInTheDocument();
    await run(2200);
    expect(screen.queryByText(/· ready/)).toBeNull();
  });
});

describe('7 · Back returns focus to the cover you opened', () => {
  it('focuses the cover link on the way back', async () => {
    at('/v4/library');
    await settle();
    const cover = within(screen.getByRole('list', { name: 'Your shelf' })).getByRole('link', {
      name: /^Design process/,
    });
    fireEvent.click(cover);
    await run(700);
    expect(loc()).toBe('/v4/library/m/m-design-notes');
    await settle();
    fireEvent.click(screen.getByRole('link', { name: 'Back to Library' }));
    await settle();
    expect(document.activeElement?.getAttribute('href')).toBe('/v4/library/m/m-design-notes');
  });
});

describe('minors', () => {
  it('markRead clamps lastPage to the page count', () => {
    shelf.markRead('m-axioms', 40);
    expect(item('m-axioms').lastPage).toBeLessThanOrEqual(item('m-axioms').pageCount);
  });

  it('sample items count the pages they open', () => {
    for (const i of shelf.getItems().filter((x) => x.sample)) expect(i.pageCount).toBe(12);
  });

  it('a redirect keeps the query (?mock=)', async () => {
    at('/v4/library/studio?mock=empty');
    await settle();
    expect(loc()).toBe('/v4/library?mock=empty');
  });

  it('← → do not turn pages while a menu is open', async () => {
    at('/v4/library/m/m-norm');
    await settle();
    const before = item('m-norm').lastPage;
    await openMenu(screen.getByRole('button', { name: /^Shared/ }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowRight' });
    await run(300);
    expect(item('m-norm').lastPage).toBe(before);
  });

  it('Your words uses no colour for a note’s rule', async () => {
    at('/v4/library?f=words');
    await settle();
    expect(document.querySelector('[class*="indigo"]')).toBeNull();
  });

  it('the retired pending-uploads seam is gone', () => {
    expect('pendingUploads' in libraryMocks).toBe(false);
  });
});
