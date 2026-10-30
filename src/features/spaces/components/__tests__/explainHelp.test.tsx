import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useEffect, type RefObject } from 'react';

/*
 * Leaving Explain open while the page turns fetches its answer for every page,
 * but only the page it was opened on is the learner asking for help. The hook
 * is wrapped by a recorder; what the screen hands it (page, enabled, opened)
 * is what is read. What the hook sends is tested in `telemetry-live.test.ts`.
 */
const { asked } = vi.hoisted(() => ({ asked: [] as { page: number; enabled: boolean; opened: boolean }[] }));
vi.mock('../../data/useReader', async (orig) => {
  const real = await orig<typeof import('../../data/useReader')>();
  return {
    ...real,
    useExplain: (...args: Parameters<typeof real.useExplain>) => {
      const [, , page, , enabled, opened] = args;
      asked.push({ page, enabled: enabled ?? true, opened: opened ?? true });
      return real.useExplain(...args);
    },
  };
});

vi.mock('@/components/pdf', () => ({
  PdfPage: ({ page }: { page: number }) => <div data-testid="sheet" data-page={page} />,
  /* The file has pages: the pager reports how many, so turning is not clamped to the first. */
  PdfPager: ({ rootRef, page, onLoad }: { rootRef: RefObject<HTMLDivElement>; page: number; onLoad?: (n: number) => void }) => {
    useEffect(() => onLoad?.(40), [onLoad]);
    return (
      <div ref={rootRef} data-testid="document">
        Page {page}
      </div>
    );
  },
  pdfPageId: (p: number) => `pdf-page-${p}`,
  sampleAccent: () => null,
  warmPdfWorker: () => {},
}));

import LessonFacesScreen from '../../screens/LessonFacesScreen';

const renderFaces = async (path = '/v4/space/s-dbs/lesson/l-s-dbs-4/faces') => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/space/:spaceId/lesson/:lessonId/faces" element={<LessonFacesScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTestId('document', {}, { timeout: 4000 });
  await act(async () => {});
};

/** What Explain was last asked for. */
const last = () => asked.at(-1)!;
const turn = (key: 'ArrowRight' | 'ArrowLeft') => fireEvent.keyDown(window, { key });

beforeEach(() => {
  asked.length = 0;
});

describe('Explain left open while turning pages is not asking for help', () => {
  it('the page it was opened on is help; the pages turned to after are not; coming back to it is', async () => {
    await renderFaces();
    expect(last()).toMatchObject({ page: 1, enabled: false });
    fireEvent.click(screen.getByRole('tab', { name: 'Explain' }));
    await waitFor(() => expect(last()).toEqual({ page: 1, enabled: true, opened: true }));
    turn('ArrowRight');
    await waitFor(() => expect(last()).toEqual({ page: 2, enabled: true, opened: false }));
    turn('ArrowRight');
    await waitFor(() => expect(last()).toEqual({ page: 3, enabled: true, opened: false }));
    turn('ArrowLeft');
    turn('ArrowLeft');
    await waitFor(() => expect(last()).toEqual({ page: 1, enabled: true, opened: true }));
  });

  it('closing Explain forgets the page, so opening it on another page is help there', async () => {
    await renderFaces();
    fireEvent.click(screen.getByRole('tab', { name: 'Explain' }));
    await waitFor(() => expect(last()).toMatchObject({ page: 1, enabled: true, opened: true }));
    turn('ArrowRight');
    await waitFor(() => expect(last()).toMatchObject({ page: 2, opened: false }));
    fireEvent.click(screen.getByRole('tab', { name: 'Page' }));
    await waitFor(() => expect(last().enabled).toBe(false));
    fireEvent.click(screen.getByRole('tab', { name: 'Explain' }));
    await waitFor(() => expect(last()).toEqual({ page: 2, enabled: true, opened: true }));
  });

  it('a ?view=explain way in is Explain opened on that page', async () => {
    await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=3&view=explain');
    await waitFor(() => expect(last()).toEqual({ page: 3, enabled: true, opened: true }));
    turn('ArrowRight');
    await waitFor(() => expect(last()).toEqual({ page: 4, enabled: true, opened: false }));
  });
});
