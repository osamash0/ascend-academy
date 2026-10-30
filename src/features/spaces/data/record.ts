import * as history from '../mocks/history';
import * as rank from '../mocks/rank';
import { moments as fixtureMoments, type Moment } from '../mocks/moments';
import type { StudyDay } from '../mocks/history';
import type { XpEvent, XpSource } from '../mocks/rank';
import { liveWorld } from './world';

export { standingFor, xpForRank, type XpSource } from '../mocks/rank';
export type { StudyDay, XpEvent, Moment };

/**
 * The viewer's record — study days, the XP ledger, Moments — for Profile,
 * History, Rank and Moments.
 *
 * Demo: the fixtures, unchanged. Live: the world's record, built from
 * learning_events (days), xp_events (the ledger) and achievements (Moments).
 * The arithmetic — runs, calendars, totals by source — is one implementation
 * over whichever days and events apply, so the two modes cannot count
 * differently.
 */

const asUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((asUtc(a) - asUtc(b)) / DAY);

/** The day the record is read on: the fixtures' anchor in demo, today live. */
export const todayNow = (): string =>
  liveWorld() ? new Date().toISOString().slice(0, 10) : history.TODAY;

export const studyDaysNow = (): StudyDay[] => liveWorld()?.record.studyDays ?? history.studyDays;

export const xpEventsNow = (): XpEvent[] => liveWorld()?.record.xpEvents ?? rank.xpEvents;

export const momentsNow = (): Moment[] => liveWorld()?.record.moments ?? fixtureMoments();

/** Newest first, de-duplicated — two entries for one day is still one day. */
const ordered = (days: StudyDay[]): string[] =>
  [...new Set(days.map((d) => d.date))].sort((a, b) => asUtc(b) - asUtc(a));
const orderedDays = (): string[] => ordered(studyDaysNow());

/**
 * Consecutive days ending at the most recent one studied, over the days given.
 * Home and Profile both count with this, so they cannot disagree about one run.
 */
export const runIn = (studyDays: StudyDay[]): number => {
  const days = ordered(studyDays);
  if (days.length === 0) return 0;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    if (daysBetween(days[i - 1], days[i]) !== 1) break;
    run += 1;
  }
  return run;
};

/** Consecutive days ending at the most recent one studied. */
export const currentRun = (): number => runIn(studyDaysNow());

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

export const lastStudied = (): string | null => orderedDays()[0] ?? null;

export const daysStudied = (): number => orderedDays().length;

/** The last `weeks` weeks as rows of seven (Monday first), ending on today's week. */
export const recentWeeks = (weeks = 6): { date: string; studied: boolean; future: boolean }[][] => {
  const studied = new Set(orderedDays());
  const today = asUtc(todayNow());
  const weekday = (new Date(today).getUTCDay() + 6) % 7;
  const start = today - weekday * DAY - (weeks - 1) * 7 * DAY;
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = new Date(start + (w * 7 + d) * DAY).toISOString().slice(0, 10);
      return { date, studied: studied.has(date), future: asUtc(date) > today };
    }),
  );
};

/** XP by source, largest first. */
export const xpBySource = (): { source: XpSource; total: number; count: number }[] => {
  const totals = new Map<XpSource, { total: number; count: number }>();
  for (const e of xpEventsNow()) {
    const cur = totals.get(e.source) ?? { total: 0, count: 0 };
    totals.set(e.source, { total: cur.total + e.amount, count: cur.count + 1 });
  }
  return [...totals.entries()]
    .map(([source, v]) => ({ source, ...v }))
    .sort((a, b) => b.total - a.total);
};
