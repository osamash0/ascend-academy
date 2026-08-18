/**
 * Shared time-of-day logic for dashboard greetings (R54).
 *
 * Both ProfessorDashboard and StudentDashboard used to duplicate
 * `if (hour < 12) return morning; if (hour < 17) return afternoon; return
 * evening;` verbatim, with no night band at all — "Good morning" was shown
 * from 00:00 to 11:59, so a professor working at 1am was greeted "Good
 * morning". Extracted to one helper so the boundaries only live in one place.
 *
 * Each dashboard still owns its own i18n lookup (they use different
 * namespaces/keys — `common:greetings.*` vs `dashboard:greeting.*`), this
 * only centralizes the hour → period mapping.
 */
export type TimeOfDayPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

export function getTimeOfDayPeriod(date: Date = new Date()): TimeOfDayPeriod {
  const hour = date.getHours();
  if (hour < 5 || hour >= 22) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
