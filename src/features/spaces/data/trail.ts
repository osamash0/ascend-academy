/**
 * Where you stopped reading, per lecture — kept in this browser only.
 *
 * A convenience, not a record: it never leaves the device, it can vanish (a
 * private window, cleared site data) and everything that reads it must look
 * right without it. Every access is guarded for exactly that reason.
 */

export interface TrailMark {
  /** The page last in view — where "go on reading" resumes. */
  page: number;
  /**
   * The furthest page reached — what progress and the exam plan measure.
   * Looking back (or a deep link to an earlier page) moves `page`, never this.
   * Missing on marks written before 2026-10-30; `readTo` falls back to `page`.
   */
  furthest?: number;
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

/** How far a Lesson has been read: the furthest page reached, 0 when never opened. */
export function readTo(mark: Pick<TrailMark, 'page' | 'pages' | 'furthest'> | undefined): number {
  if (!mark) return 0;
  return Math.min(mark.pages, Math.max(mark.page, mark.furthest ?? 0));
}

export function markTrail(lectureId: string, mark: Omit<TrailMark, 'at' | 'furthest'>): void {
  if (mark.page < 1 || mark.pages < 1) return;
  try {
    const all = readAll();
    const page = Math.min(mark.page, mark.pages);
    /* Looking back keeps the high-water mark: progress never goes down by reading. */
    const furthest = Math.min(mark.pages, Math.max(page, readTo(all[lectureId])));
    all[lectureId] = { ...mark, page, furthest, at: Date.now() };
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
