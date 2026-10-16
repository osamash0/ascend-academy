import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { say, pagesPhrase, phrase } from '../course/phrase';
import { CourseMap } from '../course/CourseMap';
import { ExamRunway } from '../course/ExamRunway';
import { planExam } from '../course/examPlan';

/*
 * The Space page's plan, in German. The planners return phrases; these are
 * said the way German says them — its word order, its plurals, its lists —
 * and nothing on the page is left in English.
 */

const t = i18n.getFixedT('de', 'v4Space');
const en = i18n.getFixedT('en', 'v4Space');

const LECTURES = [
  { id: 'a', title: 'Basics', total_slides: 20, ideas: [{ name: 'Keys', first_page: 1 }] },
  {
    id: 'b',
    title: 'Normalization',
    total_slides: 60,
    ideas: [
      { name: 'FDs', first_page: 1 },
      { name: 'Closure', first_page: 31 },
      { name: 'BCNF', first_page: 41 },
    ],
  },
];
const course = {
  id: 'c-live',
  title: 'Database Systems',
  author: 'A. Teacher',
  lectures: LECTURES.map((l, i) => ({ ...l, order: i + 1, poster: null })),
};
const MARKS = [
  { lecture_id: 'b', page: 33, correct: false },
  { lecture_id: 'b', page: 45, correct: false },
];

vi.mock('../../data/useReader', () => ({
  useCourse: () => ({ state: 'ready', course }),
  useCourseLinks: () => ({ state: 'ready', links: [] }),
  useFind: () => ({ busy: false, results: [] }),
  useRehearsalHistory: () => ({ history: { marks: MARKS, weak: [{ lecture_id: 'b', idea: 'Closure', page: 33 }] }, reload: () => {} }),
}));

const ENGLISH_CHROME = [
  'Today',
  'Tomorrow',
  'Rehearse',
  'Read on',
  'Revisit',
  'Refresh',
  'Open',
  'Builds on',
  'Start with',
  'starting point',
  'Tested right',
  'Fading',
  'To revisit',
  'Not tested yet',
  'Journey',
  'Map',
  'Legend',
  'Exam',
  'pages',
  'page',
  'Lessons',
  'missed it',
  'Missed last time',
  'Full rehearsal',
  'five questions',
  'Where was',
  'When is your exam',
  'Point at an idea',
  'free day',
];

/* The shared top bar is slice 3's; this checks the Space page under it. */
const said = () => {
  const root = document.body.cloneNode(true) as HTMLElement;
  root.querySelectorAll('header').forEach((h) => h.remove());
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [root.textContent ?? '', ...attrs].join('\n');
};
/* Whole words; the deck's own names (Basics, Normalization, Keys, …) are not chrome. */
const leftover = () => {
  const all = said();
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
const rawKeys = () => said().match(/\b(?:plan|light|course|map|runway)\.[a-z][\w.]*/g) ?? [];

beforeEach(async () => {
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

describe('a plan’s words, said in German', () => {
  it('orders, counts and lists the way German does', () => {
    expect(say(t, phrase('plan.today.resume', { page: 34, count: 12 }))).toBe('Ab Seite 34 · noch 12 Seiten');
    expect(say(t, phrase('plan.today.resume', { page: 59, count: 1 }))).toBe('Ab Seite 59 · noch 1 Seite');
    expect(say(t, phrase('plan.exam.fading', { lesson: 'Normalization', pages: pagesPhrase(31, 39) }))).toBe(
      'Verblasst · Normalization, Seiten 31–39',
    );
    expect(say(t, phrase('plan.exam.chunk.title', { lessons: ['Basics', 'Keys', 'Normalization'] }))).toBe(
      'Basics, Keys und Normalization üben',
    );
    /* A deck's own name is said as it is, in any language. */
    expect(say(t, 'Normalization')).toBe('Normalization');
  });

  it('says the same phrases in English, too', () => {
    expect(say(en, phrase('plan.exam.missed', { lesson: 'Normalization', pages: pagesPhrase(67, 67) }))).toBe(
      'Missed last time · Normalization, page 67',
    );
  });
});

describe('the Space page, in German', () => {
  it('the map says what an idea builds on, and where to start', async () => {
    render(
      <MemoryRouter>
        <CourseMap
          lectures={LECTURES}
          marks={MARKS}
          links={[
            { from: { lecture_id: 'a', first_page: 1 }, to: { lecture_id: 'b', first_page: 1 }, why: '' },
            { from: { lecture_id: 'b', first_page: 1 }, to: { lecture_id: 'b', first_page: 31 }, why: '' },
            { from: { lecture_id: 'b', first_page: 31 }, to: { lecture_id: 'b', first_page: 41 }, why: '' },
          ]}
          linksState="ready"
          readHref={(l, p) => `/read/${l}/${p}`}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'BCNF, Normalization, zum Wiederholen' })).toBeInTheDocument();
    fireEvent.focus(screen.getByRole('link', { name: /^BCNF/ }));
    expect(await screen.findByText(/Baut auf/)).toHaveTextContent('Baut auf Closure auf');
    expect(screen.getByRole('button', { name: /Fang mit Closure an – sie ist rot/ })).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('the runway to the exam, and a day opened on it', () => {
    const plan = planExam({
      lectures: LECTURES,
      trail: {},
      marks: MARKS,
      weak: [{ lecture_id: 'b', idea: 'Closure', page: 33 }],
      exam: '2026-11-20',
      today: '2026-11-10',
      now: Date.UTC(2026, 10, 10),
    });
    render(
      <MemoryRouter>
        <ExamRunway plan={plan} examDate="2026-11-20" hrefFor={() => '/x'} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.getAllByText('Heute').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button')[8]);
    expect(screen.getByText('Kompletter Probedurchlauf')).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('the whole page — Today, the exam, the journey — says nothing in English', async () => {
    const { default: CourseScreen } = await import('../../screens/CourseScreen');
    render(
      <MemoryRouter>
        <CourseScreen courseId="c-live" />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Heute' })).toBeInTheDocument();
    expect(screen.getByText('Für die Prüfung üben')).toBeInTheDocument();
    /* Search suggestions are terms in the deck's language — English decks, English terms. */
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});
