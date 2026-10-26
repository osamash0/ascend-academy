import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en/onboarding.json';
import de from '@/i18n/locales/de/onboarding.json';
import { REEL_MS, pickAlias, reel } from '../aliases';
import { NAME_MAX } from '../useFirstRun';

const lists = { en: en.firstRun.name.aliases, de: de.firstRun.name.aliases };

describe('first-run aliases', () => {
  it('both languages offer the same number of names, none repeated, all short enough to save', () => {
    expect(lists.en.length).toBe(lists.de.length);
    expect(lists.en.length).toBeGreaterThanOrEqual(20);
    for (const list of Object.values(lists)) {
      expect(new Set(list).size).toBe(list.length);
      for (const n of list) expect(n.length).toBeLessThanOrEqual(NAME_MAX);
    }
  });

  it('never picks the name already showing', () => {
    for (let i = 0; i < 200; i++) expect(pickAlias(['A', 'B'], 'A')).toBe('B');
  });

  it('copes with a list of one', () => {
    expect(pickAlias(['A'], 'A')).toBe('A');
  });

  it('the reel has one frame per beat, no frame repeats the last, and lands on a listed name', () => {
    const frames = reel(lists.en, '');
    expect(frames).toHaveLength(REEL_MS.length);
    frames.forEach((f, i) => {
      expect(lists.en).toContain(f);
      if (i > 0) expect(f).not.toBe(frames[i - 1]);
    });
  });

  it('a second roll lands somewhere new', () => {
    const first = reel(lists.en, '').at(-1)!;
    expect(reel(lists.en, first)[0]).not.toBe(first);
  });
});
