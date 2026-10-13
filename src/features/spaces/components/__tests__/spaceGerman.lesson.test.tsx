import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { RefObject } from 'react';
import i18n from '@/i18n';
import LessonScreen from '../../screens/LessonScreen';

/*
 * A German reader opens a Lesson's overview without one English word of the
 * overview's own chrome.
 *
 * The demo Lesson's words (its title, its ideas, the tools Explain wrote) are
 * the deck's and stay English. The shared parts the overview borrows — top
 * bar, pager, contribution cards, note editor, badges — belong to other
 * slices and are checked there. What is checked here is what LessonScreen,
 * IdeaExplorer, LessonDeck and ToolShelf themselves say.
 */
vi.mock('@/components/pdf', () => ({
  PdfPage: ({ page }: { page: number }) => <div data-testid="sheet" data-page={page} />,
  PdfPager: ({ rootRef }: { rootRef: RefObject<HTMLDivElement> }) => <div ref={rootRef} data-testid="document" />,
  pdfPageId: (p: number) => `pdf-page-${p}`,
  sampleAccent: () => null,
}));

const ENGLISH_CHROME = [
  'Previous Lesson',
  'Next Lesson',
  'Lesson pager',
  'Completed',
  'Continue at page',
  'Start reading',
  'Rehearse this Lesson',
  'ideas cleared',
  'This Lesson still works',
  'The ideas',
  'Ideas in this Lesson',
  'Grouping the Lesson',
  'lights up',
  'Try it, don’t just read it',
  'opens in the reader',
  'From the community',
  'Nothing here yet',
  'finally clicked',
  'Your notes',
  'Private to you',
  'Notes are private',
  'Tested right',
  'To revisit',
  'Cleared',
  'Not yet',
  'Read from page',
  'Teach it back',
  'About this idea',
  'Break a dependency',
  'Compute a closure',
  'Decompose a relation',
  'Walk a proof',
  'Explore the parts',
  'Compare side by side',
  '\\d+ pages',
  'Pages \\d+',
  'page \\d+',
  'Lesson \\d+',
  'Back to Spaces',
  'Practice ·',
];

/** Everything the screen says: its text, and what it says to a screen reader. */
const said = () => {
  const root = document.body;
  const deck = [...root.querySelectorAll('[data-page]')].map((el) => el.textContent ?? '');
  const text = deck.reduce((all, words) => all.replace(words, ''), root.textContent ?? '');
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [text, ...attrs].join('\n');
};

/* Whole words only. */
const leftover = () => {
  const all = said();
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
/* No key printed raw instead of its words. */
const rawKeys = () => said().match(/\b(?:lesson|ideas|deck|tools|light)\.[a-z][\w.]*/g) ?? [];

beforeEach(async () => {
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

const renderLesson = async (path: string) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/space/:spaceId/lesson/:lessonId" element={<LessonScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {});
};

describe('a Lesson overview, in German', () => {
  it('the deck, its ideas and its tools say nothing in English', async () => {
    await renderLesson('/v4/space/s-dbs/lesson/l-s-dbs-4');
    await screen.findByRole('tablist', { name: 'Ideen in dieser Lektion' }, { timeout: 4000 });
    expect(screen.getByText('Ausprobieren, nicht nur lesen')).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);

    /* Every idea, chosen in turn. */
    for (const tab of screen.getAllByRole('tab')) {
      fireEvent.click(tab);
      await act(async () => {});
      expect(leftover()).toEqual([]);
    }
    expect(rawKeys()).toEqual([]);
  });

  it('a missing Lesson says so in German, with the way back', async () => {
    await renderLesson('/v4/space/s-dbs/lesson/nope');
    expect(await screen.findByText('Diese Lektion gibt es hier nicht', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByText(/Zurück zu/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});
