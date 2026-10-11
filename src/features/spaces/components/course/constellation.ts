import { lightIdeas, type Light, type Mark } from './light';

/**
 * The course as a constellation: every idea a star, every prerequisite a line.
 *
 * Stars stand in columns, one per lecture in teaching order, each column's
 * ideas top to bottom in page order. A star's size is how much of the deck the
 * idea takes; its light is what checkpoints and rehearsals say about it.
 *
 * The question it answers is "why am I stuck?": everything an idea builds on,
 * all the way back (`upstream`), and of those, the one to fix first — the
 * earliest foundation that is still red or dark (`startHere`).
 *
 * Pure: no DOM, no React.
 */

export interface Star {
  key: string;
  lectureId: string;
  lectureTitle: string;
  lectureIndex: number;
  name: string;
  firstPage: number;
  pages: number;
  light: Light;
  /** Position in teaching order across the whole course. */
  rank: number;
  x: number;
  y: number;
  r: number;
}

export interface LinkEnd {
  lecture_id: string;
  first_page: number;
}

export interface CourseLink {
  from: LinkEnd;
  to: LinkEnd;
  why: string;
}

export const starKey = (lectureId: string, firstPage: number) => `${lectureId}:${firstPage}`;

interface Lecture {
  id: string;
  title: string;
  total_slides: number;
  ideas: { name: string; first_page: number }[] | null;
}

/** Stars laid out in a `width` × `height` box. */
export function layoutStars(lectures: Lecture[], marks: Mark[], width: number, height: number): Star[] {
  const cols = lectures.length || 1;
  const colW = width / cols;
  const rows = Math.max(1, ...lectures.map((l) => l.ideas?.length ?? 0));
  const rowH = height / rows;
  const stars: Star[] = [];
  lectures.forEach((lec, li) => {
    const ideas = [...(lec.ideas ?? [])].sort((a, b) => a.first_page - b.first_page);
    const lights = lightIdeas(lec.id, ideas, marks);
    /* A column's ideas spread over the full height, so short lectures do not huddle at the top. */
    const step = ideas.length > 1 ? (height - rowH) / (ideas.length - 1) : 0;
    ideas.forEach((idea, ii) => {
      const last = (ideas[ii + 1]?.first_page ?? lec.total_slides + 1) - 1;
      const pages = Math.max(1, last - idea.first_page + 1);
      /* A small, steady sway off the column line, so it reads as a sky and not a table. */
      const sway = Math.sin((li + 1) * 1.7 + ii * 2.3) * colW * 0.18;
      stars.push({
        key: starKey(lec.id, idea.first_page),
        lectureId: lec.id,
        lectureTitle: lec.title,
        lectureIndex: li,
        name: idea.name,
        firstPage: idea.first_page,
        pages,
        light: lights[ii],
        rank: stars.length,
        x: colW * (li + 0.5) + sway,
        y: ideas.length > 1 ? rowH / 2 + ii * step : height / 2,
        r: Math.min(9, 3 + Math.sqrt(pages) * 1.1),
      });
    });
  });
  return stars;
}

/** Everything `key` builds on, nearest first, without repeats. */
export function upstream(key: string, links: CourseLink[]): string[] {
  const needs = new Map<string, string[]>();
  for (const l of links) {
    const to = starKey(l.to.lecture_id, l.to.first_page);
    needs.set(to, [...(needs.get(to) ?? []), starKey(l.from.lecture_id, l.from.first_page)]);
  }
  const seen = new Set<string>();
  const order: string[] = [];
  let frontier = needs.get(key) ?? [];
  while (frontier.length) {
    const next: string[] = [];
    for (const k of frontier) {
      if (seen.has(k) || k === key) continue;
      seen.add(k);
      order.push(k);
      next.push(...(needs.get(k) ?? []));
    }
    frontier = next;
  }
  return order;
}

/** What builds directly on `key`. */
export function downstream(key: string, links: CourseLink[]): string[] {
  return links
    .filter((l) => starKey(l.from.lecture_id, l.from.first_page) === key)
    .map((l) => starKey(l.to.lecture_id, l.to.first_page));
}

/** Of what `key` builds on, the earliest foundation still red (first) or dark — where to start. */
export function startHere(key: string, links: CourseLink[], stars: Star[]): Star | null {
  const byKey = new Map(stars.map((s) => [s.key, s]));
  const up = upstream(key, links).map((k) => byKey.get(k)).filter((s): s is Star => Boolean(s));
  const earliest = (light: Light) => up.filter((s) => s.light === light).sort((a, b) => a.rank - b.rank)[0] ?? null;
  return earliest('weak') ?? earliest('dark');
}
