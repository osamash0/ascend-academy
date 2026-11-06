import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within, cleanup } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, type RefObject } from 'react';
import LessonFacesScreen from '../../screens/LessonFacesScreen';
import { __dropCurtain, curtainUp, holdCurtain } from '../reader/curtain';

/*
 * The file itself is not rendered here: react-pdf needs a canvas and a worker
 * that happy-dom does not have. The document is a stand-in that owns the
 * scroll ref, and a jump is recorded rather than performed.
 */
const jumps: number[] = [];
let mockAspect = 405 / 720;
/* How many pages the stand-in pager says the file has; 0 keeps it silent (no timeline). */
let mockPages = 0;
const scrolled: number[] = [];
/* The scroll's page reports, driven by hand; and what the reading count was handed, render by render. */
let scrollReports: ((page: number) => void) | undefined;
/* A page of the scroll painting, driven by hand. */
let paintPage: (page: number) => void = () => {};
const counted: { page: number; notATurn?: { current: number | null } }[] = [];
vi.mock('../../data/reading', async (original) => ({
  ...(await original<typeof import('../../data/reading')>()),
  useReadingProgress: (_lesson: string | undefined, page: number, _live: boolean, _covered?: boolean, notATurn?: { current: number | null }) => {
    counted.push({ page, notATurn });
  },
}));
vi.mock('@/components/pdf', () => ({
  PdfPage: ({ page }: { page: number }) => <div data-testid="sheet" data-page={page} />,
  PdfPager: ({ rootRef, page, overlay, onAspect, onLoad, onFirstRender }: { rootRef: RefObject<HTMLDivElement>; page: number; overlay?: { props?: { words?: string | null } }; onAspect?: (a: number) => void; onLoad?: (n: number) => void; onFirstRender?: (c: HTMLCanvasElement | null) => void }) => {
    jumps.push(page);
    useEffect(() => {
      onAspect?.(mockAspect);
      if (mockPages) onLoad?.(mockPages);
      /* The first paint, a canvas of the file's own shape. */
      const c = document.createElement('canvas');
      c.width = 1000;
      c.height = Math.round(1000 * mockAspect);
      onFirstRender?.(c);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    /* The words the Spotlight would light, recorded rather than drawn. */
    return (
      <div ref={rootRef} data-testid="document" data-spot={overlay?.props?.words ?? ''}>
        Page {page}
      </div>
    );
  },
  PdfScroll: ({ scrollRef, onPage, onLoad, onFirstRender, onRenderPage }: { scrollRef: RefObject<HTMLDivElement>; onPage?: (p: number) => void; onLoad?: (n: number) => void; onFirstRender?: (c: null) => void; onRenderPage?: (p: number) => void }) => {
    scrollReports = onPage;
    paintPage = (p) => onRenderPage?.(p);
    /* Like the real one: the file opens first, the first page paints later. */
    useEffect(() => {
      onLoad?.(10);
      const t = setTimeout(() => {
        scrolled.push(-1); // marker: first render
        onRenderPage?.(1);
        onFirstRender?.(null);
      }, 50);
      return () => clearTimeout(t);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <div ref={scrollRef} data-testid="scroll" />;
  },
  scrollToPdfPage: (_c: HTMLElement, page: number) => {
    scrolled.push(page);
  },
  pdfPageId: (p: number) => `pdf-page-${p}`,
  sampleAccent: () => null,
  warmPdfWorker: () => {},
}));

const renderFaces = async (path = '/v4/space/s-dbs/lesson/l-s-dbs-4/faces') => {
  jumps.length = 0;
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/space/:spaceId/lesson/:lessonId/faces" element={<LessonFacesScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  /* The pager, or the scroll that replaces it for a portrait file. */
  await waitFor(() => expect(screen.queryByTestId('document') ?? screen.queryByTestId('scroll')).not.toBeNull(), { timeout: 4000 });
  await act(async () => {});
  return utils;
};

const pageLine = () => screen.getByTestId('document');
/* The lecture's ideas, as segments of the strip on the slide's top edge. */
const spineTick = (name: string) =>
  [...screen.getByRole('navigation', { name: 'Ideas in this Lesson' }).querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.getAttribute('aria-label')?.startsWith(`${name}, `),
  )!;

describe('the document, and nothing else', () => {
  it('opens on the document with the exit, the spine and the page line', async () => {
    await renderFaces();
    expect(screen.getByTestId('document')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Leave the reader' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Ideas in this Lesson' })).toBeInTheDocument();
    expect(pageLine()).toHaveTextContent('Page 1');
    expect(screen.getByText(/← → turns the page/)).toBeInTheDocument();
  });

  it('has no studio, no tablist but the view switch, and no ask bar until asked', async () => {
    await renderFaces();
    expect(screen.queryByRole('complementary', { name: 'Studio' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Explain' })).toBeNull();
    expect(screen.getAllByRole('tablist').map((t) => t.getAttribute('aria-label'))).toEqual(['How to read this page']);
    expect(screen.queryByPlaceholderText('Ask about this Lesson')).toBeNull();
    expect(screen.queryByRole('button', { name: /Notes for/ })).toBeNull();
  });

  it('draws one spine tick per Concept, in the order the file explains them', async () => {
    await renderFaces();
    const nav = screen.getByRole('navigation', { name: 'Ideas in this Lesson' });
    expect([...nav.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')?.split(',')[0])).toEqual([
      'Functional dependency',
      'BCNF',
      '1NF',
      '2NF',
      '3NF',
    ]);
    expect(spineTick('Functional dependency').getAttribute('aria-current')).toBe('location');
  });

  it('scrolls the document to a Concept’s first page from the spine', async () => {
    await renderFaces();
    fireEvent.click(spineTick('1NF'));
    await waitFor(() => expect(pageLine()).toHaveTextContent('Page 67'));
    expect(jumps).toContain(67);
    expect(spineTick('1NF').getAttribute('aria-current')).toBe('location');
  });
});

describe('the studio is a layer above the document', () => {
  it('opens from the Text view, at the current page, and closes on Escape', async () => {
    await renderFaces();
    fireEvent.click(screen.getByRole('tab', { name: 'Text' }));
    const studio = await screen.findByRole('complementary', { name: 'Studio' });
    expect(within(studio).getAllByText('Functional dependency')[0]).toBeInTheDocument();
    expect(within(studio).getByText('Page 1')).toBeInTheDocument();
    expect(within(studio).getByRole('region', { name: 'The text' })).toBeInTheDocument();
    // The marks are on inside the studio: it is the earned layer.
    expect(within(studio).getAllByRole('button', { name: /Notes for/ }).length).toBeGreaterThan(0);
    // The hint has done its job.
    expect(screen.queryByText(/Select words to ask/)).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Studio' })).toBeNull());
    // The document is still there underneath.
    expect(screen.getByTestId('document')).toBeInTheDocument();
  });

  it('toggles on the keyboard', async () => {
    await renderFaces();
    fireEvent.keyDown(window, { key: '\\' });
    expect(await screen.findByRole('complementary', { name: 'Studio' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '\\' });
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Studio' })).toBeNull());
  });

  it('opens the notes inside the studio from a heading, and Escape peels the notes before the studio', async () => {
    await renderFaces();
    fireEvent.keyDown(window, { key: '\\' });
    const studio = await screen.findByRole('complementary', { name: 'Studio' });
    fireEvent.click(within(studio).getAllByRole('button', { name: /Notes for/ })[0]);
    const card = await screen.findByRole('complementary', { name: 'Notes · Normalization' });
    expect(within(card).getByRole('button', { name: 'Write a note' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Notes · Normalization' })).toBeNull());
    expect(screen.getByRole('complementary', { name: 'Studio' })).toBeInTheDocument();
  });

  it('opens the page in the document from a page chip in the text', async () => {
    await renderFaces();
    fireEvent.keyDown(window, { key: '\\' });
    const studio = await screen.findByRole('complementary', { name: 'Studio' });
    fireEvent.click(within(studio).getByRole('button', { name: 'Page 6 of the Material' }));
    await waitFor(() => expect(pageLine()).toHaveTextContent('Page 6'));
    expect(jumps).toContain(6);
  });

  it('takes the reading to the workbench and back, and the studio waits underneath', async () => {
    await renderFaces();
    fireEvent.keyDown(window, { key: '\\' });
    const studio = await screen.findByRole('complementary', { name: 'Studio' });
    fireEvent.click(within(studio).getByRole('button', { name: 'Practise what you just read' }));
    expect(await screen.findByRole('region', { name: 'Practice' })).toBeInTheDocument();
    // The studio leaves with its exit animation, so it is gone a beat later.
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Studio' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Back to reading' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Practice' })).toBeNull());
    expect(await screen.findByRole('complementary', { name: 'Studio' })).toBeInTheDocument();
  });
});

describe('a Lesson with nothing to read', () => {
  it('says so, and offers the way back', async () => {
    render(
      <MemoryRouter initialEntries={['/v4/space/s-dbs/lesson/l-s-dbs-3/faces']}>
        <Routes>
          <Route path="/v4/space/:spaceId/lesson/:lessonId/faces" element={<LessonFacesScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Nothing to read yet', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the Lesson' })).toBeInTheDocument();
  });
});

describe('Explain answers the page as an interface', () => {
  it('composes an answer for the page in view', async () => {
    await renderFaces();
    fireEvent.click(screen.getByRole('tab', { name: 'Explain' }));
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    expect(within(panel).getByText('Page 1')).toBeInTheDocument();
    expect(screen.getByTestId('document')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Explain' })).toHaveAttribute('aria-selected', 'true');
  });

  it('follows the document: a new page is a new answer', async () => {
    await renderFaces();
    fireEvent.click(screen.getByRole('tab', { name: 'Explain' }));
    const panel = await screen.findByRole('complementary', { name: 'Explain' });
    fireEvent.click(spineTick('1NF'));
    await waitFor(() =>
      expect(within(panel).getByText('A ladder: each rung forbids one more kind of redundancy')).toBeInTheDocument(),
    );
  });
});

describe('another Lesson, opened in place', () => {
  it('opens at the page and the words it was asked for (a search hit, a Luna move)', async () => {
    let go: (to: string) => void = () => {};
    let at = '';
    const Nav = () => {
      go = useNavigate();
      const loc = useLocation();
      at = loc.pathname + loc.search;
      return null;
    };
    jumps.length = 0;
    render(
      <MemoryRouter initialEntries={['/v4/space/s-dbs/lesson/l-s-dbs-3/faces']}>
        <Nav />
        <Routes>
          <Route path="/v4/space/:spaceId/lesson/:lessonId/faces" element={<LessonFacesScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Nothing to read yet', {}, { timeout: 4000 });
    await act(async () => go('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=2&spot=relation'));
    await screen.findByTestId('document', {}, { timeout: 4000 });
    await waitFor(() => expect(pageLine()).toHaveTextContent('Page 2'));
    expect(pageLine()).toHaveAttribute('data-spot', 'relation');
  });
});

describe('Explain and Text replace the page', () => {
  it('Explain covers the whole stage instead of docking beside the page', async () => {
    await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?view=explain');
    const layer = await screen.findByRole('complementary', { name: 'Explain' });
    expect(layer).toHaveAttribute('data-mode', 'replace');
  });

  it('Text covers the whole stage too', async () => {
    await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?view=text');
    const layer = await screen.findByRole('complementary');
    expect(layer).toHaveAttribute('data-mode', 'replace');
  });

  it('keeps the view switch above the layer, and Page brings the page back', async () => {
    await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?view=explain');
    const layer = await screen.findByRole('complementary', { name: 'Explain' });
    const pageTab = screen.getByRole('tab', { name: 'Page' });
    expect(pageTab.closest('div.absolute')).toHaveClass('z-[43]');
    fireEvent.click(pageTab);
    await waitFor(() => expect(layer).not.toBeInTheDocument());
    expect(screen.queryByRole('complementary', { name: 'Explain' })).toBeNull();
  });

  it('has no close button of its own; Escape still closes it and returns the page', async () => {
    await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?view=explain');
    const layer = await screen.findByRole('complementary', { name: 'Explain' });
    expect(within(layer).queryByRole('button', { name: /close|schließen/i })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(layer).not.toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Page' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('the face keys', () => {
  it('2 opens Explain, 1 returns to the page', async () => {
    await renderFaces();
    fireEvent.keyDown(window, { key: '2' });
    expect(await screen.findByRole('tab', { name: 'Explain', selected: true })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '1' });
    expect(await screen.findByRole('tab', { name: 'Page', selected: true })).toBeInTheDocument();
  });

  it('f typed in a field does not toggle full screen', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', { value: request, configurable: true });
    await renderFaces();
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'f' });
    expect(request).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'f' });
    expect(request).toHaveBeenCalled();
    input.remove();
  });
});

describe('a document scrolls', () => {
  it('a portrait file opens as a scroll, not a deck', async () => {
    mockAspect = 842 / 595;
    try {
      await renderFaces();
      expect(await screen.findByTestId('scroll')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByTestId('document')).not.toBeInTheDocument());
    } finally {
      mockAspect = 405 / 720;
    }
  });

  it('seeking on the timeline scrolls to the page and keys do not step beats', async () => {
    mockAspect = 842 / 595;
    scrolled.length = 0;
    try {
      await renderFaces();
      await screen.findByTestId('scroll');
      const slider = await screen.findByRole('slider');
      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      await waitFor(() => expect(scrolled.filter((p) => p > 0).length).toBeGreaterThan(0));
      scrolled.length = 0;
      fireEvent.keyDown(window, { key: 'PageDown' });
      await waitFor(() => expect(scrolled.filter((p) => p > 0).length).toBeGreaterThan(0));
      const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true });
      window.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    } finally {
      mockAspect = 405 / 720;
    }
  });

  it('scrolling back up is a visit, not a turn back; a key turning back is one', async () => {
    mockAspect = 842 / 595;
    try {
      await renderFaces();
      await screen.findByTestId('scroll');
      await act(async () => scrollReports?.(5));
      await act(async () => scrollReports?.(4));
      const up = counted.at(-1)!;
      expect(up.page).toBe(4);
      expect(up.notATurn?.current).toBe(4);
      fireEvent.keyDown(window, { key: 'PageUp' });
      await waitFor(() => expect(counted.at(-1)!.page).toBe(3));
      expect(counted.at(-1)!.notATurn?.current).not.toBe(3);
    } finally {
      mockAspect = 405 / 720;
    }
  });

  it('points belong to slides: a document has no points band', async () => {
    const dots = () => screen.queryByRole('tablist', { name: 'Points on this page' });
    /* The control: some page of this fixture carries points. */
    let page = 0;
    for (let p = 1; p <= 12 && !page; p++) {
      await renderFaces(`/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=${p}`);
      if (dots()) page = p;
      cleanup();
    }
    expect(page).toBeGreaterThan(0);
    mockAspect = 842 / 595;
    try {
      await renderFaces(`/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=${page}`);
      await screen.findByTestId('scroll');
      expect(dots()).not.toBeInTheDocument();
    } finally {
      mockAspect = 405 / 720;
    }
  });

  it('?page=N lands on that page once a document has loaded', async () => {
    mockAspect = 842 / 595;
    scrolled.length = 0;
    try {
      await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=3');
      await screen.findByTestId('scroll');
      await waitFor(() => expect(scrolled).toContain(-1));
      /* Not before the first page has painted; after it, once, to page 3. */
      expect(scrolled.slice(0, scrolled.indexOf(-1))).not.toContain(3);
      await waitFor(() => expect(scrolled.slice(scrolled.indexOf(-1))).toContain(3));
    } finally {
      mockAspect = 405 / 720;
    }
  });

  it('from the early reader, its still stays until the page it was on has painted here', async () => {
    mockAspect = 842 / 595;
    scrolled.length = 0;
    holdCurtain(document.body.appendChild(document.createElement('div')));
    try {
      await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=3');
      await waitFor(() => expect(scrolled.slice(scrolled.indexOf(-1))).toContain(3));
      /* Page 1 has painted, and the scroll is at page 3: not yet. */
      expect(curtainUp()).toBe(true);
      act(() => paintPage(3));
      expect(curtainUp()).toBe(false);
    } finally {
      mockAspect = 405 / 720;
      __dropCurtain();
    }
  });

  it('a deck lifts the still on its first paint', async () => {
    holdCurtain(document.body.appendChild(document.createElement('div')));
    try {
      await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=2');
      await waitFor(() => expect(curtainUp()).toBe(false));
    } finally {
      __dropCurtain();
    }
  });

  it('a landscape file stays a pager', async () => {
    await renderFaces();
    expect(screen.queryByTestId('scroll')).not.toBeInTheDocument();
  });
});

describe('the page shape belongs to its Lesson', () => {
  it('a deck opened after a document is measured afresh, not shown as a scroll', async () => {
    let go: (to: string) => void = () => {};
    let at = '';
    const Nav = () => {
      go = useNavigate();
      const loc = useLocation();
      at = loc.pathname + loc.search;
      return null;
    };
    mockAspect = 842 / 595;
    /*
     * The browser's own history, as in the app: the reader writes `?page=` only
     * while window.location is still on its Lesson, and a MemoryRouter never
     * moves window.location, so under one the write would never come.
     */
    window.history.replaceState(null, '', '/v4/space/s-dbs/lesson/l-s-dbs-4/faces');
    try {
      render(
        <BrowserRouter>
          <Nav />
          <Routes>
            <Route path="/v4/space/:spaceId/lesson/:lessonId/faces" element={<LessonFacesScreen />} />
          </Routes>
        </BrowserRouter>,
      );
      expect(await screen.findByTestId('scroll', {}, { timeout: 4000 })).toBeInTheDocument();
      /*
       * Let the reader settle first: its `?page=` write is a pending effect
       * that would otherwise land after the navigation below and replace the
       * new Lesson's URL with this one's. Flush it, then see it has landed.
       */
      await act(async () => {});
      await waitFor(() => expect(at).toContain('page='), { timeout: 4000 });
      /* Another Lesson, then this one again as a landscape file: the old shape must not carry over. */
      await act(async () => go('/v4/space/s-dbs/lesson/l-s-dbs-3/faces'));
      await screen.findByText('Nothing to read yet', {}, { timeout: 4000 });
      mockAspect = 405 / 720;
      await act(async () => go('/v4/space/s-dbs/lesson/l-s-dbs-4/faces'));
      expect(await screen.findByTestId('document', {}, { timeout: 4000 })).toBeInTheDocument();
      expect(screen.queryByTestId('scroll')).toBeNull();
    } finally {
      mockAspect = 405 / 720;
      window.history.replaceState(null, '', '/');
    }
  });
});

describe('the page line and the timeline', () => {
  beforeEach(() => {
    mockPages = 12;
  });
  afterEach(() => {
    mockPages = 0;
  });
  it('the pill stands above the timeline row, not on it', async () => {
    await renderFaces();
    const line = screen.getByTestId('page-line');
    const row = screen.getByTestId('timeline-row');
    /* The row is 20px tall over the safe area; the pill is lifted clear of it. */
    expect(row).toHaveClass('bottom-0');
    expect(line.className).toContain('bottom-[max(34px,calc(env(safe-area-inset-bottom)+28px))]');
    expect(line.className).not.toMatch(/bottom-\[max\(20px/);
  });

  it('the timeline shows where you are, once', async () => {
    await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=3');
    const count = await screen.findByTestId('timeline-count');
    expect(count.textContent).toMatch(/^3 \/ \d+$/);
  });
});

describe('Explain and Text keep what is behind them out of reach', () => {
  beforeEach(() => {
    mockPages = 12;
  });
  afterEach(() => {
    mockPages = 0;
  });
  it('the stage, the page line and the timeline are inert; the view switch is not', async () => {
    await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?view=explain');
    await screen.findByRole('complementary', { name: 'Explain' });
    expect(screen.getByTestId('page-line')).toHaveAttribute('inert');
    expect(screen.getByTestId('timeline-row')).toHaveAttribute('inert');
    expect(screen.getByTestId('document').closest('[inert]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Leave the reader' }).closest('[inert]')).not.toBeNull();
    expect(screen.getByRole('tab', { name: 'Page' }).closest('[inert]')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Page' }));
    await waitFor(() => expect(screen.getByTestId('page-line')).not.toHaveAttribute('inert'));
    expect(screen.getByTestId('timeline-row')).not.toHaveAttribute('inert');
  });

  it('Space and Page Down do not turn the page under the layer', async () => {
    await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?view=explain');
    await screen.findByRole('complementary', { name: 'Explain' });
    fireEvent.keyDown(window, { key: 'PageDown' });
    fireEvent.keyDown(window, { key: ' ' });
    await act(async () => {});
    expect(pageLine()).toHaveTextContent('Page 1');
  });
});

describe('the keys keep to what exists', () => {
  beforeEach(() => {
    mockPages = 12;
  });
  afterEach(() => {
    mockPages = 0;
  });
  it('Page Down on the focused timeline does not turn the page', async () => {
    await renderFaces();
    const slider = await screen.findByRole('slider');
    fireEvent.keyDown(slider, { key: 'PageDown' });
    await act(async () => {});
    expect(pageLine()).toHaveTextContent('Page 1');
    fireEvent.keyDown(window, { key: 'PageDown' });
    await waitFor(() => expect(pageLine()).toHaveTextContent('Page 2'));
  });

  it('F without full screen (an iPhone) is left alone', async () => {
    const had = Object.getOwnPropertyDescriptor(document.documentElement, 'requestFullscreen');
    Object.defineProperty(document.documentElement, 'requestFullscreen', { value: undefined, configurable: true });
    try {
      await renderFaces();
      const ev = new KeyboardEvent('keydown', { key: 'f', cancelable: true, bubbles: true });
      window.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    } finally {
      if (had) Object.defineProperty(document.documentElement, 'requestFullscreen', had);
    }
  });

  it('a number past the last view tab is no key', async () => {
    await renderFaces();
    const ev = new KeyboardEvent('keydown', { key: '4', cancelable: true, bubbles: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.getByRole('tab', { name: 'Page' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('the view switch is a real tab switch (LS-054)', () => {
  beforeEach(() => {
    mockPages = 12;
  });
  afterEach(() => {
    mockPages = 0;
  });
  it('arrows move between Page, Explain and Text, and never turn the page', async () => {
    await renderFaces();
    const pageTab = screen.getByRole('tab', { name: 'Page' });
    expect(pageTab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Explain' })).toHaveAttribute('tabindex', '-1');
    pageTab.focus();
    jumps.length = 0;
    fireEvent.keyDown(pageTab, { key: 'ArrowRight' });
    const explain = await screen.findByRole('tab', { name: 'Explain', selected: true });
    expect(explain).toHaveFocus();
    expect(jumps.some((p) => p > 1)).toBe(false);
  });
});

describe('a Lesson that is not there (LS-061)', () => {
  it('says so, with a way back, instead of "the connection dropped"', async () => {
    render(
      <MemoryRouter initialEntries={['/v4/space/s-dbs/lesson/no-such-lesson/faces?page=1']}>
        <Routes>
          <Route path="/v4/space/:spaceId/lesson/:lessonId/faces" element={<LessonFacesScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('That Lesson isn’t here', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(/connection dropped/i)).toBeNull();
  });
});

describe('Back closes Explain, with the real browser address (LS-056)', () => {
  beforeEach(() => {
    mockPages = 12;
  });
  afterEach(() => {
    mockPages = 0;
    window.history.replaceState(null, '', '/');
  });
  it('opening Explain adds one entry; Back closes it and keeps the page', async () => {
    window.history.replaceState(null, '', '/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=1');
    render(
      <BrowserRouter>
        <Routes>
          <Route path="/v4/space/:spaceId/lesson/:lessonId/faces" element={<LessonFacesScreen />} />
        </Routes>
      </BrowserRouter>,
    );
    await waitFor(() => expect(screen.queryByTestId('document') ?? screen.queryByTestId('scroll')).not.toBeNull(), { timeout: 4000 });
    const before = window.history.length;
    fireEvent.click(screen.getByRole('tab', { name: 'Explain' }));
    await waitFor(() => expect(window.location.search).toContain('view=explain'));
    expect(window.history.length).toBe(before + 1);
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Page' })).toHaveAttribute('aria-selected', 'true'));
    expect(window.location.pathname).toBe('/v4/space/s-dbs/lesson/l-s-dbs-4/faces');
    expect(window.location.search).not.toContain('view=');
  });
});
