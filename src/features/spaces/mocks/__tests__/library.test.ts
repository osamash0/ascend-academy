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

  it('names the Space every item lives in', () => {
    // Items are pointers into their Space, so context is mandatory.
    for (const item of libraryItems) {
      expect(item.spaceName.trim().length, item.title).toBeGreaterThan(0);
      expect(item.spaceId.trim().length, item.title).toBeGreaterThan(0);
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
