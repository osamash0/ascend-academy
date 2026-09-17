import { describe, expect, it } from 'vitest';
import { heroKind, homeFeed, nextAction, recentlyViewed } from '../library';
import { allSpaces } from '../spaces';
import { lessonsForSpace } from '../lessons';

/**
 * Home guards — Doc 2 "Home — the dashboard".
 *
 * The hard rule: "Home links to Lessons and practice, never to a Space card.
 * A Home item names its Space as context and opens the Lesson." Home ranks
 * across every Space and answers "the one thing"; the Spaces list shows
 * per-Space progress. Same information at two altitudes, not a duplicate.
 *
 * `heroKind` is ported from the old dashboard's homeFeed, which already models
 * onboard / resume / next / review — the shape is proven, the vocabulary is not.
 */

describe('Home', () => {
  it('never targets a Space', () => {
    const spaceIds = new Set(allSpaces.map((s) => s.id));
    for (const i of [nextAction, ...homeFeed, ...recentlyViewed()]) {
      expect(spaceIds.has(i.lessonId), `${i.lessonTitle} targets a Space`).toBe(false);
    }
  });

  it('resolves every target to a Lesson that exists', () => {
    const known = new Set(allSpaces.flatMap((s) => lessonsForSpace(s.id)).map((l) => l.id));
    for (const i of [nextAction, ...homeFeed, ...recentlyViewed()]) {
      expect(known.has(i.lessonId), `${i.lessonTitle} → ${i.lessonId}`).toBe(true);
    }
  });

  it('names the Space as context on every item', () => {
    for (const i of [nextAction, ...homeFeed, ...recentlyViewed()]) {
      expect(i.spaceName.trim().length, i.lessonTitle).toBeGreaterThan(0);
    }
  });

  it('shows the onboarding hero when there is nothing to continue', () => {
    // A brand-new account: one action, join or create. This is the only place
    // Home may point at Spaces, because there is no Lesson to point at yet.
    expect(heroKind({ hasProgress: false, allDone: false })).toBe('onboard');
  });

  it('celebrates when everything is done', () => {
    expect(heroKind({ hasProgress: true, allDone: true })).toBe('review');
  });

  it('resumes in the ordinary case', () => {
    expect(heroKind({ hasProgress: true, allDone: false })).toBe('resume');
  });

  it('never puts the same Lesson in Recently viewed and the next action', () => {
    // The old dashboard dedupes these for the same reason: seeing "Basics"
    // twice on one screen reads as a bug, not as emphasis.
    expect(recentlyViewed().some((r) => r.lessonId === nextAction.lessonId)).toBe(false);
  });

  it('orders Recently viewed most-recent first', () => {
    const times = recentlyViewed().map((r) => +new Date(r.viewedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});
