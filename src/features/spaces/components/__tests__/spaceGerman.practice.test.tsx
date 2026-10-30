import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import ConceptScreen from '../../screens/ConceptScreen';
import PracticeScreen from '../../screens/PracticeScreen';
import ReaderScreen from '../../screens/ReaderScreen';
import { notesForLesson } from '../../mocks/notes';

/*
 * A German reader opens an idea, practises a Lesson and reads it in the older
 * /read reader without one English word of those screens' own chrome.
 *
 * The demo data (Lesson titles, idea names, the questions, their choices and
 * explanations, the passages and the Material's pages) is the deck's and
 * stays English. The shared top bar belongs to another slice and is stripped;
 * the reader's header, tutor and selection popover were translated earlier
 * and are left in, so a regression there shows up here too.
 */

const ENGLISH_CHROME = [
  // Concept
  'Idea in',
  'Cleared',
  'Not yet',
  'You have',
  'Appears in',
  'Practice',
  'Practise this idea',
  'questions across',
  'its Lesson',
  'From the community',
  'Sorted by',
  'Nothing here yet',
  'worked example',
  // Practice
  'No practice here yet',
  'Nothing has been written',
  'Back to the Lesson',
  'Every one held',
  'Held, on a second look',
  'Nearly there',
  'still slip',
  'Again',
  'Leave practice',
  'Second look',
  'Correct answer',
  'Your answer, incorrect',
  'Right',
  'Not quite',
  'comes back',
  'See how it went',
  'Next question',
  'Progress through',
  'held',
  // Reader
  'Practise what you just read',
  'Private to you',
  'Notes are private',
  'The Material this Lesson',
  'Not written yet',
  'has its ideas',
  'Page \\d+',
  'Previous page',
  'Next page',
  'This page belongs to',
  'Reader companions',
  'Companions',
  'Close companions',
  'Notes',
];

/** Everything the screen says: its text, and what it says to a screen reader. */
const said = (stripTopBar: boolean) => {
  const root = document.body.cloneNode(true) as HTMLElement;
  /* The shared top bar (on the idea page) is another slice's. */
  if (stripTopBar) root.querySelectorAll('header').forEach((h) => h.remove());
  const deck = [...root.querySelectorAll('[data-page]')].map((el) => el.textContent ?? '');
  const text = deck.reduce((all, words) => all.replace(words, ''), root.textContent ?? '');
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder],[aria-valuetext]')].flatMap(
    (el) => ['aria-label', 'title', 'placeholder', 'aria-valuetext'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [text, ...attrs].join('\n');
};

