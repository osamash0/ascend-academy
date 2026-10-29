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

const runState = vi.hoisted(() => ({ reading: null as null | Record<string, unknown> }));
vi.mock('../../data/useRunReading', () => ({ useRunReading: () => runState.reading }));
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

  it('without a run, nothing changes', async () => {
    runState.reading = null;
    await mountAt('?page=5');
    expect(await screen.findByRole('tab', { name: 'Explain' })).toBeInTheDocument();
  });
});
