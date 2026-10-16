import { afterEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { formatDate, formatList, formatMegabytes, formatRelativeDays, formatTimestamp } from '../format';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('formatting in the app’s language', () => {
  it('follows the app, not the browser', async () => {
    await i18n.changeLanguage('de');
    expect(formatList(['A', 'B', 'C'])).toBe('A, B und C');
    expect(formatRelativeDays(1)).toBe('morgen');
    expect(formatRelativeDays(20)).toBe('in 20 Tagen');
    expect(formatDate('2026-10-31', 'long')).toBe('Samstag, 31. Oktober');
    await i18n.changeLanguage('en');
    expect(formatList(['A', 'B', 'C'])).toBe('A, B, and C');
    expect(formatRelativeDays(1)).toBe('tomorrow');
  });

  it('never moves a calendar day across a time zone', () => {
    expect(formatDate('2026-01-01')).toContain('1');
    expect(formatDate('2026-01-01')).toMatch(/Jan/);
  });

  it('sizes and moments follow the app’s language too', async () => {
    await i18n.changeLanguage('de');
    expect(formatMegabytes(2_400_000)).toBe('2,4');
    expect(formatTimestamp('2026-02-10T12:00:00Z', true)).toBe('10. Feb. 2026');
    await i18n.changeLanguage('en');
    expect(formatMegabytes(2_400_000)).toBe('2.4');
    expect(formatTimestamp('2026-02-10T12:00:00Z')).toBe('Feb 10');
  });
});
