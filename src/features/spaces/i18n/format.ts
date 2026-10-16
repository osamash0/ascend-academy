import i18n from '@/i18n';

/**
 * Numbers, dates and lists in the app's language — never the browser's.
 *
 * `toLocaleDateString(undefined, …)` follows the browser, so a student who
 * chose Deutsch in Learnstation on an English-language laptop read German
 * pages under English dates. Everything here reads `i18n.language`.
 *
 * Calendar dates (`YYYY-MM-DD`) are formatted at noon UTC in UTC, so no time
 * zone can move them to the day before.
 */

const lang = () => (i18n.language || 'en').split('-')[0];

export function formatDate(day: string, style: 'long' | 'short' = 'short'): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(lang(), {
    weekday: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    month: style === 'long' ? 'long' : 'short',
    timeZone: 'UTC',
  });
}

/** "in 20 days", "tomorrow", "today", "yesterday" — "in 20 Tagen", "morgen", … */
export function formatRelativeDays(days: number): string {
  return new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' }).format(days, 'day');
}

/** "A, B and C" — "A, B und C". */
export function formatList(items: string[]): string {
  /* Intl.ListFormat is in every current browser; this TS target predates its types. */
  const ListFormat = (Intl as unknown as {
    ListFormat?: new (l: string, o: { style: string; type: string }) => { format: (x: string[]) => string };
  }).ListFormat;
  if (ListFormat) return new ListFormat(lang(), { style: 'long', type: 'conjunction' }).format(items);
  const and = lang() === 'de' ? 'und' : 'and';
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(lang()).format(n);
}
