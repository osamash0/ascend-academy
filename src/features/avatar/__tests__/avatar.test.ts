import { describe, expect, it } from 'vitest';
import { CATALOG, DEFAULT_LOADOUT } from '../catalog';
import { loadoutFromLegacy, randomLoadout, sanitizeLoadout } from '../loadout';
import { deriveMood } from '../mood';
import { EMPTY_PROGRESS, isUnlocked, newlyUnlocked, nextUnlocks, unlockStatus } from '../unlocks';
import { SLOTS, type AvatarProgress } from '../types';

const p = (over: Partial<AvatarProgress> = {}): AvatarProgress => ({ ...EMPTY_PROGRESS, ...over });

describe('catalog', () => {
  it('has unique ids', () => {
    expect(new Set(CATALOG.map((i) => i.id)).size).toBe(CATALOG.length);
  });

  it('gives every slot at least one free item, so day-one students can personalise', () => {
    for (const slot of SLOTS) {
      expect(CATALOG.some((i) => i.slot === slot && i.unlock.kind === 'free')).toBe(true);
    }
  });

  it('defaults are all free', () => {
    for (const slot of SLOTS) {
      const item = CATALOG.find((i) => i.id === DEFAULT_LOADOUT[slot])!;
      expect(item.slot).toBe(slot);
      expect(item.unlock.kind).toBe('free');
    }
  });
});

describe('home looks', () => {
  const looks = CATALOG.filter((i) => i.slot === 'outfit' && i.id !== 'outfit-none');

  it('ships the agreed set', () => {
    expect(looks.map((i) => i.id).sort()).toEqual(
      ['dirndl', 'gulf', 'india', 'japan', 'lederhosen', 'levant', 'scotland', 'texas', 'turkiye', 'westafrica'].map((l) => `outfit-${l}`),
    );
  });

  it('all unlock together — no culture is ranked above another', () => {
    const rules = new Set(looks.map((i) => JSON.stringify(i.unlock)));
    expect(rules.size).toBe(1);
    expect(new Set(looks.map((i) => i.rarity)).size).toBe(1);
  });

  it('the space suit stays the free default', () => {
    expect(DEFAULT_LOADOUT.outfit).toBe('outfit-none');
    expect(isUnlocked(CATALOG.find((i) => i.id === 'outfit-none')!, p())).toBe(true);
    expect(isUnlocked(looks[0], p())).toBe(false);
    expect(isUnlocked(looks[0], p({ badges: new Set(['First Steps']) }))).toBe(true);
  });
});

describe('unlock rules', () => {
  it('rank unlocks follow lib/rank thresholds', () => {
    const halo = CATALOG.find((i) => i.id === 'gear-halo')!; // Legend = 13000 XP
    expect(isUnlocked(halo, p({ xp: 12999 }))).toBe(false);
    expect(isUnlocked(halo, p({ xp: 13000 }))).toBe(true);
    expect(unlockStatus(halo.unlock, p({ xp: 6500 })).pct).toBeCloseTo(0.5);
  });

  it('streak unlocks use the best streak — a lapse never takes gear away', () => {
    const flame = CATALOG.find((i) => i.id === 'gear-flame')!;
    expect(isUnlocked(flame, p({ streak: 0, bestStreak: 9 }))).toBe(true);
    expect(isUnlocked(flame, p({ streak: 3, bestStreak: 3 }))).toBe(false);
  });

  it('badge unlocks check the earned badge key', () => {
    const byte = CATALOG.find((i) => i.id === 'companion-byte')!;
    expect(isUnlocked(byte, p())).toBe(false);
    expect(isUnlocked(byte, p({ badges: new Set(['First Quiz Completed']) }))).toBe(true);
  });

  it('newlyUnlocked reports exactly what crossed the line', () => {
    const fresh = newlyUnlocked(p({ xp: 400 }), p({ xp: 600 })).map((i) => i.id);
    expect(fresh).toEqual(expect.arrayContaining(['suit-midnight', 'aura-stardust']));
    expect(fresh).not.toContain('gear-halo');
  });

  it('nextUnlocks leads with measurable progress, not opaque badges', () => {
    const [first] = nextUnlocks(p({ xp: 1400, level: 15 }), 1);
    expect(first.item.unlock.kind).not.toBe('badge');
    expect(first.status.unlocked).toBe(false);
  });
});

describe('loadout', () => {
  it('drops unknown ids, wrong-slot ids and junk', () => {
    const lo = sanitizeLoadout({ suit: 'suit-nope', gear: 'suit-mint', visor: 42, patch: 'patch-moon' });
    expect(lo.suit).toBe(DEFAULT_LOADOUT.suit);
    expect(lo.gear).toBe(DEFAULT_LOADOUT.gear);
    expect(lo.visor).toBe(DEFAULT_LOADOUT.visor);
    expect(lo.patch).toBe('patch-moon');
    expect(sanitizeLoadout(null)).toEqual(DEFAULT_LOADOUT);
  });

  it('drops items the student has not earned when progress is known', () => {
    expect(sanitizeLoadout({ gear: 'gear-halo' }, p()).gear).toBe(DEFAULT_LOADOUT.gear);
    expect(sanitizeLoadout({ gear: 'gear-halo' }, p({ xp: 20000 })).gear).toBe('gear-halo');
  });

  it('maps the legacy onboarding hex colours onto catalog items', () => {
    expect(loadoutFromLegacy('#E8E4F0', '#6b5b95')).toEqual({ suit: 'suit-lavender', visor: 'visor-violet' });
    expect(loadoutFromLegacy('#123456', null)).toEqual({});
  });

  it('randomLoadout only ever picks unlocked items', () => {
    const progress = p({ xp: 600 });
    for (let n = 0; n < 20; n++) {
      const lo = randomLoadout(progress);
      for (const slot of SLOTS) {
        expect(isUnlocked(CATALOG.find((i) => i.id === lo[slot])!, progress)).toBe(true);
      }
    }
  });
});

describe('mood', () => {
  it('mirrors the study rhythm and never punishes', () => {
    expect(deriveMood(p())).toBe('curious');
    expect(deriveMood(p({ xp: 50, streak: 2, bestStreak: 2 }))).toBe('bright');
    expect(deriveMood(p({ xp: 900, streak: 7, bestStreak: 7 }))).toBe('blazing');
    expect(deriveMood(p({ xp: 900, streak: 0, bestStreak: 7 }))).toBe('waiting');
  });
});
