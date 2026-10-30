import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { RefObject } from 'react';

/*
 * What the reader tells the reading clock is covering the page. The clock
 * itself is tested in `__tests__/reading.test.ts`; here the hook is replaced
 * by a recorder and the screen's own `covered` argument is what is read.
 */
const { reads } = vi.hoisted(() => ({ reads: [] as unknown[][] }));
vi.mock('../../data/reading', () => ({ useReadingProgress: (...args: unknown[]) => void reads.push(args) }));
/* Luna is on for this reader, so a session that is open can be told apart from one that is not. */
vi.mock('../../data/lunaSession', async (orig) => ({ ...(await orig<typeof import('../../data/lunaSession')>()), lunaEnabled: () => true }));

vi.mock('@/components/pdf', () => ({
  PdfPage: ({ page }: { page: number }) => <div data-testid="sheet" data-page={page} />,
  PdfPager: ({ rootRef, page }: { rootRef: RefObject<HTMLDivElement>; page: number }) => (
    <div ref={rootRef} data-testid="document">
      Page {page}
    </div>
  ),
  pdfPageId: (p: number) => `pdf-page-${p}`,
  sampleAccent: () => null,
  warmPdfWorker: () => {},
}));

import LessonFacesScreen from '../../screens/LessonFacesScreen';

/** `src/test/setup.ts` stubs every media query as not matching: the narrow side for free, the wide one on request. */
const atWidth = (wide: boolean) => {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('min-width: 1024px') ? wide : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  return () => Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: original });
};

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

/** The `covered` the reader last handed the clock. */
const covered = () => reads.at(-1)?.[3];

beforeEach(() => {
  reads.length = 0;
});

describe('what covers the page, for the reading clock', () => {
  it('nothing covers the page while it is simply being read', async () => {
    const restore = atWidth(true);
    await renderFaces();
    expect(covered()).toBe(false);
    restore();
  });

  it('Luna beside the page does not cover it', async () => {
    const restore = atWidth(true);
    await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?luna=1');
    expect(covered()).toBe(false);
    restore();
  });

  it('Luna as a sheet below the page does not cover it', async () => {
    await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?luna=1');
    expect(covered()).toBe(false);
  });

  it('Explain over the whole screen (narrow) covers the page', async () => {
    await renderFaces();
    fireEvent.click(screen.getByRole('tab', { name: 'Explain' }));
    await waitFor(() => expect(covered()).toBe(true));
    fireEvent.click(screen.getByRole('tab', { name: 'Page' }));
    await waitFor(() => expect(covered()).toBe(false));
  });

  it('Explain beside the page (wide) does not cover it', async () => {
    const restore = atWidth(true);
    await renderFaces();
    fireEvent.click(screen.getByRole('tab', { name: 'Explain' }));
    await screen.findByRole('complementary', { name: 'Explain' });
    expect(covered()).toBe(false);
    restore();
  });

  it('the text view is still the page being read', async () => {
    await renderFaces();
    fireEvent.click(screen.getByRole('tab', { name: 'Text' }));
    await screen.findByRole('complementary', { name: 'Studio' });
    expect(covered()).toBe(false);
  });

  it('the practice bench covers the page, and reading is counted again on the way back', async () => {
    await renderFaces();
    fireEvent.keyDown(window, { key: '\\' });
    const studio = await screen.findByRole('complementary', { name: 'Studio' });
    fireEvent.click(within(studio).getByRole('button', { name: 'Practise what you just read' }));
    await screen.findByRole('region', { name: 'Practice' });
    expect(covered()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back to reading' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Practice' })).toBeNull());
    expect(covered()).toBe(false);
  });
});
