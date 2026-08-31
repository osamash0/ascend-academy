import { describe, expect, it } from 'vitest';
import { libraryItems, impactRows, resolveContributionAnchor } from '../library';
import {
  linalgContributions,
  normalizationContributions,
  spaceContributions,
} from '../contributions';
import { conceptContributions } from '../concepts';

/*
 * All four fixture groups. `coherence.test.ts` builds the same aggregate from
 * three of them and omits `linalgContributions`, which the app itself indexes
 * in `byLesson` and returns from `contributionsForSpace` — so any rule that
 * guard enforces is unenforced for a quarter of the fixtures.
 */
const everyContribution = [
  ...normalizationContributions,
  ...spaceContributions,
  ...linalgContributions,
  ...conceptContributions,
];

/**
 * An orphan names the Space it actually came from.
 *
 * `library.ts` resolved a dead Lesson anchor to `spaceId: null` and then wrote
 * `at.spaceId ?? 's-dbs'` in two places, under a comment claiming it fell back
 * to "its last known Space". It did not — it fell back to a constant, so every
 * orphan from every Space was labelled Database Systems.
 *
 * It survived because the only orphan fixture *is* from Database Systems, so
 * the constant and the truth agreed; and because the guard that would have
 * caught it, `coherence.test.ts`'s anchor-resolution check, opens with
 * `if (row.orphaned) continue`. A wrong value that matches the right one on
 * every row you own is invisible until someone adds a row you do not.
 *
 * So the decisive case is constructed rather than taken from the fixtures: an
 * orphan from a Space that is not `s-dbs`.
 */

describe('a dead Lesson anchor still knows its Space', () => {
  it('reports the Space the anchor carries, not a constant', () => {
    const at = resolveContributionAnchor(
      { level: 'lesson', lessonId: 'l-s-linalg-long-gone', spaceId: 's-linalg' },
      'c-probe',
    );
    expect(at.href, 'a deleted Lesson must not resolve to a Lesson link').toBeNull();
    expect(
      at.spaceId,
      'an orphan from Linear Algebra was attributed to another Space',
    ).toBe('s-linalg');
    expect(at.spaceId).not.toBe('s-dbs');
  });

  it('admits it does not know, rather than guessing', () => {
    const at = resolveContributionAnchor({ level: 'lesson', lessonId: 'l-nowhere' }, 'c-probe');
    expect(at.spaceId, 'an unknown Space was filled in with a guess').toBeNull();
  });

  it('still resolves a live Lesson through the Lesson, ignoring the hint', () => {
    // The hint is only for the orphan case; a live anchor must not be able to
    // claim a Space its Lesson is not in.
    const live = everyContribution.find(
      (c) => c.anchor.level === 'lesson' && !c.orphaned,
    );
    expect(live, 'no live Lesson-anchored contribution to check against').toBeTruthy();
    const anchor = live!.anchor as { level: 'lesson'; lessonId: string };
    const honest = resolveContributionAnchor(anchor, live!.id);
    const lied = resolveContributionAnchor({ ...anchor, spaceId: 's-crypto' }, live!.id);
    expect(lied.spaceId, 'a live anchor took the hint over its real Lesson').toBe(
      honest.spaceId,
    );
  });
});

describe('every orphan the fixtures carry can name its Space', () => {
  /*
   * The hint is optional on the type, because a live anchor does not need it.
   * That makes it forgettable exactly where it matters, so this is the check
   * that an orphan fixture cannot be added without one.
   */
  it('declares a Space on every orphaned Lesson anchor', () => {
    const orphans = everyContribution.filter(
      (c) => c.orphaned && c.anchor.level === 'lesson',
    );
    expect(orphans.length, 'no orphan fixtures — this guard is vacuous').toBeGreaterThan(0);
    for (const c of orphans) {
      const anchor = c.anchor as { level: 'lesson'; lessonId: string; spaceId?: string };
      expect(
        anchor.spaceId,
        `"${c.title}" is orphaned and does not say which Space it was in`,
      ).toBeTruthy();
    }
  });

  it('never leaves an orphan row without a Space in either surface', () => {
    for (const item of libraryItems().filter((i) => i.orphaned)) {
      expect(item.spaceId.trim(), `Library row "${item.title}" has no Space`).not.toBe('');
      expect(item.spaceName.trim(), `Library row "${item.title}" has no Space name`).not.toBe('');
    }
    for (const row of impactRows().filter((r) => r.orphaned)) {
      expect(row.spaceId.trim(), `impact row "${row.title}" has no Space`).not.toBe('');
    }
  });
});
