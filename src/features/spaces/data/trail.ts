/**
 * Where you stopped reading, per lecture — kept in this browser only.
 *
 * A convenience, not a record: it never leaves the device, it can vanish (a
 * private window, cleared site data) and everything that reads it must look
 * right without it. Every access is guarded for exactly that reason.
 */

export interface TrailMark {
  /** The page last in view. */
  page: number;
  /** The deck's length when it was read — so progress needs no extra fetch. */
  pages: number;
  /** The course (space) it belongs to. */
  course: string;
  at: number;
}

const KEY = 'ls.reader.trail.v1';
const MAX = 60;

function readAll(): Record<string, TrailMark> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, TrailMark>) : {};
  } catch {
    return {};
  }
}

export function readTrail(): Record<string, TrailMark> {
  return readAll();
}

export function markTrail(lectureId: string, mark: Omit<TrailMark, 'at'>): void {
  if (mark.page < 1 || mark.pages < 1) return;
  try {
    const all = readAll();
    all[lectureId] = { ...mark, page: Math.min(mark.page, mark.pages), at: Date.now() };
    /* Keep the newest few dozen; a trail is not an archive. */
    const kept = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* Storage refused — the reader works the same without a trail. */
  }
}

/** The lecture of this course read most recently, if any. */
export function latestInCourse(courseId: string): ({ lectureId: string } & TrailMark) | null {
  const hit = Object.entries(readAll())
    .filter(([, m]) => m.course === courseId)
    .sort((a, b) => b[1].at - a[1].at)[0];
  return hit ? { lectureId: hit[0], ...hit[1] } : null;
}
