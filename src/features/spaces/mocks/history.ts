/**
 * Days you studied, and the runs that fall out of them.
 *
 * ## Why the days are the fixture and the run is derived
 *
 * The streak was the number `4`, written out in four places that could not
 * check each other:
 *
 *   1. `data/useSpaces.ts` — `streakDays: ready ? 4 : 0`, for Home.
 *   2. `screens/ProfileScreen.tsx` — `const STREAK: number = 4`.
 *   3. `mocks/library.ts` — badge `b-3`, "Four in a row · Four days running".
 *   4. `mocks/notifications.ts` — "You have studied four days in a row."
 *
 * Two as digits and two as English, so no amount of type-checking could ever
 * have caught them drifting. Home could say five while Profile said four and
 * both would look right — the same failure as the three ranks, one worse.
 *
 * A run is not a fact anyone should state. It is a consequence of which days
 * you studied, so that list is the fixture and everything else is computed.
 *
 * ## Why there is no clock
 *
 * A mock has no today. Anchoring to the real date would mean the streak
 * quietly dies overnight and the tests along with it — green on Tuesday, red
 * on Wednesday, for no change anybody made. `TODAY` is the day these fixtures
 * are written against, and every run is measured back from it.
 */

/** The day this fixture set is anchored to. A mock has no clock. */
export const TODAY = '2026-08-31';

export interface StudyDay {
  /** `YYYY-MM-DD`. */
  date: string;
  /** What you did, in your own terms. One line — this is a record, not a log. */
  summary: string;
}

/**
 * The days themselves.
 *
 * Deliberately shaped so the current run and the longest run **differ**: four
 * days now, six in mid-August. A fixture where they are equal leaves the
 * screen's two numbers indistinguishable, and every render path that treats
 * them separately untested — the same reason all five XP sources needed a
 * fixture each.
 */
export const studyDays: StudyDay[] = [
  // The current run — four days, ending on TODAY.
  { date: '2026-08-31', summary: 'Practice on Normalization — 8 of 10' },
  { date: '2026-08-30', summary: 'Read “Functional dependencies”' },
  { date: '2026-08-29', summary: 'Finished “Normalization”' },
  { date: '2026-08-28', summary: 'Practice on Joins — 6 of 10' },

  // A gap: the 25th to the 27th.
  { date: '2026-08-24', summary: 'Read “Query planning”' },
  { date: '2026-08-23', summary: 'Practice on Indexes — 9 of 10' },

  // The longest run — six days, the 12th to the 17th.
  { date: '2026-08-17', summary: 'Finished “Orthogonality and Projections”' },
  { date: '2026-08-16', summary: 'Practice on Projections — 7 of 10' },
  { date: '2026-08-15', summary: 'Read “Eigenvectors”' },
  { date: '2026-08-14', summary: 'Finished “Eigenvalues”' },
  { date: '2026-08-13', summary: 'Practice on Matrices — 10 of 10' },
  { date: '2026-08-12', summary: 'Finished “Vectors and Matrices”' },

  { date: '2026-08-08', summary: 'Read “Determinants”' },
  { date: '2026-08-05', summary: 'Finished your first Lesson' },
];

const asUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const DAY = 86_400_000;

/** Whole days between two `YYYY-MM-DD` strings. */
const daysBetween = (a: string, b: string) => Math.round((asUtc(a) - asUtc(b)) / DAY);

/** Newest first, de-duplicated — two entries for one day is still one day. */
const orderedDays = (): string[] =>
  [...new Set(studyDays.map((d) => d.date))].sort((a, b) => asUtc(b) - asUtc(a));

/**
 * Consecutive days ending at the most recent one you studied.
 *
 * Counts back from the latest recorded day rather than from `TODAY`, so a day
 * off does not retroactively erase the run you actually had. What that run
 * means today is a question for the screen, which says when it last ran; this
 * only reports the length.
 */
export const currentRun = (): number => {
  const days = orderedDays();
  if (days.length === 0) return 0;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    if (daysBetween(days[i - 1], days[i]) !== 1) break;
    run += 1;
  }
  return run;
};

/** The longest stretch of consecutive days anywhere in the record. */
export const longestRun = (): number => {
  const days = orderedDays();
  if (days.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = daysBetween(days[i - 1], days[i]) === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
};

/** The most recent day you studied, or `null` if you never have. */
export const lastStudied = (): string | null => orderedDays()[0] ?? null;

/** Every day you studied. Not a score — the screen says so in words. */
export const daysStudied = (): number => orderedDays().length;

/**
 * The last `weeks` weeks as rows of seven, oldest row first, each day flagged.
 *
 * Weeks start Monday, and the grid ends on the week containing `TODAY`. Built
 * here rather than in the screen so the calendar and the run counts cannot
 * disagree about which days they are talking about.
 */
export const recentWeeks = (
  weeks = 6,
): { date: string; studied: boolean; future: boolean }[][] => {
  const studied = new Set(orderedDays());
  const today = asUtc(TODAY);
  // `getUTCDay()` is 0 for Sunday; shift so Monday is 0.
  const weekday = (new Date(today).getUTCDay() + 6) % 7;
  const lastMonday = today - weekday * DAY;
  const start = lastMonday - (weeks - 1) * 7 * DAY;

  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = new Date(start + (w * 7 + d) * DAY).toISOString().slice(0, 10);
      /*
       * Days after TODAY are marked, not merely unstudied.
       *
       * The grid ends on the week containing TODAY, so up to six of its cells
       * are days that have not happened. Drawn the same as an unstudied day
       * they read as six days already missed — which is the exact pressure
       * this screen is meant not to apply. The screen renders them as absent.
       */
      return { date, studied: studied.has(date), future: asUtc(date) > today };
    }),
  );
};
