import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';

describe('what members are told', () => {
  it('the join screen says what the people who run a Space see, in both languages', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('v4Spaces:join.privacy')).toBe('The people who run this Space see how its pages land for the group, never who you are.');
    await i18n.changeLanguage('de');
    expect(i18n.t('v4Spaces:join.privacy')).toBe('Die Leute, die diesen Space pflegen, sehen, wie seine Seiten bei der Gruppe ankommen, nie, wer du bist.');
    await i18n.changeLanguage('en');
  });

  it('the privacy page names the floor', async () => {
    const items = (lng: string) => i18n.getFixedT(lng, 'legal')('privacy.section3Items', { returnObjects: true }) as string[];
    expect(items('en').join(' ')).toMatch(/at least five people, never by name/);
    expect(items('de').join(' ')).toMatch(/mindestens fünf Personen, nie mit Namen/);
  });
});
