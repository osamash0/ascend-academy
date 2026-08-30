import { describe, expect, it } from 'vitest';
import { adjacentLessons, publishedLessonsForSpace } from '../lessons';
import { allSpaces } from '../spaces';

/**
 * Navigation guards — Doc 2 "Landing and return".
 *
 * The pager walks the path, and the path is the *published* path. Doc 1 rule 1:
 * "Members only ever see published lessons." A pager that steps into a draft
 * would leak unpublished work to anyone who pressed the arrow key twice.
 */

describe('Lesson pager', () => {
  it('gives every published Lesson a prev and next except at the ends', () => {
    const ls = publishedLessonsForSpace('s-dbs');
    expect(ls.length).toBeGreaterThan(2);
    expect(adjacentLessons('s-dbs', ls[0].id).prev).toBeNull();
    expect(adjacentLessons('s-dbs', ls[0].id).next?.id).toBe(ls[1].id);
    expect(adjacentLessons('s-dbs', ls[ls.length - 1].id).next).toBeNull();
  });

  it('never pages into an unpublished Lesson', () => {
    for (const s of allSpaces) {
      for (const l of publishedLessonsForSpace(s.id)) {
        const { prev, next } = adjacentLessons(s.id, l.id);
        for (const n of [prev, next]) {
          if (n) expect(n.state, `${s.name} / ${n.title}`).toBe('published');
        }
      }
    }
  });

  it('walks the whole path forward without skipping or repeating', () => {
    const ls = publishedLessonsForSpace('s-dbs');
    const walked: string[] = [ls[0].id];
    let cur = ls[0].id;
    for (;;) {
      const next = adjacentLessons('s-dbs', cur).next;
      if (!next) break;
      walked.push(next.id);
      cur = next.id;
    }
    expect(walked).toEqual(ls.map((l) => l.id));
  });

  it('returns nulls for a Lesson that is not in the Space', () => {
    expect(adjacentLessons('s-dbs', 'l-does-not-exist')).toEqual({ prev: null, next: null });
  });
});
