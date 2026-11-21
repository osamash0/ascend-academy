/**
 * Meeting schedules for courses, keyed by their canonical (German) course
 * title — the same key used by `common:curriculum` for translation.
 *
 * Every label that has a German/English form (event type, weekday, rhythm) is
 * an i18n key resolved in the UI via `common:courseSchedule.*`; only rooms,
 * addresses, dates and times would be literals.
 *
 * Empty on purpose. A real university's timetable and the people who teach it
 * never go in the repo or the bundle, so no course has a schedule and the
 * details sheet leaves the section out. An entry has no field for a person.
 */

export type ScheduleEventType = 'lecture' | 'exercise' | 'sqlWorkshop' | 'exam';
export type ScheduleDay =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';
export type ScheduleRhythm = 'weekly' | 'biweekly' | 'once';

export interface ScheduleEntry {
  /** Event category — resolved via `common:courseSchedule.events.*`. */
  type: ScheduleEventType;
  /** Optional 1-based number for repeated event types (e.g. "Exercise 2"). */
  seq?: number;
  /** Room + building + address (proper noun, shown verbatim in both locales). */
  location: string;
  /** Start date, formatted `dd.MM.yyyy`. */
  start: string;
  /** End date, formatted `dd.MM.yyyy` (equals `start` for one-time events). */
  end: string;
  /** Weekday — resolved via `common:courseSchedule.days.*`. */
  day: ScheduleDay;
  /** Recurrence — resolved via `common:courseSchedule.rhythm.*`. */
  rhythm: ScheduleRhythm;
  /** Time range, e.g. `09:00 - 12:00`. */
  time: string;
}

/** Map of canonical German course title → its scheduled events. */
export const COURSE_SCHEDULES: Record<string, ScheduleEntry[]> = {};

/** Look up a course's schedule by its canonical German title. */
export function getCourseSchedule(title?: string | null): ScheduleEntry[] {
  if (!title) return [];
  return COURSE_SCHEDULES[title] ?? [];
}
