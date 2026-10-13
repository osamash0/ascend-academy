import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import RehearsalScreen from '../../screens/RehearsalScreen';
import type { Rehearsal, RehearsalHistory } from '../../data/liveRepository';

/*
 * A German student rehearses without one English word of chrome.
 *
 * The course's own words (its title, its lessons, its ideas, the questions
 * the model wrote) are data and stay as they are; they are chosen here so
 * they cannot trip the sentinel. What is checked is everything the rehearsal
 * itself says: visible text plus every aria-label, title and placeholder.
 */

const COURSE = {
  id: 'c-dbs',
  title: 'Datenbanksysteme',
  lectures: [
    { id: 'l1', order: 1, title: 'Normalformen', ideas: [] },
    { id: 'l2', order: 2, title: 'Hüllen', ideas: [] },
  ],
};

const DAY = 86_400_000;
const HISTORY: RehearsalHistory = {
  attempts: [{ id: 'a1', title: 'Probe', score: 3, total: 5, created_at: new Date(Date.now() - 3 * DAY).toISOString() }],
  weak: [
    { lecture_id: 'l1', lecture_title: 'Normalformen', idea: 'BCNF', page: 12, missed: 2 },
    { lecture_id: 'l1', lecture_title: 'Normalformen', idea: '3NF', page: 14, missed: 1 },
  ],
  steady_count: 0,
} as RehearsalHistory;

const base = { lecture_id: 'l1', page: 7, idea: 'Schlüssel', prompt: 'Welche?', why: 'Weil.' };
const REHEARSAL: Rehearsal = {
  title: 'Probe zwei',
  lectures: { l1: 'Normalformen' },
  questions: [
    { ...base, id: 1, kind: 'choice', options: [{ text: 'Ja' }, { text: 'Nein', correct: true }] },
    { ...base, id: 2, kind: 'order', items: ['Eins', 'Zwei', 'Drei'], shuffle: [2, 0, 1] },
    {
      ...base,
      id: 3,
      kind: 'fdHolds',
      columns: ['A', 'B'],
      rows: [
        ['1', 'x'],
        ['1', 'y'],
      ],
      candidates: [{ lhs: ['A'], rhs: ['B'] }],
    },
    { ...base, id: 4, kind: 'closure', attrs: ['A', 'B', 'C'], start: ['A'], fds: [{ lhs: ['A'], rhs: ['B'] }] },
    { ...base, id: 5, kind: 'bcnf', relation: 'R', attrs: ['A', 'B', 'C'], fds: [{ lhs: ['B'], rhs: ['C'] }] },
  ],
} as Rehearsal;

const compose = vi.fn<() => Promise<Rehearsal>>();
vi.mock('../../data/useReader', () => ({
  useCourse: () => ({ state: 'ready', course: COURSE }),
  useRehearsalHistory: () => ({ history: HISTORY, reload: () => {} }),
  composeRehearsal: () => compose(),
  saveRehearsal: () => Promise.reject(new Error('offline')),
}));
vi.mock('../course/today', () => ({
  fadingIdeas: () => [{ lectureId: 'l2', lectureTitle: 'Hüllen', name: 'Armstrong', page: 21, days: 9 }],
}));

const ENGLISH_CHROME = [
  'Leave the rehearsal',
  'Rehearse',
  'rehearsal',
  'Lessons',
  'Clear',
  'All',
  'Length',
  'Number of questions',
  'questions',
  'Couldn’t',
  'Try again',
  'Writing your',
  'Reading',
  'half a minute',
  'Question',
  'Next question',
  'See how it went',
  'Saving',
  'Saved',
  'history',
  'Flawless',
  'Strong',
  'Getting there',
  'Worth another pass',
  'By Lesson',
  'Read again',
  'page',
  'Page',
  'Back to',
  'weak spots',
  'so far',
  'last',
  'Ideas you missed',
  'missed',
  'No weak spots',
  'Fading',
  'days',
  'Refresh these',
  'Move',
  'Tick every',
  'Collect the closure',
  'Flag every',
  'Check',
  'Right',
  'Not quite',
  'Holds',
  'None of them',
  'Violating',
  'None violates',
  'today',
  'yesterday',
  'ago',
];

/** Everything the screen says: its text, and what it says to a screen reader. */
const said = () => {
  const root = document.body;
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [root.textContent ?? '', ...attrs].join('\n');
};

/* Whole words only: "All" must not trip on "Alle". */
const leftover = () => {
  const all = said();
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
/* No key printed raw instead of its words. */
const rawKeys = () => said().match(/\b(?:rehearse|question)\.[a-z][\w.]*/g) ?? [];
const clean = () => {
  expect(leftover()).toEqual([]);
  expect(rawKeys()).toEqual([]);
};

beforeEach(async () => {
  compose.mockReset();
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

const renderRehearsal = () =>
  render(
    <MemoryRouter initialEntries={['/v4/space/c-dbs/rehearse']}>
      <Routes>
        <Route path="/v4/space/:id/rehearse" element={<RehearsalScreen courseId="c-dbs" />} />
      </Routes>
    </MemoryRouter>,
  );

describe('the rehearsal, in German', () => {
  it('sets up, asks every kind of question and debriefs in German', async () => {
    let resolve: (r: Rehearsal) => void = () => {};
    compose.mockReturnValue(new Promise<Rehearsal>((r) => (resolve = r)));
    renderRehearsal();
    expect(screen.getByRole('heading', { name: 'Für die Prüfung üben' })).toBeInTheDocument();
    expect(screen.getByText('vor 3 Tagen', { exact: false })).toBeInTheDocument();
    clean();

    fireEvent.click(screen.getByRole('button', { name: /Probedurchlauf erstellen/ }));
    expect(screen.getByText('Dein Probedurchlauf entsteht')).toBeInTheDocument();
    clean();

    await act(async () => resolve(REHEARSAL));
    expect(screen.getByText('Frage 1 von 5')).toBeInTheDocument();
    clean();

    /* Every kind: answer, check, read the verdict, go on. */
    for (let i = 0; i < REHEARSAL.questions.length; i++) {
      const check = await screen.findByRole('button', { name: 'Prüfen' }, { timeout: 3000 });
      expect(screen.getByText(`Frage ${i + 1} von 5`)).toBeInTheDocument();
      if (REHEARSAL.questions[i].kind === 'choice') fireEvent.click(screen.getByRole('button', { name: /^A\s*Ja$/ }));
      clean();
      fireEvent.click(check);
      await waitFor(() => expect(screen.getByText(/Richtig|Nicht ganz/)).toBeInTheDocument());
      clean();
      fireEvent.click(screen.getByRole('button', { name: i === REHEARSAL.questions.length - 1 ? /Zum Ergebnis/ : /Nächste Frage/ }));
      await act(async () => {});
    }

    await waitFor(() => expect(screen.getByText(/nicht in deinem Verlauf speichern/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Neuer Probedurchlauf/ })).toBeInTheDocument();
    clean();
  });

  it('says a failed composition in German', async () => {
    compose.mockReturnValue(Promise.reject(new Error('busy')));
    renderRehearsal();
    fireEvent.click(screen.getByRole('button', { name: /Diese üben/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Schwachstellen');
    clean();
  });
});
