import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SourceView } from '../reader/SourceView';
import ReaderScreen from '../../screens/ReaderScreen';
import { spaceById } from '../../mocks/spaces';
import { visibleLesson } from '../../mocks/lessons';

/**
 * The Material, page by page.
 *
 * Render tests, like the header's: every rule here is about what a person
 * sees and can reach — which page is showing, whether the ends stop, and
 * whether the line under the pager names the idea this page is actually
 * about. A source guard would confirm the strings exist and nothing about
 * whether they are correct.
 *
 * The three shapes at the bottom are the point of the whole task. A Lesson
 * with a Material and no prose used to render "Not written yet" while holding
 * the file you came to read, which is the dead end this replaced.
 */

const SPACE = spaceById('s-dbs')!;
const BOTH = visibleLesson(SPACE, 'l-s-dbs-4')!;
const SOURCE_ONLY = visibleLesson(SPACE, 'l-s-dbs-10')!;
const PAGES = BOTH.material!.pages!;

describe('the fixtures the Source view is read from', () => {
  it('gives Normalization a text and a Material of ten to fourteen pages', () => {
    expect(BOTH.passages!.length).toBe(5);
    expect(PAGES.length).toBeGreaterThanOrEqual(10);
    expect(PAGES.length).toBeLessThanOrEqual(14);
  });

  it('gives Index Structures a Material and no text', () => {
    expect(SOURCE_ONLY.passages ?? []).toHaveLength(0);
    expect(SOURCE_ONLY.material!.pages!.length).toBeGreaterThan(0);
  });
});

const defaults = {
  pages: PAGES,
  concepts: BOTH.concepts,
  page: 1,
  onPageChange: () => {},
  onJumpToPassage: () => {},
};

const mount = (over: Partial<React.ComponentProps<typeof SourceView>> = {}) =>
  render(<SourceView {...defaults} {...over} />);

describe('one page at a time, and it says which one', () => {
  it('renders the page it was handed, not the first one', () => {
    mount({ page: 4 });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(PAGES[3].title);
    for (const b of PAGES[3].bullets) expect(screen.getByText(b)).toBeTruthy();
  });

  it('counts in the file, not from zero', () => {
    mount({ page: 4 });
    expect(screen.getByText(`4 / ${PAGES.length}`)).toBeTruthy();
  });

  it('keeps the count from shuffling sideways as the digits change', () => {
    // Tabular figures. Proportional ones move the whole row by a pixel or two
    // on every press, which reads as the control being unsure of itself.
    const { container } = mount({ page: 9 });
    const count = container.querySelector('.tabular-nums');
    expect(count?.textContent).toBe(`9 / ${PAGES.length}`);
  });

  it('falls back to the first page rather than blanking on a stale number', () => {
    // A citation can name a page of the Lesson you just left.
    mount({ page: 999 });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(PAGES[0].title);
  });
});

