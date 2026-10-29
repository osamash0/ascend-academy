import type { Attention, Landing, LandingInsight, LandingLesson, LandingQuestion, Themes } from '../landing/types';
import { stageAccentFor } from '../components/stage';
import { lindqvist, okonkwo, weber, ferreira, viewer } from './people';

/**
 * How it's landing — fixtures.
 *
 * Two Spaces, chosen to cover the two states that matter:
 *
 *   • Database Systems: 184 members, 131 reading, ten Lessons — the Space a
 *     professor runs. Seven findings across six Lessons, three questions
 *     waiting, one already answered for everyone, and four Lessons that are
 *     too new to say anything about. The numbers are shaped to look like a
 *     real term (one hot page, one trap, one wall), not to look tidy.
 *
 *   • Linear Algebra, together: six friends, four of them reading — the Space
 *     a learner makes for a study group. Everything sits under the five-reader
 *     floor, which is the honest state and the one the screen must carry well.
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
 * trouble is rarely one page wide.
 */
function helpFor(pages: number, findings: LandingInsight[]): number[] {
  const values = Array.from({ length: pages }, (_, i) => 0.06 + ((i * 7) % 5) * 0.012);
  const raise = (i: number, v: number) => {
    if (i >= 0 && i < pages) values[i] = Math.max(values[i], v);
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

type LessonSeed = Omit<LandingLesson, 'color' | 'help'>;

/** Colour from the cover palette; help from the findings, unless under the floor. */
const lessonsFrom = (seeds: LessonSeed[], insights: LandingInsight[]): LandingLesson[] =>
  seeds.map((l) => ({
    ...l,
    color: stageAccentFor(l.order),
    help: l.light === 'few' ? undefined : helpFor(l.pages, insights.filter((i) => i.lessonId === l.id)),
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
    { id: 'l-s-dbs-7', title: 'Integrity', order: 7, pages: 16, readers: 3, light: 'few' },
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
  readers: 131,
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
  readers: 4,
  floor: 5,
  figures: {
    reading: { value: 4, history: [0, 1, 2, 2, 3, 3, 4, 4] },
    landing: { value: 0, history: [] },
    cleared: { value: 0, history: [] },
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

/** The viewer's own study group, so the lab can show the owner side of it. */
export const friendsOwner = viewer;

export const landings: Record<string, Landing> = {
  [dbsLanding.spaceId]: dbsLanding,
  [friendsLanding.spaceId]: friendsLanding,
};

export const landingFor = (spaceId: string): Landing | null => landings[spaceId] ?? null;
