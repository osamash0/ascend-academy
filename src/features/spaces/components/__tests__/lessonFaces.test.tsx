import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { RefObject } from 'react';
import LessonFacesScreen from '../../screens/LessonFacesScreen';

/*
 * The file itself is not rendered here: react-pdf needs a canvas and a worker
 * that happy-dom does not have. The document is a stand-in that owns the
 * scroll ref, and a jump is recorded rather than performed.
 */
const jumps: number[] = [];
vi.mock('@/components/pdf', () => ({
  PdfPage: ({ page }: { page: number }) => <div data-testid="sheet" data-page={page} />,
  PdfScroll: ({ scrollRef }: { scrollRef: RefObject<HTMLDivElement> }) => (
    <div ref={scrollRef} data-testid="document" />
  ),
  scrollToPdfPage: (_el: HTMLElement, page: number) => jumps.push(page),
  pdfPageId: (p: number) => `pdf-page-${p}`,
  sampleAccent: () => null,
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
  await screen.findByTestId('document', {}, { timeout: 4000 });
  await act(async () => {});
  return utils;
};

const pageLine = () => screen.getByText(/^Page \d+$/);
const spineTick = (name: string) =>
  screen
    .getByRole('navigation', { name: 'Concepts in this Lesson' })
    .querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;

describe('the document, and nothing else', () => {
  it('opens on the document with the exit, the spine and the page line', async () => {
    await renderFaces();
    expect(screen.getByTestId('document')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Leave the reader' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Concepts in this Lesson' })).toBeInTheDocument();
    expect(pageLine()).toHaveTextContent('Page 1');
    expect(screen.getByText('Select words on the page to ask about them, or to read them as text.')).toBeInTheDocument();
  });

  it('has no studio, no tablist and no ask bar until asked', async () => {
    await renderFaces();
    expect(screen.queryByRole('complementary', { name: 'Studio' })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByPlaceholderText('Ask about this Lesson')).toBeNull();
    expect(screen.queryByRole('button', { name: /Notes for/ })).toBeNull();
  });

  it('draws one spine tick per Concept, in the order the file explains them', async () => {
    await renderFaces();
    const nav = screen.getByRole('navigation', { name: 'Concepts in this Lesson' });
    expect([...nav.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
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
  it('opens from the Concept in the page line, at the current page, and closes on Escape', async () => {
    await renderFaces();
    fireEvent.click(screen.getByRole('button', { name: 'Functional dependency', pressed: false }));
    const studio = await screen.findByRole('complementary', { name: 'Studio' });
    expect(within(studio).getByText('Functional dependency · Page 1')).toBeInTheDocument();
    expect(within(studio).getByRole('region', { name: 'The text' })).toBeInTheDocument();
    // The marks are on inside the studio: it is the earned layer.
    expect(within(studio).getAllByRole('button', { name: /Notes for/ }).length).toBeGreaterThan(0);
    // The hint has done its job.
    expect(screen.queryByText(/Select words on the page/)).toBeNull();
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
