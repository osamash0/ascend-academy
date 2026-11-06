import type { Attention, Landing, LandingInsight, LandingLesson, LandingQuestion, Themes } from '../landing/types';
import { stageAccentFor } from '../components/stage';
import { lindqvist, okonkwo, weber, ferreira, keller, viewer } from './people';

/**
 * How it's landing — fixtures.
 *
 * Two Spaces, chosen to cover the two states that matter:
 *
 *   • Database Systems: 184 members, 131 reading, ten Lessons — the Space a
 *     professor runs. Seven findings across six Lessons, three questions
 *     waiting, one already answered for everyone, one Lesson people are only
 *     starting (its later pages are outlines), and three Lessons too new to
 *     say anything about. The numbers are shaped to look like a
 *     real term (one hot page, one trap, one wall), not to look tidy.
 *
 *   • Linear Algebra, together: six friends, four of them reading — the Space
 *     a learner makes for a study group. Everything sits under the five-reader
 *     floor, which is the honest state and the one the screen must carry well.
 *
 *   • Software Engineering: a big Space, to judge what folds. 28 Lessons (one
 *     of them 120 pages), quiet stretches between the ones that need the
 *     owner, one Lesson with four findings, eight Lessons too new to say
 *     anything about, 14 questions waiting and 9 answered.
 *
 * Shapes are the engine's (backend/services/insights); the figures are
 * plausible, not observed — do not treat them as real numbers. Each Lesson's
 * colour is the cover palette by order; live it is sampled from its first page.
 */

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** How far a finding raises the help index of its page. */
const RAISE: Record<Attention, number> = { act: 1, watch: 0.62, calm: 0.4 };

/**
 * One help value per page: a calm floor, each finding's page raised by its
 * attention, and the pages either side carrying a little of it, because
 * trouble is rarely one page wide. Past `reached`, fewer than five people
 * have been through a page: null, as the engine sends it.
 */
function helpFor(pages: number, findings: LandingInsight[], reached = pages): (number | null)[] {
  const values: (number | null)[] = Array.from({ length: pages }, (_, i) => (i < reached ? 0.06 + ((i * 7) % 5) * 0.012 : null));
  const raise = (i: number, v: number) => {
    if (i < 0 || i >= reached) return;
    values[i] = Math.max(values[i] as number, v);
  };
  for (const f of findings) {
    if (!f.page) continue;
    const top = RAISE[f.attention];
    raise(f.page - 1, top);
    raise(f.page - 2, top * 0.35);
    raise(f.page, top * 0.25);
  }
  return values;
}

type LessonSeed = Omit<LandingLesson, 'color' | 'help'> & {
  /** Pages at least five people have been through; the rest are outlines. All of them when absent. */
  reached?: number;
};

/** Colour from the cover palette; help from the findings, unless under the floor. */
const lessonsFrom = (seeds: LessonSeed[], insights: LandingInsight[]): LandingLesson[] =>
  seeds.map(({ reached, ...l }) => ({
    ...l,
    color: stageAccentFor(l.order),
    help: l.light === 'few' ? undefined : helpFor(l.pages, insights.filter((i) => i.lessonId === l.id), reached),
  }));

/* ── Database Systems ─────────────────────────────────────────────── */

const DBS_INSIGHTS: LandingInsight[] = [
  {
    id: 'i-dbs-hotspot-12',
    kind: 'confusion_hotspot',
    attention: 'act',
    severity: 0.86,
    lessonId: 'l-s-dbs-4',
    page: 12,
    metrics: { askers: 41, foggy: 46, explain: 29, ask: 18, sent: 3 },
    themes: true,
  },
  {
    id: 'i-dbs-trap-9',
    kind: 'silent_misleader',
    attention: 'act',
    severity: 0.79,
    lessonId: 'l-s-dbs-5',
    page: 9,
    metrics: { clicked: 78, missed: 61, pairs: 69 },
    grid: { clickedCleared: 21, clickedMissed: 33, foggyCleared: 6, foggyMissed: 9 },
  },
  {
    id: 'i-dbs-wall-18',
    kind: 'leaky_bucket',
    attention: 'watch',
    severity: 0.62,
    lessonId: 'l-s-dbs-6',
    page: 18,
    metrics: { pct: 31, before: 84, after: 58 },
  },
  {
    id: 'i-dbs-bump-7',
    kind: 'speed_bump',
    attention: 'watch',
    severity: 0.55,
    lessonId: 'l-s-dbs-4',
    page: 7,
    metrics: { backs: 23, median: 74, lessonMedian: 38 },
  },
  {
    id: 'i-dbs-question-22',
    kind: 'quiz_misalignment',
    attention: 'watch',
    severity: 0.48,
    lessonId: 'l-s-dbs-6',
    page: 22,
    metrics: { pct: 38, median: 18, foggy: 4, attempts: 61 },
  },
  {
    id: 'i-dbs-skipped-5',
    kind: 'skipped_slide',
    attention: 'calm',
    severity: 0.41,
    lessonId: 'l-s-dbs-3',
    page: 5,
    metrics: { seconds: 3, views: 117, short: 94 },
  },
  {
    id: 'i-dbs-healthy-2',
    kind: 'healthy',
    attention: 'calm',
    severity: 0.12,
    lessonId: 'l-s-dbs-2',
    metrics: { firstTry: 91, foggy: 6 },
  },
];

