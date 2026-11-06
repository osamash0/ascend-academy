import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';

describe('what members are told', () => {
  it('the join screen names the floor, in both languages', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('v4Spaces:join.privacy')).toBe(
      'The people who run this Space see how its pages land, as patterns across at least five people, never by name.',
    );
    await i18n.changeLanguage('de');
    expect(i18n.t('v4Spaces:join.privacy')).toBe(
      'Die Leute, die diesen Space pflegen, sehen, wie seine Seiten ankommen: als Muster über mindestens fünf Personen, nie mit Namen.',
    );
    await i18n.changeLanguage('en');
  });

  it('the privacy page names the floor', () => {
    const items = (lng: string) => i18n.getFixedT(lng, 'legal')('privacy.section3Items', { returnObjects: true }) as string[];
    expect(items('en')[1]).toMatch(/only as patterns across at least five people, never by name;/);
    expect(items('de')[1]).toMatch(/nur als Muster über mindestens fünf Personen, nie mit Namen;/);
  });
});
