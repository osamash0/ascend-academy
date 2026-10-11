/**
 * Which of a lecture's ideas your rehearsals have lit — and how long ago.
 *
 * Doc 2's rule, with real data under it: darkness is the content — an idea
 * nobody has tested you on stays unlit. A rehearsal or checkpoint answer is
 * filed under the idea whose pages contain the page it asked about (the
 * question's own wording of the idea is the model's, so it is not trusted
 * to match). Any latest-wrong answer inside an idea marks it to revisit;
 * otherwise a right one lights it.
 *
 * And light fades, the way memory does: an idea last proven more than a week
 * ago is `fading` — still known, due for a look. Spaced repetition, drawn.
 *
 * Pure: no DOM, no React.
 */

export type Light = 'lit' | 'fading' | 'weak' | 'dark';

export interface Mark {
  lecture_id: string;
  page: number;
  correct: boolean;
  /** When it was answered (ISO). Without it a right answer never fades. */
  at?: string;
}

/** After this long without being proven again, a lit idea starts to fade. */
export const FADE_AFTER_DAYS = 7;
const DAY = 86_400_000;

/** The index of the idea a page belongs to: the last one starting at or before it. */
export function ideaAt(ideas: { first_page: number }[], page: number): number {
  let at = -1;
  ideas.forEach((idea, i) => {
    if (idea.first_page <= page && (at < 0 || idea.first_page >= ideas[at].first_page)) at = i;
  });
  return at;
}

/** Per idea: its light, and when it was last proven right (ms), if ever. */
export function proofs(lectureId: string, ideas: { first_page: number }[], marks: Mark[]): { weak: boolean; lastRight: number | null }[] {
  const out = ideas.map(() => ({ weak: false, lastRight: null as number | null }));
  for (const m of marks) {
    if (m.lecture_id !== lectureId) continue;
    const i = ideaAt(ideas, m.page);
    if (i < 0) continue;
    if (!m.correct) out[i].weak = true;
    else {
      const t = m.at ? Date.parse(m.at) : Number.POSITIVE_INFINITY;
      out[i].lastRight = Math.max(out[i].lastRight ?? -Infinity, Number.isNaN(t) ? Number.POSITIVE_INFINITY : t);
    }
  }
  return out;
}

export function lightIdeas(lectureId: string, ideas: { first_page: number }[], marks: Mark[], now = Date.now()): Light[] {
  return proofs(lectureId, ideas, marks).map((p) => {
    if (p.weak) return 'weak';
    if (p.lastRight === null) return 'dark';
    return now - p.lastRight > FADE_AFTER_DAYS * DAY ? 'fading' : 'lit';
  });
}

/** Whole days since an ISO time or ms timestamp. */
export const daysSince = (t: number, now = Date.now()) => Math.max(0, Math.floor((now - t) / DAY));