const DBS_LESSONS = lessonsFrom(
  [
    { id: 'l-s-dbs-1', title: 'Introduction', order: 1, pages: 18, readers: 131, light: 'calm' },
    { id: 'l-s-dbs-2', title: 'Basics', order: 2, pages: 24, readers: 131, light: 'calm' },
    { id: 'l-s-dbs-3', title: 'Relational Design', order: 3, pages: 22, readers: 120, light: 'watch' },
    { id: 'l-s-dbs-4', title: 'Normalization', order: 4, pages: 12, readers: 118, light: 'act' },
    { id: 'l-s-dbs-5', title: 'Relational Algebra', order: 5, pages: 20, readers: 96, light: 'act' },
    { id: 'l-s-dbs-6', title: 'SQL', order: 6, pages: 28, readers: 84, light: 'watch' },
    // Nine people have started it; past page 6 fewer than five have been through a page.
    { id: 'l-s-dbs-7', title: 'Integrity', order: 7, pages: 16, readers: 9, light: 'calm', reached: 6 },
    { id: 'l-s-dbs-8', title: 'Transactions', order: 8, pages: 26, readers: 0, light: 'few' },
    { id: 'l-s-dbs-9', title: 'Query Processing', order: 9, pages: 30, readers: 0, light: 'few' },
    { id: 'l-s-dbs-10', title: 'Index Structures', order: 10, pages: 24, readers: 0, light: 'few' },
  ],
  DBS_INSIGHTS,
);

const DBS_THEMES: Themes[] = [
  {
    lessonId: 'l-s-dbs-4',
    page: 12,
    askers: 41,
    themes: [
      'Why a BCNF split can lose a dependency that 3NF keeps',
      'Whether to split further or stop at 3NF',
      'What “determinant” means on this page',
    ],
  },
];

const DBS_QUESTIONS: LandingQuestion[] = [
  {
    id: 'q-dbs-1',
    lessonId: 'l-s-dbs-4',
    page: 12,
    text: 'Why does the BCNF split on page 12 lose the dependency — isn’t 3NF supposed to keep it? Or is losing it the point?',
    asker: lindqvist,
    createdAt: hoursAgo(2),
  },
  {
    id: 'q-dbs-2',
    lessonId: 'l-s-dbs-5',
    page: 9,
    text: 'Is the join on page 9 a natural join or an equi-join? The symbol looks the same as the one on page 7.',
    asker: null,
    createdAt: hoursAgo(26),
  },
  {
    id: 'q-dbs-3',
    lessonId: 'l-s-dbs-6',
    page: 22,
    text: 'The practice question on page 22 asks about HAVING, but the page only shows WHERE. Am I missing a page?',
    asker: okonkwo,
    createdAt: hoursAgo(70),
  },
  {
    id: 'q-dbs-4',
    lessonId: 'l-s-dbs-2',
    page: 4,
    text: 'Does cardinality mean the number of rows?',
    asker: weber,
    createdAt: hoursAgo(120),
    answer: {
      text: 'No — it says how many of one thing can relate to another: one customer, many orders. The number of rows is a different question, and it changes every day.',
      forEveryone: true,
      at: hoursAgo(118),
    },
  },
];

