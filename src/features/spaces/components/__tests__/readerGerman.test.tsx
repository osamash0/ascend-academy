import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { RefObject } from 'react';
import i18n from '@/i18n';
import LessonFacesScreen from '../../screens/LessonFacesScreen';
import { CheckpointCard } from '../reader/CheckpointCard';
import { TeachBack } from '../reader/TeachBack';
import type { Checkpoint, TeachBack as Reading } from '../../data/liveRepository';

/*
 * A German reader reads a Lesson without one English word of chrome.
 *
 * The demo Lesson's own words (its title, its ideas, its text) are English
 * and stay so — they are the deck's. What is checked is everything the
 * reader itself says: visible text plus every aria-label, title and
 * placeholder, against phrases only the English chrome uses.
 */
vi.mock('@/components/pdf', () => ({
  PdfPage: ({ page }: { page: number }) => <div data-testid="sheet" data-page={page} />,
  PdfPager: ({ rootRef }: { rootRef: RefObject<HTMLDivElement> }) => <div ref={rootRef} data-testid="document" />,
  pdfPageId: (p: number) => `pdf-page-${p}`,
  sampleAccent: () => null,
}));

const ENGLISH_CHROME = [
  'Leave the reader',
  'Ideas in this Lesson',
  'turns the page',
  'Previous page',
  'Next page',
  'Night paper',
  'Light paper',
  'the contents',
  'How to read',
  'Points on this page',
  'Practise',
  'Back to',
  'Explain this',
  'Read this',
  'Show page',
  'Got it',
  'Close',
  'Ask about',
  'Tested right',
  'Not tested yet',
  'To revisit',
  'Check',
  'Finish',
  'Next question',
  'Not now',
  'One question',
  'Keep reading',
  'Try again',
  'your own words',
  'Just text',
  'Parts to explore',
  'On this page',
];

/** Everything the screen says: its text, and what it says to a screen reader. */
const said = () => {
  const root = document.body;
  /* The deck's own words, as the text view sets them, are the deck's — not the reader's. */
  const deck = [...root.querySelectorAll('[data-page]')].map((el) => el.textContent ?? '');
  const text = deck.reduce((all, words) => all.replace(words, ''), root.textContent ?? '');
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [text, ...attrs].join('\n');
};

/* Whole words only: "Check" must not trip on "Checkpoint", which German keeps. */
const leftover = () => {
  const all = said();
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
/* No key printed raw instead of its words. */
const rawKeys = () => said().match(/\b(?:screen|chapters|checkpoint|teach|care|spine|toc|studio|companion|select|tutor|exit|practice|text|explain|blocks|views)\.[a-z][\w.]*/g) ?? [];

beforeEach(async () => {
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

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

describe('the reader, in German', () => {
  it('the page view says nothing in English', async () => {
    await renderFaces();
    expect(screen.getByRole('tablist', { name: 'Wie du diese Seite liest' })).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('the text view and its notes say nothing in English', async () => {
    await renderFaces();
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Text' }));
    });
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('the explain view says nothing in English', async () => {
    await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?view=explain');
    await act(async () => {});
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});

const CP = {
  idea: 'Closure',
  first: 32,
  last: 40,
  cached: true,
  questions: [
    {
      id: 1,
      kind: 'choice',
      lecture_id: 'l',
      page: 37,
      idea: 'Membership',
      prompt: 'Can D → A be derived?',
      why: 'D⁺ = {D, E}.',
      options: [{ text: 'Yes' }, { text: 'No', correct: true }],
    },
  ],
} as Checkpoint;

describe('the reader’s cards, in German', () => {
  it('a checkpoint offers, asks and reports in German', async () => {
    render(
      <MemoryRouter>
        <CheckpointCard
          idea={{ name: 'Closure', first: 32, last: 40 }}
          lectureTitle="Normalization"
          load={() => Promise.resolve(CP)}
          pageHref={(p) => `/read?page=${p}`}
          onDone={() => {}}
          onDismiss={() => {}}
        />
      </MemoryRouter>,
    );
    expect(leftover()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Eine Frage/ }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Checkpoint: Closure' })).toBeInTheDocument());
    expect(leftover()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /^B\s*No$/ }));
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('teach-back asks and answers in German', async () => {
    const reading: Reading = {
      idea: 'Attribute closure',
      first: 31,
      last: 39,
      verdict: 'partial',
      points: [{ point: 'Stop when nothing new is added.', page: 34, covered: false }],
      wrong: [],
      next: 'Look again at when it stops.',
    };
    render(
      <TeachBack
        idea={{ name: 'Attribute closure', first: 31, last: 39 }}
        read={() => Promise.resolve(reading)}
        onPage={() => {}}
        onResult={() => {}}
        onClose={() => {}}
      />,
    );
    expect(leftover()).toEqual([]);
    fireEvent.change(screen.getByLabelText(/eigenen Worten/), { target: { value: 'Man fängt mit X an und nimmt alles dazu.' } });
    fireEvent.click(screen.getByRole('button', { name: /Erklärung prüfen/ }));
    await waitFor(() => expect(screen.getByText('Fast geschafft.')).toBeInTheDocument());
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});