describe('the pager stops at the ends rather than wrapping', () => {
  it('cannot go back from the first page', () => {
    mount({ page: 1 });
    expect(screen.getByRole('button', { name: 'Previous page' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(false);
  });

  it('cannot go on from the last page', () => {
    mount({ page: PAGES.length });
    expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Previous page' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('asks for the next and previous page by number', () => {
    // Page numbers, not indices — the same currency a citation will carry.
    const onPageChange = vi.fn();
    mount({ page: 5, onPageChange });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(6);
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });
});

describe('the sync line names the idea this page is about', () => {
  it('names the Concept the page claims, not the first one', () => {
    const page = PAGES.find((p) => p.conceptId === BOTH.concepts[3].id)!;
    mount({ page: page.page });
    expect(screen.getByText('This page belongs to')).toBeTruthy();
    expect(screen.getByRole('button', { name: BOTH.concepts[3].name })).toBeTruthy();
  });

  it('offers the passage rather than merely stating the idea', () => {
    const onJumpToPassage = vi.fn();
    mount({ page: 1, onJumpToPassage });
    fireEvent.click(screen.getByRole('button', { name: BOTH.concepts[0].name }));
    expect(onJumpToPassage).toHaveBeenCalledWith(BOTH.concepts[0].id);
  });

  it('says nothing at all when the Concept is not this Lesson’s', () => {
    // Rather than a caption about an idea the Lesson does not have.
    mount({ page: 1, concepts: [] });
    expect(screen.queryByText('This page belongs to')).toBeNull();
  });

  it('still names the idea, but does not offer it, when there is no passage', () => {
    // Found in the browser: on a Lesson with no text the button called back,
    // the screen derived its way straight back to this view, and the press
    // did nothing. The name is still worth saying; the control is not.
    mount({ page: 1, onJumpToPassage: undefined });
    expect(screen.getByText(BOTH.concepts[0].name)).toBeTruthy();
    expect(screen.queryByRole('button', { name: BOTH.concepts[0].name })).toBeNull();
  });
});

/* ── The two views, on the screen that composes them ─────────────── */

const renderReader = async (lessonId: string, spaceId = 's-dbs') => {
  const r = render(
    <MemoryRouter initialEntries={[`/v4/space/${spaceId}/lesson/${lessonId}/read`]}>
      <Routes>
        <Route path="/v4/space/:spaceId/lesson/:lessonId/read" element={<ReaderScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  // Every screen holds a skeleton for 600ms so the loading state is real.
  await waitFor(() => expect(screen.getByRole('banner')).toBeTruthy(), { timeout: 3000 });
  return r;
};

describe('a Lesson with both views can be read either way', () => {
  it('opens in the text, not the file', async () => {
    await renderReader('l-s-dbs-4');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Normalization');
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });

  it('offers the toggle, and both halves work', async () => {
    await renderReader('l-s-dbs-4');
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }));
    expect(screen.getByText(`1 / ${PAGES.length}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Read' }));
    expect(screen.getByText(BOTH.passages![0].heading)).toBeTruthy();
  });

  it('turns the page from the screen that owns the number', async () => {
    // The page index lives on ReaderScreen so a tutor citation can move it
    // from outside this view. Pressing the pager must reach that state.
    await renderReader('l-s-dbs-4');
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText(`2 / ${PAGES.length}`)).toBeTruthy();
  });

  it('lands on the passage the sync line names', async () => {
    /*
     * The scroll is deferred a frame because the passage is not in the
     * document when the click is handled — the first version of this jump
     * looked correct and moved nothing, which is why the target of
     * `scrollIntoView` is asserted rather than merely the view change.
     */
    const scrolls: Element[] = [];
    const spy = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(function (this: Element) {
        scrolls.push(this);
      });
    try {
      await renderReader('l-s-dbs-4');
      fireEvent.click(screen.getByRole('tab', { name: 'Source' }));
      fireEvent.click(screen.getByRole('button', { name: BOTH.concepts[0].name }));
      expect(screen.getByText(BOTH.passages![0].heading)).toBeTruthy();
      await waitFor(() => expect(scrolls).toHaveLength(1));
      expect(scrolls[0].id).toBe(`passage-${BOTH.concepts[0].id}`);
    } finally {
      spy.mockRestore();
    }
  });

  it('gives every passage an anchor, so no sync line is a dead end', async () => {
    const { container } = await renderReader('l-s-dbs-4');
    for (const c of BOTH.concepts) {
      expect(container.querySelector(`#passage-${c.id}`), `${c.name} has no anchor`).toBeTruthy();
    }
  });
});

describe('the three other shapes render the right thing', () => {
  it('opens a Material with no text in the Material, with no toggle', async () => {
    /*
     * The dead end this task removed. It used to say "Not written yet" and
     * offer a way back, while the file it was built from sat unopened.
     */
    await renderReader('l-s-dbs-10');
    expect(screen.queryByText('Not written yet')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Index Structures');
  });

  it('leaves no sync button on a Lesson with nowhere to sync to', async () => {
    await renderReader('l-s-dbs-10');
    const named = SOURCE_ONLY.concepts[0].name;
    expect(screen.getByText(named)).toBeTruthy();
    expect(screen.queryByRole('button', { name: named })).toBeNull();
  });

  it('still says a Lesson with neither is unwritten', async () => {
    await renderReader('l-s-dbs-3');
    expect(screen.getByText('Not written yet')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });

  it('offers no Source view once the source file is gone', async () => {
    // `material: null` takes the pages with it — which is why they live on
    // the Material. There is nothing to open and so nothing to toggle to.
    const lesson = visibleLesson(spaceById('s-crypto')!, 'l-s-crypto-6')!;
    expect(lesson.material).toBeNull();
    await renderReader('l-s-crypto-6', 's-crypto');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });
});