export const dbsLanding: Landing = {
  spaceId: 's-dbs',
  spaceName: 'Database Systems',
  accent: '#06b6d4',
  members: 184,
  reach: 'enough',
  floor: 5,
  figures: {
    reading: { value: 131, history: [62, 88, 97, 104, 112, 109, 124, 131] },
    landing: { value: 71, history: [40, 48, 55, 58, 63, 66, 69, 71] },
    cleared: { value: 78, history: [70, 72, 74, 73, 76, 77, 77, 78] },
  },
  lessons: DBS_LESSONS,
  insights: DBS_INSIGHTS,
  questions: DBS_QUESTIONS,
  themes: DBS_THEMES,
};

/* ── Linear Algebra, together ─────────────────────────────────────── */

export const friendsLanding: Landing = {
  spaceId: 's-friends',
  spaceName: 'Linear Algebra, together',
  accent: '#84cc16',
  members: 6,
  reach: 'few',
  floor: 5,
  figures: {
    reading: { value: null, history: [null, null, null, null, null, null, null, null] },
    landing: { value: null, history: [] },
    cleared: { value: null, history: [] },
  },
  lessons: lessonsFrom(
    [
      { id: 'l-s-friends-1', title: 'Vectors and spaces', order: 1, pages: 14, readers: 4, light: 'few' },
      { id: 'l-s-friends-2', title: 'Matrices', order: 2, pages: 19, readers: 3, light: 'few' },
      { id: 'l-s-friends-3', title: 'Eigenvalues', order: 3, pages: 11, readers: 1, light: 'few' },
    ],
    [],
  ),
  insights: [],
  questions: [
    {
      id: 'q-friends-1',
      lessonId: 'l-s-friends-3',
      page: 6,
      text: 'Is the determinant trick on page 6 only for 2×2, or does it work for 3×3 too?',
      asker: ferreira,
      createdAt: hoursAgo(5),
    },
  ],
  themes: [],
};

/* ── Software Engineering (a big Space) ───────────────────────────── */

const BIG_TITLES = [
  'Why software fails', 'Requirements', 'Use cases', 'Domain models', 'Architecture styles', 'Layers and boundaries',
  'Interfaces', 'Design patterns', 'Concurrency', 'Testing basics', 'Test doubles', 'Version control in depth',
  'Code review', 'Continuous integration', 'Build systems', 'Dependencies', 'Logging', 'Observability', 'Performance',
  'Security basics', 'Threat models', 'Release engineering', 'Incident response', 'Postmortems', 'Technical debt',
  'Refactoring', 'Legacy code', 'Teams and process',
];

/** Lessons with a finding: 2, 9 (four of them), 12 (the 120-page one) and 20. 21 to 28 are too new to say. */
const BIG_INSIGHTS: LandingInsight[] = [
  { id: 'i-big-9-hot', kind: 'confusion_hotspot', attention: 'act', severity: 0.88, lessonId: 'l-s-big-9', page: 14, metrics: { askers: 37, foggy: 52, explain: 24, ask: 19, sent: 2 } },
  { id: 'i-big-9-trap', kind: 'silent_misleader', attention: 'act', severity: 0.74, lessonId: 'l-s-big-9', page: 21, metrics: { clicked: 71, missed: 55, pairs: 58 }, grid: { clickedCleared: 19, clickedMissed: 23, foggyCleared: 7, foggyMissed: 9 } },
  { id: 'i-big-9-bump', kind: 'speed_bump', attention: 'watch', severity: 0.51, lessonId: 'l-s-big-9', page: 6, metrics: { backs: 19, median: 66, lessonMedian: 35 } },
  { id: 'i-big-9-skip', kind: 'skipped_slide', attention: 'calm', severity: 0.36, lessonId: 'l-s-big-9', page: 24, metrics: { seconds: 4, views: 88, short: 70 } },
  { id: 'i-big-12-wall', kind: 'leaky_bucket', attention: 'watch', severity: 0.6, lessonId: 'l-s-big-12', page: 83, metrics: { pct: 27, before: 71, after: 52 } },
  { id: 'i-big-2-quiz', kind: 'quiz_misalignment', attention: 'watch', severity: 0.45, lessonId: 'l-s-big-2', page: 11, metrics: { pct: 41, median: 21, foggy: 5, attempts: 54 } },
  { id: 'i-big-20-skip', kind: 'skipped_slide', attention: 'calm', severity: 0.33, lessonId: 'l-s-big-20', page: 3, metrics: { seconds: 2, views: 64, short: 51 } },
];

