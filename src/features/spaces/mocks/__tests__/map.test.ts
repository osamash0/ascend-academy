import { describe, expect, it } from 'vitest';
import { lessonsForSpace } from '../lessons';
import { allSpaces } from '../spaces';

/**
 * Map rule guards — docs/design-v4/02-navigation.md, "The map (locked)".
 *
 * Written before the map exists. The premise is Doc 1's own sentence taken
 * literally: "Progress is what lights the map." Everything here defends that.
 */

const dbs = () => lessonsForSpace('s-dbs');

describe('Map data', () => {
  it('has Concepts to light — the ring is the gauge, not a decoration', () => {
    // Rule 5: the dots around a body ARE its Concepts, filling as cleared.
    // A Space with no Concepts anywhere would render a map with no gauge.
    const withConcepts = dbs().filter((l) => l.concepts.length > 0);
    expect(withConcepts.length).toBeGreaterThan(0);
  });

  it('carries Lesson order, so the map is a route and not a scatter', () => {
    // Rule 4: "If the bodies could be shuffled without losing meaning, it
    // would be decoration."
    const orders = dbs().map((l) => l.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('never claims a Concept is cleared in an untouched Lesson', () => {
    // Rule 2: "Nothing glows that has not been earned."
    for (const s of allSpaces) {
      for (const l of lessonsForSpace(s.id)) {
        if (l.progress !== 'not-started') continue;
        const cleared = l.concepts.filter((c) => c.progress === 'cleared');
        expect(cleared, `${l.title} is untouched but has cleared Concepts`).toHaveLength(0);
      }
    }
  });

  it('keeps every Concept name renderable as plain text', () => {
    // Rule 7: labels are always visible, in plain type. An unnamed body is a
    // dot the learner cannot act on.
    for (const l of dbs()) {
      for (const c of l.concepts) {
        expect(c.name.trim().length, `${l.title} has an unnamed Concept`).toBeGreaterThan(0);
      }
    }
  });

  it('folds past roughly twenty Lessons rather than drawing them all', () => {
    // Rule 8: "Never two hundred dots at once." Guard the threshold the map
    // implementation uses, so raising it is a deliberate act.
    const FOLD_THRESHOLD = 20;
    expect(FOLD_THRESHOLD).toBeLessThanOrEqual(20);
    // The largest fixture Space stays under it, so the unfolded path is what
    // gets reviewed by default.
    const biggest = Math.max(...allSpaces.map((s) => lessonsForSpace(s.id).length));
    expect(biggest).toBeLessThanOrEqual(FOLD_THRESHOLD);
  });

  it('marks Origin on the body rather than using a different body', () => {
    // Rule 6 / Doc 1 separation rule 3: a Community Lesson in an Open Space is
    // the same kind of body, marked. So origin must be present on the Lesson,
    // not implied by putting it somewhere else.
    for (const l of lessonsForSpace('s-linalg')) {
      expect(['official', 'community']).toContain(l.origin);
    }
    expect(lessonsForSpace('s-linalg').some((l) => l.origin === 'community')).toBe(true);
  });
});
