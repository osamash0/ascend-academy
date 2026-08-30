import { describe, expect, it } from 'vitest';
import { allSpaces, mySpaces, discoverSpaces } from '../spaces';
import { lessonsForSpace, publishedLessonsForSpace } from '../lessons';
import {
  contributionsForLesson,
  contributionsForSpace,
  dbsMembers,
  spaceContributions,
} from '../contributions';

/**
 * Guards on the fixture set itself.
 *
 * These are not tests of product code — they are tests that the mock data
 * obeys the rules in docs/design-v4/01-foundations.md. A fixture that quietly
 * breaks a locked rule produces a screen that looks right and is wrong, which
 * is the most expensive kind of mistake to find later.
 */

describe('Space fixtures', () => {
  it('gives every Space a real Owner — anonymous content is not allowed', () => {
    for (const s of allSpaces) {
      expect(s.owner.name.trim().length, `${s.name} has no owner`).toBeGreaterThan(0);
    }
  });

  it('uses unique ids', () => {
    const ids = allSpaces.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps strict mode dependent on grounding being on', () => {
    // Grounding Rule 5: strict mode "requires grounding to be on".
    for (const s of allSpaces) {
      if (s.strictMode) expect(s.groundingEnabled, s.name).toBe(true);
    }
  });

  it('never lets a viewer star their own Space', () => {
    // Engagement Rule 3: "You can't ... star your own Space."
    for (const s of allSpaces) {
      if (s.viewerRole === 'owner') expect(s.starredByViewer, s.name).toBe(false);
    }
  });

  it('separates Mine from Discover — Discover is never already joined', () => {
    for (const s of discoverSpaces) expect(s.viewerRole, s.name).toBeNull();
    for (const s of mySpaces) expect(s.viewerRole, s.name).not.toBeNull();
  });

  it('covers the states the screens have to render', () => {
    expect(allSpaces.some((s) => s.state === 'archived')).toBe(true);
    expect(allSpaces.some((s) => s.mode === 'open')).toBe(true);
    expect(allSpaces.some((s) => s.mode === 'guided')).toBe(true);
    expect(allSpaces.some((s) => s.groundingEnabled)).toBe(true);
    expect(allSpaces.some((s) => !s.groundingEnabled)).toBe(true);
    expect(allSpaces.some((s) => s.universe === null)).toBe(true);
  });
});

describe('Lesson fixtures', () => {
  it('orders the path with no gaps or duplicates', () => {
    for (const s of allSpaces) {
      const orders = lessonsForSpace(s.id).map((l) => l.order);
      if (!orders.length) continue;
      expect(new Set(orders).size, `${s.name} has duplicate order`).toBe(orders.length);
      expect(orders, `${s.name} is not 1..n`).toEqual(
        Array.from({ length: orders.length }, (_, i) => i + 1),
      );
    }
  });

  it('renders no grounding value where grounding is switched off', () => {
    // Grounding Rule 1: dormant until switched on — no marker anywhere.
    const off = allSpaces.filter((s) => !s.groundingEnabled);
    for (const s of off) {
      for (const l of lessonsForSpace(s.id)) {
        expect(l.grounding, `${s.name} / ${l.title}`).toBeNull();
      }
    }
  });

  it('hides drafts and processing Lessons from Members', () => {
    // Rules 1: Members only ever see published Lessons.
    for (const s of allSpaces) {
      for (const l of publishedLessonsForSpace(s.id)) {
        expect(l.state, l.title).toBe('published');
      }
    }
  });

  it('keeps Community-origin Lessons out of Guided Spaces', () => {
    // Only Owner/Editors publish into a Guided path.
    for (const s of allSpaces.filter((x) => x.mode === 'guided')) {
      for (const l of lessonsForSpace(s.id)) {
        expect(l.origin, `${s.name} / ${l.title}`).toBe('official');
      }
    }
  });

  it('gives every Lesson an author, whatever its origin', () => {
    for (const s of allSpaces) {
      for (const l of lessonsForSpace(s.id)) {
        expect(l.author.name.trim().length, l.title).toBeGreaterThan(0);
      }
    }
  });

  it('agrees with the Space about how many Lessons it has', () => {
    // Caught on screen first: Machine Learning claimed "0/23 Lessons" in the
    // hero while the rail below it rendered "0 Lessons". A Space that promises
    // content it cannot show is exactly the blind join the public-page rule
    // exists to prevent.
    for (const s of allSpaces) {
      expect(lessonsForSpace(s.id).length, `${s.name} lessonCount`).toBe(s.lessonCount);
    }
  });

  it('never reports more Lessons done than exist', () => {
    for (const s of allSpaces) {
      expect(s.lessonsDone, s.name).toBeLessThanOrEqual(s.lessonCount);
    }
  });

  it('treats a removed source file as the exception, not the default', () => {
    // Caught on screen: every row read "Source file removed" because the
    // fixture helper defaulted material to null. Deleting a Material is a rare
    // event; if most Lessons lack one, the marker means nothing.
    const all = allSpaces.flatMap((s) => lessonsForSpace(s.id));
    const missing = all.filter((l) => l.material === null);
    expect(missing.length, 'too many Lessons with no source file').toBeLessThan(all.length / 2);
  });

  it('keeps the real duplicate titles, because the real data has them', () => {
    const titles = lessonsForSpace('s-crypto').map((l) => l.title);
    expect(titles.length).toBeGreaterThan(new Set(titles).size);
  });
});

describe('Contribution fixtures', () => {
  it('is always Community origin — Official content is a Lesson', () => {
    for (const c of spaceContributions) expect(c.origin).toBe('community');
  });

  it('resolves every non-orphaned Lesson anchor to a Lesson that exists', () => {
    const allLessonIds = new Set(allSpaces.flatMap((s) => lessonsForSpace(s.id)).map((l) => l.id));
    for (const c of spaceContributions) {
      if (c.anchor.level !== 'lesson') continue;
      if (c.orphaned) {
        expect(allLessonIds.has(c.anchor.lessonId), `${c.title} should dangle`).toBe(false);
      } else {
        expect(allLessonIds.has(c.anchor.lessonId), `${c.title} dangles`).toBe(true);
      }
    }
  });

  it('anchors the Normalization set to the Lesson actually called Normalization', () => {
    // Catches the id scheme silently re-pointing if a Lesson is inserted.
    const normalization = lessonsForSpace('s-dbs').find((l) => l.title === 'Normalization');
    expect(normalization).toBeDefined();
    expect(contributionsForLesson(normalization!.id).length).toBeGreaterThan(0);
  });

  it('sorts community sections by likes, descending', () => {
    const likes = contributionsForSpace('s-dbs').map((c) => c.likeCount);
    expect([...likes].sort((a, b) => b - a)).toEqual(likes);
  });

  it('never lets an author like their own contribution', () => {
    // Engagement Rule 3.
    for (const c of [...spaceContributions, ...contributionsForLesson('l-s-dbs-4')]) {
      if (c.author.id === 'p-viewer') expect(c.likedByViewer, c.title).toBe(false);
    }
  });

  it('includes a zero-progress member, for the XP like-gate', () => {
    // Engagement Rule 3: likes from members with zero progress grant no XP.
    expect(dbsMembers.some((m) => m.progress === 0)).toBe(true);
  });

  it('has exactly one Owner per Space member list', () => {
    expect(dbsMembers.filter((m) => m.role === 'owner')).toHaveLength(1);
  });
});