const BIG_LESSONS = lessonsFrom(
  BIG_TITLES.map((title, i) => {
    const order = i + 1;
    const pages = order === 12 ? 120 : 14 + ((order * 5) % 17);
    return { id: `l-s-big-${order}`, title, order, pages, readers: order > 20 ? Math.max(0, 4 - (order - 21)) : 140 - order * 3, light: order > 20 ? 'few' : BIG_INSIGHTS.some((f) => f.lessonId === `l-s-big-${order}` && f.attention === 'act') ? 'act' : BIG_INSIGHTS.some((f) => f.lessonId === `l-s-big-${order}`) ? 'watch' : 'calm' } satisfies LessonSeed;
  }),
  BIG_INSIGHTS,
);

const BIG_ASKED: [number, number, string][] = [
  [9, 14, 'Is a race condition the same thing as a data race, or is one a kind of the other?'],
  [9, 21, 'Page 21 says the lock makes it safe, but what if the thread dies holding it?'],
  [12, 40, 'Why does the pipeline run the slow tests last instead of first?'],
  [2, 11, 'Is a non-functional requirement still a requirement if nobody can test it?'],
  [9, 6, 'What is the difference between a mutex and a semaphore with one slot?'],
  [12, 83, 'Do we need to know the whole caching section for the exam, or only the summary?'],
  [5, 9, 'Is hexagonal architecture just layers drawn as a hexagon?'],
  [10, 4, 'Should a unit test ever touch the file system?'],
  [20, 3, 'Is page 3 a typo, or does the hash really go before the salt?'],
  [9, 23, 'Can async code deadlock if it never uses a lock?'],
  [14, 7, 'What counts as breaking the build if the tests pass locally?'],
  [16, 12, 'Is pinning every dependency version good practice or a trap?'],
  [12, 101, 'Is a canary release the same as a blue-green deploy?'],
  [3, 5, 'How detailed should a use case be before it turns into a design?'],
  [1, 2, 'Is the Ariane 5 example on page 2 about testing or about requirements?'],
  [2, 6, 'Who signs off a requirement when the client is not sure?'],
  [8, 10, 'Is a singleton always an anti-pattern?'],
  [10, 9, 'How much coverage is enough?'],
  [11, 3, 'When is a fake better than a mock?'],
  [13, 5, 'How long should a code review take?'],
  [17, 8, 'Should logs ever contain a user id?'],
  [19, 4, 'Is premature optimisation always bad?'],
  [25, 2, 'Is technical debt always a bad thing?'],
];
const BIG_ASKERS = [lindqvist, null, okonkwo, weber, ferreira, keller];

const BIG_QUESTIONS: LandingQuestion[] = BIG_ASKED.map(([order, page, text], i) => ({
  id: `q-big-${i + 1}`,
  lessonId: `l-s-big-${order}`,
  page,
  text,
  asker: BIG_ASKERS[i % BIG_ASKERS.length],
  createdAt: hoursAgo(3 + i * 9),
  // The first fourteen wait; the last nine have been answered.
  answer: i < 14 ? undefined : { text: 'Answered in the session on Thursday, and the page now says it too.', forEveryone: i % 2 === 0, at: hoursAgo(1 + i * 8) },
}));

export const bigLanding: Landing = {
  spaceId: 's-big',
  spaceName: 'Software Engineering',
  accent: '#f59e0b',
  members: 212,
  reach: 'enough',
  floor: 5,
  figures: {
    reading: { value: 154, history: [80, 96, 110, 121, 133, 140, 149, 154] },
    landing: { value: 74, history: [52, 57, 61, 64, 68, 70, 72, 74] },
    cleared: { value: 69, history: [61, 63, 64, 66, 66, 67, 68, 69] },
  },
  lessons: BIG_LESSONS,
  insights: BIG_INSIGHTS,
  questions: BIG_QUESTIONS,
  themes: [],
};

/** The viewer's own study group, so the lab can show the owner side of it. */
export const friendsOwner = viewer;

export const landings: Record<string, Landing> = {
  [dbsLanding.spaceId]: dbsLanding,
  [friendsLanding.spaceId]: friendsLanding,
  [bigLanding.spaceId]: bigLanding,
};

export const landingFor = (spaceId: string): Landing | null => landings[spaceId] ?? null;
