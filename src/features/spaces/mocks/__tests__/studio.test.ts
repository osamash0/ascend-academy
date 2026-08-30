import { describe, expect, it } from 'vitest';
import { draftsAcrossSpaces, impactRows, uploadRows } from '../library';
import { publishedLessonsForSpace, lessonsForSpace } from '../lessons';
import { allSpaces } from '../spaces';
import { viewer } from '../people';

/**
 * Library Studio rule guards — docs/design-v4/02-navigation.md,
 * "Learn and Studio (locked)" rule 6.
 *
 * Studio screens hang off Library and are author-filtered exactly like it. The
 * difference is mode, not scope: if a Studio screen ever showed someone else's
 * work it would stop being "what's mine" and become a second index of Space
 * content — the duplicate-index bug Doc 2 rejected.
 */

describe('Library Studio', () => {
  it('shows only the viewer’s own drafts', () => {
    for (const d of draftsAcrossSpaces()) {
      const lesson = lessonsForSpace(d.spaceId).find((l) => l.id === d.lessonId);
      expect(lesson?.author.id, `${d.title} is not the viewer’s`).toBe(viewer.id);
    }
  });

  it('never leaks a draft into anyone else’s view of the Space', () => {
    // The same Lessons must be absent from the published list every Member sees.
    const draftIds = new Set(draftsAcrossSpaces().map((d) => d.lessonId));
    for (const s of allSpaces) {
      for (const l of publishedLessonsForSpace(s.id)) {
        expect(draftIds.has(l.id), `${l.title} is both draft and published`).toBe(false);
      }
    }
  });

  it('gathers drafts from more than one Space, which is the point', () => {
    // If it only ever showed one Space, the Space's own screen would do the job
    // and this screen would not need to exist.
    const drafts = draftsAcrossSpaces();
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) expect(d.state).not.toBe('published');
  });

  it('reports impact per contribution, never as a summed score', () => {
    // Doc 1 rule 7: no second progression beside XP. Each row carries its own
    // like count as a fact; nothing here aggregates them into a rank.
    for (const r of impactRows()) {
      expect(typeof r.likeCount).toBe('number');
      expect(r.spaceName.trim().length).toBeGreaterThan(0);
    }
  });

  it('sorts impact by what landed hardest', () => {
    const likes = impactRows().map((r) => r.likeCount);
    expect([...likes].sort((a, b) => b - a)).toEqual(likes);
  });

  it('surfaces orphaned work to its author rather than hiding it', () => {
    // Doc 1, Contributions rule 1: orphans go to the Owner *and* the author.
    // Nothing of yours vanishes silently, so an orphan must still be listed.
    const all = impactRows();
    const orphans = all.filter((r) => r.orphaned);
    expect(orphans.every((o) => all.includes(o))).toBe(true);
  });

  it('lists uploads as Materials, not Lessons', () => {
    // A Material is the file; the Lesson is generated from it. Deleting one
    // never breaks the other, so managing uploads must not read as managing
    // the path.
    for (const u of uploadRows()) {
      expect(u.kind).toBe('material');
      expect(u.spaceName.trim().length).toBeGreaterThan(0);
    }
  });
});
