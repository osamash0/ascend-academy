import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';

describe('what members are told', () => {
  it('the join screen says what the people who run a Space can see, in both languages', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('v4Spaces:join.privacy')).toBe('The people who run this Space can see how its pages are read.');
    await i18n.changeLanguage('de');
    expect(i18n.t('v4Spaces:join.privacy')).toBe('Die Leute, die diesen Space pflegen, können sehen, wie seine Seiten gelesen werden.');
    await i18n.changeLanguage('en');
  });
});