/* Whole words only. */
const leftover = (deckWords: string[] = [], stripTopBar = false) => {
  let all = said(stripTopBar);
  /* The demo's own words (questions, choices, explanations, passages) are English on purpose. */
  for (const w of deckWords) all = all.split(w).join('');
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
/* No key printed raw instead of its words. */
const rawKeys = (stripTopBar = false) => said(stripTopBar).match(/\b(?:concept|practiceScreen|read|screen|exit)\.[a-z][\w.]*/g) ?? [];

beforeEach(async () => {
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

const renderAt = async (path: string) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/space/:spaceId/concept/:conceptId" element={<ConceptScreen />} />
        <Route path="/v4/space/:spaceId/lesson/:lessonId/practice" element={<PracticeScreen />} />
        <Route path="/v4/space/:spaceId/lesson/:lessonId/read" element={<ReaderScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {});
};

describe('an idea, in German', () => {
  it('a cleared idea and its practice say nothing in English', async () => {
    await renderAt('/v4/space/s-dbs/concept/c-l-s-dbs-2-1');
    expect(await screen.findByText('Idee in Database Systems', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('Geschafft')).toBeInTheDocument();
    expect(screen.getByText('Diese Idee üben')).toBeInTheDocument();
    expect(screen.getByText(/Fragen in ihrer Lektion/)).toBeInTheDocument();
    expect(leftover([], true)).toEqual([]);
    expect(rawKeys(true)).toEqual([]);
  });

  it('an idea not reached yet says so in German', async () => {
    await renderAt('/v4/space/s-dbs/concept/c-l-s-dbs-4-5');
    expect(await screen.findByText('Kommt vor in', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(leftover([], true)).toEqual([]);
    expect(rawKeys(true)).toEqual([]);
  });
});

describe('practice, in German', () => {
  it('every turn, every verdict and the way out are German', async () => {
    await renderAt('/v4/space/s-dbs/lesson/l-s-dbs-4/practice');
    expect(await screen.findByLabelText('Übung verlassen', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Fortschritt in dieser Übung' })).toBeInTheDocument();

    /* Always the first choice: some hold, some miss and come back for a second look. */
    for (let guard = 0; guard < 30; guard++) {
      /* The next question arrives once the last one has animated out. */
      await waitFor(() => expect(document.querySelector('li button[aria-disabled="false"]')).not.toBeNull(), {
        timeout: 3000,
      });
      const deck = [
        document.querySelector('h1')?.textContent ?? '',
        ...[...document.querySelectorAll('li')].map((li) => li.textContent ?? ''),
      ];
      fireEvent.click(document.querySelector('li button[aria-disabled="false"]')!);
      await act(async () => {});
      const status = document.querySelector('[role="status"]')!;
      const explanation = status.querySelectorAll('p')[1]?.textContent ?? '';
      expect(leftover([...deck, explanation])).toEqual([]);
      expect(rawKeys()).toEqual([]);
      const next = screen.queryByRole('button', { name: /Nächste Frage/ });
      if (next) {
        fireEvent.click(next);
        await act(async () => {});
        continue;
      }
      fireEvent.click(screen.getByRole('button', { name: /Sieh dir an, wie es lief/ }));
      await act(async () => {});
      break;
    }

    expect(screen.getByRole('button', { name: /Noch mal/ })).toBeInTheDocument();
    const deck = [...document.querySelectorAll('li')].map((li) => li.textContent ?? '');
    expect(leftover(deck)).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('a Lesson with no practice says so in German', async () => {
    await renderAt('/v4/space/s-dbs/lesson/l-s-dbs-10/practice');
    expect(await screen.findByText('Hier gibt es noch keine Übungen', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('Zurück zur Lektion')).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});

describe('the /read reader, in German', () => {
  /* The passages, and the demo's own notes (somebody's writing, not chrome). */
  const passages = () => [
    ...[...document.querySelectorAll('article section, article h1')].map((el) => el.textContent ?? ''),
    ...notesForLesson('l-s-dbs-4').map((n) => n.body),
  ];
  const sheet = () =>
    [...document.querySelectorAll('[data-source-column] h1, [data-source-column] h2, [data-source-column] li')].map(
      (el) => el.textContent ?? '',
    );

  it('the text, both companions and the Material say nothing in English', async () => {
    await renderAt('/v4/space/s-dbs/lesson/l-s-dbs-4/read');
    await screen.findByRole('banner', {}, { timeout: 4000 });
    expect(screen.getByText('Üben, was du gerade gelesen hast', { exact: false })).toBeInTheDocument();
    expect(leftover(passages())).toEqual([]);

    /* Notes, then the tutor, in the rail. */
    fireEvent.click(screen.getByRole('button', { name: /Notizen/ }));
    await act(async () => {});
    expect(screen.getByRole('complementary', { name: 'Begleiter beim Lesen' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Notizen' })).toBeInTheDocument();
    expect(leftover(passages())).toEqual([]);
    fireEvent.click(screen.getByRole('tab', { name: 'Luna' }));
    await act(async () => {});
    expect(leftover(passages())).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Begleiter schließen' }));
    await act(async () => {});

    /* The Material. */
    fireEvent.click(screen.getByRole('tab', { name: /Quelle|Material/ }));
    await act(async () => {});
    expect(screen.getByText('Das Material, aus dem diese Lektion entstanden ist')).toBeInTheDocument();
    expect(screen.getByText(/Diese Seite gehört zu/)).toBeInTheDocument();
    expect(leftover(sheet())).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Seite' }));
    await act(async () => {});
    expect(leftover(sheet())).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('an unwritten Lesson says so in German', async () => {
    await renderAt('/v4/space/s-dbs/lesson/l-s-dbs-3/read');
    expect(await screen.findByText('Noch nicht geschrieben', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});
