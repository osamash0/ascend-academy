import { proofs, FADE_AFTER_DAYS, daysSince, type Mark } from './light';
import { phrase, type Phrase, type Words } from './phrase';
import { readTo } from '../../data/trail';

/**
 * Today's session: three things, in the order they pay off.
 *
 *   1. Go on reading where you stopped (the trail).
 *   2. Revisit the idea you most recently got wrong.
 *   3. Refresh the idea whose light has faded the longest.
 *
 * Any of them can be missing — a first visit has only "start reading". Each
 * step says why it is there and roughly how long it takes, and opens the
 * reader at the page that does the work.
 *
 * Pure: no DOM, no React, no language — a step's words are phrases the
 * screen says (`./phrase`).
 */

export interface TodayStep {
  kind: 'read' | 'revisit' | 'refresh' | 'rehearse';
  /** A Lesson's or an idea's own name, or a phrase ("Full rehearsal"). */
  title: Words;
  why: Phrase;
  lectureId: string;
  page: number;
  minutes: number;
  /** A rehearsal step: the lectures it covers. */
  lectureIds?: string[];
}

interface Lecture {
  id: string;
  title: string;
  total_slides: number;
  ideas: { name: string; first_page: number }[] | null;
}

interface Input {
  lectures: Lecture[];
  marks: Mark[];
  weak: { lecture_id: string; idea: string; page: number }[];
  resume: { lectureId: string; page: number; pages: number; furthest?: number } | null;
  now?: number;
}

/** ~1 minute a slide when reading on, ~40 s when going back over it. */
const readMinutes = (pages: number) => Math.max(2, Math.round(pages));
const reviewMinutes = (pages: number) => Math.max(2, Math.min(10, Math.round(pages * 0.7)));

/** The pages an idea spans in its lecture. */
function span(lec: Lecture, i: number): { first: number; last: number } {
  const ideas = [...(lec.ideas ?? [])].sort((a, b) => a.first_page - b.first_page);
  const first = ideas[i]?.first_page ?? 1;
  const last = (ideas[i + 1]?.first_page ?? lec.total_slides + 1) - 1;
  return { first, last: Math.max(first, last) };
}

export function planToday({ lectures, marks, weak, resume, now = Date.now() }: Input): TodayStep[] {
  const steps: TodayStep[] = [];
  const byId = new Map(lectures.map((l) => [l.id, l]));

  /* 1. Reading on. */
  const resumeLec = resume ? byId.get(resume.lectureId) : undefined;
  /*
   * Resume where you are, but count what is left from the furthest page you
   * reached: looking back at page 2 of a deck read to page 6 left "25 pages
   * left" when 21 were (LS-055, seen live 2026-10-30).
   */
  const leftToRead = resume ? resume.pages - readTo(resume) : 0;
  if (resume && resumeLec && leftToRead > 0) {
    const left = leftToRead;
    steps.push({
      kind: 'read',
      title: resumeLec.title,
      why: phrase('plan.today.resume', { page: resume.page, count: left }),
      lectureId: resumeLec.id,
      page: resume.page,
      minutes: Math.min(25, readMinutes(left)),
    });
  } else {
    /* Nothing in progress: the first lecture nobody has opened here. */
    const fresh = lectures[0];
    if (fresh && !resume) {
      steps.push({
        kind: 'read',
        title: fresh.title,
        why: phrase('plan.today.fresh', { count: fresh.total_slides }),
        lectureId: fresh.id,
        page: 1,
        minutes: Math.min(25, readMinutes(fresh.total_slides)),
      });
    }
  }

  /* 2. The most recent miss. */
  const miss = weak.find((w) => byId.has(w.lecture_id));
  if (miss) {
    const lec = byId.get(miss.lecture_id)!;
    const ideas = [...(lec.ideas ?? [])].sort((a, b) => a.first_page - b.first_page);
    const i = ideas.reduce((at, x, k) => (x.first_page <= miss.page ? k : at), -1);
    const range = i >= 0 ? span(lec, i) : { first: miss.page, last: miss.page };
    steps.push({
      kind: 'revisit',
      title: i >= 0 ? ideas[i].name : miss.idea,
      why: phrase('plan.today.missed', { lesson: lec.title, first: range.first, last: range.last }),
      lectureId: lec.id,
      page: range.first,
      minutes: reviewMinutes(range.last - range.first + 1),
    });
  }

  /* 3. The longest-faded light. */
  let oldest: { lec: Lecture; i: number; t: number } | null = null;
  for (const lec of lectures) {
    const ideas = [...(lec.ideas ?? [])].sort((a, b) => a.first_page - b.first_page);
    if (!ideas.length) continue;
    proofs(lec.id, ideas, marks).forEach((p, i) => {
      if (p.weak || p.lastRight === null || !Number.isFinite(p.lastRight)) return;
      if (daysSince(p.lastRight, now) <= FADE_AFTER_DAYS) return;
      if (!oldest || p.lastRight < oldest.t) oldest = { lec, i, t: p.lastRight };
    });
  }
  if (oldest) {
    const { lec, i, t } = oldest as { lec: Lecture; i: number; t: number };
    const ideas = [...(lec.ideas ?? [])].sort((a, b) => a.first_page - b.first_page);
    const range = span(lec, i);
    steps.push({
      kind: 'refresh',
      title: ideas[i].name,
      why: phrase('plan.today.fading', { count: daysSince(t, now), lesson: lec.title }),
      lectureId: lec.id,
      page: range.first,
      minutes: reviewMinutes(range.last - range.first + 1),
    });
  }
  return steps;
}

export interface FadingIdea {
  lectureId: string;
  lectureTitle: string;
  name: string;
  page: number;
  days: number;
}

/** Ideas proven right, but longer ago than the light lasts — the most faded first. */
export function fadingIdeas(
  course: { lectures: { id: string; title: string; ideas: { name: string; first_page: number }[] | null }[] } | null,
  history: { marks?: Mark[] } | null,
  now = Date.now(),
): FadingIdea[] {
  if (!course || !history?.marks?.length) return [];
  const out: FadingIdea[] = [];
  for (const lec of course.lectures) {
    const ideas = [...(lec.ideas ?? [])].sort((a, b) => a.first_page - b.first_page);
    proofs(lec.id, ideas, history.marks).forEach((p, i) => {
      if (p.weak || p.lastRight === null || !Number.isFinite(p.lastRight)) return;
      const days = daysSince(p.lastRight, now);
      if (days > FADE_AFTER_DAYS) out.push({ lectureId: lec.id, lectureTitle: lec.title, name: ideas[i].name, page: ideas[i].first_page, days });
    });
  }
  return out.sort((a, b) => b.days - a.days).slice(0, 8);
}
