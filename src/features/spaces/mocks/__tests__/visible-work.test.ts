import { describe, expect, it } from 'vitest';
import { canSeeHidden, visibleContributions } from '../engagement';
import { normalizationContributions, spaceContributions } from '../contributions';
import { conceptContributions } from '../concepts';
import { allSpaces } from '../spaces';
import { lessonsForSpace, publishedLessonsForSpace } from '../lessons';
import { viewer } from '../people';

/**
 * Nobody's work vanishes silently.
 *
 * Doc 1 states it twice — hidden content stays "visible to its author and the
 * Owner/Editors", orphaned content is "surfaced to the Owner *and* to the
 * author". Both are conditional-visibility rules, and both were implemented at
 * five call sites as an unconditional `!c.hidden`. There was no code path at
 * all by which an author could see their own hidden work.
 */

const everyContribution = [
  ...normalizationContributions,
  ...spaceContributions,
  ...conceptContributions,
];

describe('hidden work stays visible to the people it belongs to', () => {
  it('has a hidden fixture, so none of this is vacuous', () => {
    expect(everyContribution.filter((c) => c.hidden).length).toBeGreaterThan(0);
  });

  it('shows an author their own hidden contribution', () => {
    expect(canSeeHidden(viewer.id, null, viewer.id)).toBe(true);
  });

  it('shows the Owner and Editors everything hidden in their Space', () => {
    expect(canSeeHidden('p-someone', 'owner', viewer.id)).toBe(true);
    expect(canSeeHidden('p-someone', 'editor', viewer.id)).toBe(true);
  });

  it('hides it from an ordinary Member and from a stranger', () => {
    expect(canSeeHidden('p-someone', 'member', viewer.id)).toBe(false);
    expect(canSeeHidden('p-someone', null, viewer.id)).toBe(false);
  });

  it('filters a real list by role rather than unconditionally', () => {
    const asMember = visibleContributions(everyContribution, 'member');
    const asOwner = visibleContributions(everyContribution, 'owner');
    expect(asOwner.length).toBeGreaterThan(asMember.length);
    // A Member sees nothing hidden that is not their own.
    for (const c of asMember) {
      if (c.hidden) expect(c.author.id).toBe(viewer.id);
    }
  });
});

describe('a Space and its Lessons agree about progress', () => {
  it('counts the same Lessons done as the path does', () => {
    /*
     * `lessonsDone` is stated on the Space and also derivable from its path —
     * two sources for one fact. Statistik I said 3 while its fixtures said 3,
     * and nothing checked; making it a finished Space (so the "Done" badge
     * could render at all) is exactly the edit that would have desynced them.
     */
    for (const s of allSpaces) {
      const done = publishedLessonsForSpace(s.id).filter((l) => l.progress === 'done').length;
      expect(s.lessonsDone, `${s.name} says ${s.lessonsDone}, its path says ${done}`).toBe(done);
    }
  });

  it('counts the same Lessons as it has', () => {
    for (const s of allSpaces) {
      expect(s.lessonCount, `${s.name}`).toBe(lessonsForSpace(s.id).length);
    }
  });

  it('has exactly one finished Space, so the Done badge is reachable', () => {
    // It sat in an if/else chain with two live branches and had never rendered.
    const finished = allSpaces.filter((s) => s.lessonCount > 0 && s.lessonsDone === s.lessonCount);
    expect(finished.length).toBeGreaterThan(0);
  });
});
