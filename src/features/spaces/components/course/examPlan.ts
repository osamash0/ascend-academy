import { proofs, FADE_AFTER_DAYS, daysSince, type Mark } from './light';
import type { TodayStep } from './today';

/**
 * The days until the exam, planned from what the student has actually done.
 *
 * The shape, from the far end back:
 *   - the last day before the exam is light: only what is still red;
 *   - the day before that is a full rehearsal of every lecture;
 *   - before that, the unread pages are spread evenly, in lecture order,
 *     from where the student stopped — over about the first 70% of the
 *     days, so the rest is for going back, not for first reads;
 *   - review rides along: one missed or fading idea a reading day, two a
 *     day once the reading is done; missed ideas before fading ones;
 *   - every seventh day of reading ends with a short rehearsal of the
 *     lectures read that week.
 *
 * Dates are calendar dates (YYYY-MM-DD) counted in UTC, so a time zone can
 * never move a day. Pure: no DOM, no React.
 */

export interface PlanLecture {
  id: string;
  title: string;
  total_slides: number;
  ideas: { name: string; first_page: number }[] | null;
}

export interface PlanInput {
  lectures: PlanLecture[];
  /** Pages read so far per lecture (the trail's last page). */
  trail: Record<string, { page: number; pages: number }>;
  marks: Mark[];
  weak: { lecture_id: string; idea: string; page: number }[];
  exam: string;
  today: string;
  now?: number;
}

export type DayKind = 'read' | 'review' | 'rehearse' | 'eve';

export interface PlanDay {
  date: string;
  offset: number;
  kind: DayKind;
  steps: TodayStep[];
  minutes: number;
}

export interface ExamPlan {
  daysLeft: number;
  unreadPages: number;
  pagesPerDay: number;
  days: PlanDay[];
}

