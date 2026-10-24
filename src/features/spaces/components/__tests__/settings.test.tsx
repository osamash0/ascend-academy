import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Settings is the screen where a product's promises are either kept or
 * exposed. The August audit found a privacy page asserting GDPR compliance the
 * product did not have; these guards exist so this one cannot repeat it.
 */

const SRC = join(process.cwd(), 'src/features/spaces');
const read = (p: string) =>
  readFileSync(join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const settings = read('screens/SettingsScreen.tsx');
/* The words live in the locale file now; the source names their keys. */
const en = JSON.parse(readFileSync(join(process.cwd(), 'src/i18n/locales/en/v4Settings.json'), 'utf8')).sections;

describe('Settings', () => {
  it('returns to Profile, the destination that owns "you"', () => {
    expect(settings).toContain('backTo="/v4/profile"');
  });

  it('offers no reduced-motion switch', () => {
    /*
     * Scene already routes every screen through reducedMotion="user". A second
     * control could disagree with the operating system, and whichever one lost
     * would look like a broken setting.
     *
     * The assertion targets the *control*, not the word. The first version
     * matched any mention of "reduced motion" and so fired on the sentence at
     * the bottom of the screen explaining why there is no switch — the same
     * trap `modes.test.tsx` and the vocabulary checker each fell into once. A
     * rule that fires on the prose explaining it is a rule people switch off.
     */
    expect(settings).not.toMatch(/label="[^"]*motion/i);
    expect(settings).not.toMatch(/set[A-Z]\w*Motion|useState.*motion/i);
  });

  it('never wires a destructive action against mock data', () => {
    expect(en.data.delete.label).toBe('Delete your account');
    const del = settings.slice(settings.indexOf("t('sections.data.delete.label')"));
    expect(del.length).toBeLessThan(settings.length);
    expect(del).toContain('disabled');
    expect(del).not.toContain('onClick');
  });

  it('makes no compliance claim it cannot back', () => {
    // Naming a regulation is a promise. This build cannot keep one.
    expect(settings).not.toMatch(/GDPR|CCPA|compliant|fully secure|bank.?grade/i);
  });

  it('describes what each switch costs, not just what it is', () => {
    // Every Toggle takes a description; none may be empty.
    const keys = [...settings.matchAll(/description=\{t\('sections\.([\w.]+)'\)\}/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(5);
    for (const k of keys) {
      const d = k.split('.').reduce((o: Record<string, unknown>, part) => o[part] as Record<string, unknown>, en) as unknown as string;
      expect(typeof d).toBe('string');
      expect(d.length).toBeGreaterThan(30);
    }
  });
});
