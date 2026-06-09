/**
 * Static meeting schedules for courses, keyed by their canonical (German)
 * course title — the same key used by `common:curriculum` for translation.
 *
 * Only the proper nouns (rooms, addresses, dates, instructor names) live here
 * as literals; every label that has a German/English form (event type, weekday,
 * rhythm) is stored as an i18n key and resolved in the UI via
 * `common:courseSchedule.*`, so a single dataset renders in the active locale.
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
  /** Instructor name(s), shown verbatim. Omitted for exams/workshops. */
  instructor?: string;
}

/** Map of canonical German course title → its scheduled events. */
export const COURSE_SCHEDULES: Record<string, ScheduleEntry[]> = {
  Datenbanksysteme: [
    {
      type: 'lecture',
      location:
        'Vortragsraum B008 (00/2080), Deutschhausstraße 9, Universitätsbibliothek (F | 01)',
      start: '17.04.2026',
      end: '10.07.2026',
      day: 'friday',
      rhythm: 'weekly',
      time: '09:00 - 12:00',
      instructor: 'Prof. Dr. Thorsten Papenbrock',
    },
    {
      type: 'exercise',
      seq: 1,
      location:
        '03C45 (SR XIII C3), Hans-Meerwein-Straße 6, Institutsgebäude (H | 04)',
      start: '12.05.2026',
      end: '14.07.2026',
      day: 'tuesday',
      rhythm: 'biweekly',
      time: '14:00 - 16:00',
      instructor: 'Ilnaz Tayebi / Aly Hassan Abdulaziz Moustafa',
    },
    {
      type: 'exercise',
      seq: 2,
      location:
        '03A16 (HS II A3), Hans-Meerwein-Straße 6, Institutsgebäude (H | 04)',
      start: '12.05.2026',
      end: '14.07.2026',
      day: 'tuesday',
      rhythm: 'biweekly',
      time: '16:00 - 18:00',
      instructor: 'Kian Kazemzadeh Marand',
    },
    {
      type: 'exercise',
      seq: 3,
      location:
        '03A20 (HS I A3), Hans-Meerwein-Straße 6, Institutsgebäude (H | 04)',
      start: '13.05.2026',
      end: '15.07.2026',
      day: 'wednesday',
      rhythm: 'biweekly',
      time: '10:00 - 12:00',
      instructor: 'Tibebu Tewolde',
    },
    {
      type: 'exercise',
      seq: 4,
      location:
        '03C52 (SR XII C3), Hans-Meerwein-Straße 6, Institutsgebäude (H | 04)',
      start: '13.05.2026',
      end: '15.07.2026',
      day: 'wednesday',
      rhythm: 'biweekly',
      time: '14:00 - 16:00',
      instructor: 'Johannes Wichert',
    },
    {
      type: 'sqlWorkshop',
      location:
        '03D25 (03D25 E-Klausuren), Hans-Meerwein-Straße 6, Institutsgebäude (H | 04)',
      start: '26.06.2026',
      end: '26.06.2026',
      day: 'friday',
      rhythm: 'once',
      time: '09:00 - 14:00',
    },
    {
      type: 'exam',
      seq: 1,
      location: '+5/0030 (HS A), Hans-Meerwein-Straße 8, Hörsaalgebäude (H | 05)',
      start: '17.07.2026',
      end: '17.07.2026',
      day: 'friday',
      rhythm: 'once',
      time: '13:00 - 16:00',
    },
    {
      type: 'exam',
      seq: 2,
      location: '+5/0030 (HS A), Hans-Meerwein-Straße 8, Hörsaalgebäude (H | 05)',
      start: '16.09.2026',
      end: '16.09.2026',
      day: 'wednesday',
      rhythm: 'once',
      time: '09:00 - 12:00',
    },
  ],
};

/** Look up a course's schedule by its canonical German title. */
export function getCourseSchedule(title?: string | null): ScheduleEntry[] {
  if (!title) return [];
  return COURSE_SCHEDULES[title] ?? [];
}
