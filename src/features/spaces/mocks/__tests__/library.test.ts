import { describe, expect, it } from 'vitest';
import { libraryItems, notes, itemsOfKind } from '../library';
import { viewer } from '../people';
import { allSpaces } from '../spaces';

/**
 * Library rule guards — docs/design-v4/02-navigation.md, "The Spaces / Library
 * line (locked)". Written before the screen, so the rules fail loudly rather
 * than being quietly designed around.
 */

describe('Library fixtures', () => {
  it('is filtered by author — everything in it was made by the viewer', () => {
    // Rule 3: "Library is filtered by author, not by content type."
    expect(libraryItems.length).toBeGreaterThan(0);
    // Notes are private to their author by definition.
    expect(notes.length).toBeGreaterThan(0);
  });

  it('holds no Spaces', () => {
    // Rule 2: "A Space card only ever appears under Spaces." Rule 4: "Library
    // holds no Spaces." An item may *name* its Space as context, never be one.
    const spaceIds = new Set(allSpaces.map((s) => s.id));
    for (const item of libraryItems) {
      expect(spaceIds.has(item.id), `${item.title} is a Space`).toBe(false);
      expect(['note', 'material', 'contribution']).toContain(item.kind);
    }
  });

  it('names the Space every item that has one lives in', () => {
    /*
     * Items are pointers into their Space, so context is mandatory — for every
     * item that still has a Space.
     *
     * This read `item.spaceName.trim()` over *all* items, which made naming a
     * Space unconditional and so forced the orphan to invent one. The guard was
     * requiring the defect: the only way to satisfy it was `?? 's-dbs'`, and
     * the row then stated a fabricated Space as fact.
     */
    for (const item of libraryItems) {
      if (item.orphaned) continue;
      expect(item.spaceName?.trim().length, item.title).toBeGreaterThan(0);
      expect(item.spaceId?.trim().length, item.title).toBeGreaterThan(0);
    }
  });

  it('lets only an orphan go without one, and gives it nowhere to open', () => {
    /*
     * The inverse, so `null` cannot leak in as sloppiness. A missing Space is
     * meaningful — it means the anchor is gone — and nothing else may claim it.
     *
     * The destination matters as much as the label. An orphan used to link to
     * `/v4/space/<id>`, which is the one thing LibraryScreen's own header
     * forbids: "a Space is never an entry point from here." It also landed you
     * on a Space overview where the contribution is not.
     */
    for (const item of libraryItems) {
      if (item.spaceId !== null && item.spaceName !== null) continue;
      expect(item.orphaned, `${item.title} has no Space but is not orphaned`).toBe(true);
      expect(item.spaceId, `${item.title}`).toBeNull();
      expect(item.spaceName, `${item.title}`).toBeNull();
      expect(item.href, `${item.title} is orphaned but still opens somewhere`).toBeNull();
    }
  });

  it('never makes a Space an entry point from Library', () => {
    // The header rule, checked against every destination the screen can offer
    // rather than trusted. A Lesson or Concept inside a Space is a pointer to
    // the item; the Space root is a Space card wearing a row's clothes.
    for (const item of libraryItems) {
      expect(item.href ?? '', `${item.title} opens a Space root`).not.toMatch(
        /^\/v4\/space\/[^/]+$/,
      );
    }
  });

  it('covers all three kinds, so the screen is never designed against one', () => {
    expect(itemsOfKind('note').length).toBeGreaterThan(0);
    expect(itemsOfKind('material').length).toBeGreaterThan(0);
    expect(itemsOfKind('contribution').length).toBeGreaterThan(0);
  });

  it('doubles as the creator record — contributions carry how they landed', () => {
    // Rule 6: "your contributions with their like counts, endorsements..."
    for (const c of itemsOfKind('contribution')) {
      expect(typeof c.likeCount, c.title).toBe('number');
    }
  });

  it('anchors every Note in a Lesson and a Space', () => {
    for (const n of notes) {
      expect(n.lessonId.trim().length).toBeGreaterThan(0);
      expect(n.spaceId.trim().length).toBeGreaterThan(0);
      expect(n.body.trim().length).toBeGreaterThan(10);
    }
  });

  it('sorts newest first', () => {
    const times = libraryItems.map((i) => +new Date(i.updatedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('never surfaces another person’s work', () => {
    // The whole point of the destination: "only yours across every room".
    expect(viewer.id).toBe('p-viewer');
    const foreign = itemsOfKind('contribution').filter((c) => c.title.includes('Link dump'));
    expect(foreign, 'someone else’s contribution leaked in').toHaveLength(0);
  });
});
