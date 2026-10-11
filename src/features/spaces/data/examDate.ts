/**
 * The exam date a student set for a course — kept in this browser only.
 *
 * A convenience like the reading trail: it never leaves the device, it can
 * vanish, and the course page reads it with a fallback. Stored as a plain
 * calendar date (YYYY-MM-DD), never a time, so time zones cannot move it.
 */

const KEY = 'ls.reader.exam.v1';

function readAll(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function examDateFor(courseId: string): string | null {
  const v = readAll()[courseId];
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export function setExamDate(courseId: string, date: string | null): void {
  try {
    const all = readAll();
    if (date) all[courseId] = date;
    else delete all[courseId];
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* Storage refused — the plan holds for this visit only. */
  }
}