const DAY = 86_400_000;
const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY);
export const addDays = (d: string, n: number) => new Date(utc(d) + n * DAY).toISOString().slice(0, 10);
/** Today's calendar date where the student is. */
export const localToday = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** "pages 31–39", or "page 67" when an idea is a single page. */
const pagesOf = (first: number, last: number) => (first === last ? `page ${first}` : `pages ${first}–${last}`);
/** "A", "A & B", "A, B & C". */
const listOf = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`);

const reviewMinutes = (pages: number) => Math.max(3, Math.min(10, Math.round(pages * 0.7)));

function ideaRange(lec: PlanLecture, page: number): { name: string; first: number; last: number } | null {
  const ideas = [...(lec.ideas ?? [])].sort((a, b) => a.first_page - b.first_page);
  const i = ideas.reduce((at, x, k) => (x.first_page <= page ? k : at), -1);
  if (i < 0) return null;
  return { name: ideas[i].name, first: ideas[i].first_page, last: Math.max(ideas[i].first_page, (ideas[i + 1]?.first_page ?? lec.total_slides + 1) - 1) };
}

export function planExam({ lectures, trail, marks, weak, exam, today, now = Date.now() }: PlanInput): ExamPlan {
  const daysLeft = daysBetween(today, exam);
  const byId = new Map(lectures.map((l) => [l.id, l]));

  /* What is left to read, lecture by lecture, from where the student stopped. */
  const queue: { lec: PlanLecture; from: number; to: number }[] = [];
  for (const lec of lectures) {
    const read = Math.min(lec.total_slides, trail[lec.id]?.page ?? 0);
    if (read < lec.total_slides) queue.push({ lec, from: read + 1, to: lec.total_slides });
  }
  const unreadPages = queue.reduce((n, q) => n + q.to - q.from + 1, 0);
  if (daysLeft <= 0) return { daysLeft, unreadPages, pagesPerDay: 0, days: [] };

  /* Missed ideas first, then the most faded. */
  const review: TodayStep[] = [];
  for (const w of weak) {
    const lec = byId.get(w.lecture_id);
    if (!lec) continue;
    /* Without the lecture's ideas yet, the miss is still a miss: its own page. */
    const r = ideaRange(lec, w.page) ?? { name: w.idea, first: w.page, last: w.page };
    if (review.some((s) => s.lectureId === lec.id && s.page === r.first)) continue;
    review.push({ kind: 'revisit', title: r.name, why: `Missed last time · ${lec.title}, ${pagesOf(r.first, r.last)}`, lectureId: lec.id, page: r.first, minutes: reviewMinutes(r.last - r.first + 1) });
  }
  const faded: { step: TodayStep; t: number }[] = [];
  for (const lec of lectures) {
    const ideas = [...(lec.ideas ?? [])].sort((a, b) => a.first_page - b.first_page);
    proofs(lec.id, ideas, marks).forEach((p, i) => {
      if (p.weak || p.lastRight === null || !Number.isFinite(p.lastRight) || daysSince(p.lastRight, now) <= FADE_AFTER_DAYS) return;
      const r = ideaRange(lec, ideas[i].first_page)!;
      faded.push({ t: p.lastRight, step: { kind: 'refresh', title: r.name, why: `Fading · ${lec.title}, ${pagesOf(r.first, r.last)}`, lectureId: lec.id, page: r.first, minutes: reviewMinutes(r.last - r.first + 1) } });
    });
  }
  review.push(...faded.sort((a, b) => a.t - b.t).map((f) => f.step));
  const missed = review.filter((s) => s.kind === 'revisit');

  /* The far end is fixed: a full rehearsal, then a light last day. */
  const reserved = daysLeft >= 3 ? 2 : daysLeft === 2 ? 1 : 0;
  const readingDays = unreadPages === 0 ? 0 : Math.max(1, Math.min(daysLeft - reserved, Math.ceil(daysLeft * 0.7)));
  const pagesPerDay = readingDays ? Math.ceil(unreadPages / readingDays) : 0;
  const all = lectures.map((l) => l.id);

  /* Review days with nothing left to review rehearse the course in chunks, so every lecture is rehearsed before the full run. */
  const reviewDays = Math.max(0, daysLeft - reserved - readingDays);
  const chunk = Math.max(1, Math.ceil(lectures.length / Math.max(1, reviewDays)));
  const chunks: PlanLecture[][] = [];
  for (let k = 0; k < lectures.length; k += chunk) chunks.push(lectures.slice(k, k + chunk));

  const days: PlanDay[] = [];
  let readThisWeek = new Set<string>();
  for (let d = 0; d < daysLeft; d++) {
    const steps: TodayStep[] = [];
    let kind: DayKind = 'review';
    const eve = daysLeft >= 2 && d === daysLeft - 1;
    const full = daysLeft >= 3 && d === daysLeft - 2;

    if (eve) {
      kind = 'eve';
      steps.push(...missed.slice(0, 2));
      if (!steps.length) {
        steps.push({ kind: 'rehearse', title: 'A short last look', why: 'Five questions across the course — then rest', lectureId: all[0], page: 1, minutes: 10, lectureIds: all });
      }
    } else if (full) {
      kind = 'rehearse';
      steps.push({ kind: 'rehearse', title: 'Full rehearsal', why: `Every lecture, the way the exam will ask`, lectureId: all[0], page: 1, minutes: 25, lectureIds: all });
    } else {
      /* Read: this day's share of the pages, possibly across two lectures. */
      let budget = d < readingDays ? pagesPerDay : 0;
      while (budget > 0 && queue.length) {
        const q = queue[0];
        const take = Math.min(budget, q.to - q.from + 1);
        steps.push({
          kind: 'read',
          title: q.lec.title,
          why: take === q.to - q.from + 1 && q.to === q.lec.total_slides ? `Pages ${q.from}–${q.to} · to the end` : `Pages ${q.from}–${q.from + take - 1}`,
          lectureId: q.lec.id,
          page: q.from,
          minutes: take,
        });
        readThisWeek.add(q.lec.id);
        q.from += take;
        budget -= take;
        if (q.from > q.to) queue.shift();
      }
      if (steps.length) kind = 'read';
      /* Review rides along. */
      const n = kind === 'read' ? 1 : 2;
      steps.push(...review.splice(0, n));
      if (kind === 'review' && steps.length < 2 && chunks.length) {
        const part = chunks.shift()!;
        steps.push({
          kind: 'rehearse',
          title: `Rehearse ${listOf(part.map((l) => l.title))}`,
          why: 'Five questions from these lectures',
          lectureId: part[0].id,
          page: 1,
          minutes: 12,
          lectureIds: part.map((l) => l.id),
        });
      }
      /* A week of reading ends in a short rehearsal of what was read. */
      if (kind === 'read' && (d + 1) % 7 === 0 && readThisWeek.size) {
        const ids = [...readThisWeek];
        steps.push({ kind: 'rehearse', title: 'This week, rehearsed', why: `${ids.length === 1 ? byId.get(ids[0])!.title : `${ids.length} lectures`} · five questions`, lectureId: ids[0], page: 1, minutes: 12, lectureIds: ids });
        readThisWeek = new Set();
      }
    }
    days.push({ date: addDays(today, d), offset: d, kind, steps, minutes: steps.reduce((m, s) => m + s.minutes, 0) });
  }
  return { daysLeft, unreadPages, pagesPerDay, days };
}
