import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useEffect, type RefObject } from 'react';
import LessonFacesScreen from '../../screens/LessonFacesScreen';

/*
 * The file itself is not rendered here: react-pdf needs a canvas and a worker
 * that happy-dom does not have. The document is a stand-in that owns the
 * scroll ref, and a jump is recorded rather than performed.
 */
const mockAspect = 405 / 720;
/* How many pages the stand-in pager says the file has; 0 keeps it silent (no timeline). */
let mockPages = 0;
const scrolled: number[] = [];
vi.mock('@/components/pdf', () => ({
  PdfPage: ({ page }: { page: number }) => <div data-testid="sheet" data-page={page} />,
  PdfPager: ({ rootRef, page, overlay, onAspect, onLoad }: { rootRef: RefObject<HTMLDivElement>; page: number; overlay?: { props?: { words?: string | null } }; onAspect?: (a: number) => void; onLoad?: (n: number) => void }) => {
    useEffect(() => {
      onAspect?.(mockAspect);
      if (mockPages) onLoad?.(mockPages);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    /* The words the Spotlight would light, recorded rather than drawn. */
    return (
      <div ref={rootRef} data-testid="document" data-spot={overlay?.props?.words ?? ''}>
        Page {page}
      </div>
    );
  },
  PdfScroll: ({ scrollRef, onLoad, onFirstRender }: { scrollRef: RefObject<HTMLDivElement>; onLoad?: (n: number) => void; onFirstRender?: (c: null) => void }) => {
    /* Like the real one: the file opens first, the first page paints later. */
    useEffect(() => {
      onLoad?.(10);
      const t = setTimeout(() => {
        scrolled.push(-1); // marker: first render
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

const runState = vi.hoisted(() => ({ reading: null as null | Record<string, unknown>, gaveUp: false }));
vi.mock('../../data/useRunReading', async (orig) => ({
  ...(await orig<object>()),
  useRunStatus: () => ({ reading: runState.reading, gaveUp: runState.gaveUp }),
}));
const base = { pdfUrl: 'u', pages: 82, pagesRead: 2, practiceReady: false, readable: true, stage: 'developing', lessonId: 'l-s-dbs-4' };

const mountAt = async (query: string) => {
  render(
    <MemoryRouter initialEntries={[`/v4/space/s-dbs/lesson/l-s-dbs-4/faces${query}`]}>
      <Routes>
        <Route path="/v4/space/:spaceId/lesson/:lessonId/faces" element={<LessonFacesScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryByTestId('document') ?? screen.queryByTestId('scroll')).not.toBeNull(), { timeout: 4000 });
  await act(async () => {});
};

afterEach(() => {
  cleanup();
  runState.reading = null;
  runState.gaveUp = false;
  mockPages = 0;
});

describe('the faces light up page by page', () => {
  it('on a page Luna has not written, only Page shows', async () => {
    runState.reading = { ...base, pagesReady: [1, 2] };
    await mountAt('?page=5&run=run-1');
    expect(await screen.findByRole('tab', { name: 'Page' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Explain' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Text' })).toBeNull();
  });

  it('on a page she has written, Explain and Text are there', async () => {
    runState.reading = { ...base, pagesReady: [1, 2, 3, 4, 5] };
    await mountAt('?page=5&run=run-1');
    expect(await screen.findByRole('tab', { name: 'Explain' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Text' })).toBeInTheDocument();
  });

  it('the number keys only reach the tabs that are there', async () => {
    runState.reading = { ...base, pagesReady: [1] };
    await mountAt('?page=5&run=run-1');
    await screen.findByRole('tab', { name: 'Page' });
    fireEvent.keyDown(window, { key: '2' });
    expect(screen.getByRole('tab', { name: 'Page' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Practise stays hidden until its questions exist', async () => {
    runState.reading = { ...base, pagesReady: [1, 2, 3, 4, 5] };
    await mountAt('?page=5&run=run-1&view=text');
    await screen.findByRole('tab', { name: 'Text' });
    expect(screen.queryByRole('button', { name: /practi[sc]e/i })).toBeNull();
  });

  it('the timeline buffer is the pages Luna has written', async () => {
    mockPages = 10;
    runState.reading = { ...base, pagesReady: [1, 2, 3, 5] };
    await mountAt('?page=1&run=run-1');
    fireEvent.pointerMove(window);
    const bar = await screen.findByTestId('timeline-read');
    const total = Number(screen.getByTestId('timeline-count').textContent?.split('/')[1]?.trim());
    expect(bar.style.width).toBe(`${(3 / total) * 100}%`);
  });

  it('a run known but not heard from yet keeps every face waiting', async () => {
    runState.reading = null;
    await mountAt('?page=1&run=run-1');
    expect(await screen.findByRole('tab', { name: 'Page' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Explain' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Text' })).toBeNull();
  });

  it('a run whose reads gave up is read as any Lesson', async () => {
    runState.reading = null;
    runState.gaveUp = true;
    await mountAt('?page=1&run=run-1');
    expect(await screen.findByRole('tab', { name: 'Explain' })).toBeInTheDocument();
  });

  it('a run for another Lesson is not followed', async () => {
    runState.reading = { ...base, pagesReady: [1], lessonId: 'l-s-dbs-9' };
    await mountAt('?page=5&run=run-1');
    expect(await screen.findByRole('tab', { name: 'Explain' })).toBeInTheDocument();
  });

  it('seeking the timeline past Luna turns there, with Page only', async () => {
    /* More pages than the stand-in deck has slides: the last one has no anchor yet. */
    mockPages = 200;
    runState.reading = { ...base, pagesReady: [1, 2] };
    await mountAt('?page=1&run=run-1');
    expect(await screen.findByRole('tab', { name: 'Explain' })).toBeInTheDocument();
    fireEvent.pointerMove(window);
    const slider = await screen.findByRole('slider');
    fireEvent.keyDown(slider, { key: 'End' });
    await waitFor(() => expect(screen.getByTestId('document')).toHaveTextContent('Page 200'));
    expect(screen.getByRole('tab', { name: 'Page' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Explain' })).toBeNull();
  });

  it('Explain gives way to Page when you turn to a page Luna has not written', async () => {
    mockPages = 10;
    runState.reading = { ...base, pagesReady: [1, 2] };
    await mountAt('?page=2&run=run-1&view=explain');
    expect(await screen.findByRole('tab', { name: 'Explain' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.pointerMove(window);
    fireEvent.keyDown(await screen.findByRole('slider'), { key: 'ArrowUp' });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Page' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.queryByRole('tab', { name: 'Explain' })).toBeNull();
  });

  it("the companion's Practise waits for the questions while Luna reads", async () => {
    runState.reading = { ...base, pagesReady: [1, 2, 3, 4, 5] };
    await mountAt('?page=5&run=run-1&view=text');
    await screen.findByRole('tab', { name: 'Text' });
    fireEvent.click((await screen.findAllByRole('button', { name: /^Notes for/ }))[0]);
    expect(await screen.findByText(/^Notes ·/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Practise this idea' })).toBeNull();
  });

  it("without a run, the companion's Practise is there", async () => {
    runState.reading = null;
    await mountAt('?page=5&view=text');
    await screen.findByRole('tab', { name: 'Text' });
    fireEvent.click((await screen.findAllByRole('button', { name: /^Notes for/ }))[0]);
    expect(await screen.findByText(/^Notes ·/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Practise this idea' })).toBeInTheDocument();
  });

  it('without a run, nothing changes', async () => {
    runState.reading = null;
    await mountAt('?page=5');
    expect(await screen.findByRole('tab', { name: 'Explain' })).toBeInTheDocument();
  });
});
