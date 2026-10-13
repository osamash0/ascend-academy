import { describe, expect, it } from 'vitest';
import { downstream, layoutStars, starKey, startHere, upstream, type CourseLink } from '../constellation';

const LECTURES = [
  { id: 'a', title: 'Basics', total_slides: 20, ideas: [{ name: 'Keys', first_page: 1 }, { name: 'Relations', first_page: 11 }] },
  { id: 'b', title: 'Normalization', total_slides: 60, ideas: [{ name: 'Closure', first_page: 31 }, { name: 'FDs', first_page: 1 }, { name: 'BCNF', first_page: 41 }] },
];
const link = (fl: string, fp: number, tl: string, tp: number): CourseLink => ({ from: { lecture_id: fl, first_page: fp }, to: { lecture_id: tl, first_page: tp }, why: '' });
// Keys → FDs → Closure → BCNF, and Relations → BCNF.
const LINKS = [link('a', 1, 'b', 1), link('b', 1, 'b', 31), link('b', 31, 'b', 41), link('a', 11, 'b', 41)];

describe('the course constellation', () => {
  it('lays stars out by lecture and page, sized by how long the idea runs', () => {
    const stars = layoutStars(LECTURES, [], 1000, 400);
    expect(stars.map((s) => s.name)).toEqual(['Keys', 'Relations', 'FDs', 'Closure', 'BCNF']);
    expect(stars[0].x).toBeLessThan(stars[2].x);
    expect(stars[2].y).toBeLessThan(stars[3].y);
    // FDs run 30 pages, Keys 10: the bigger idea is the bigger star.
    expect(stars[2].r).toBeGreaterThan(stars[0].r);
  });

  it('walks everything an idea builds on, nearest first, and what builds on it', () => {
    expect(upstream(starKey('b', 41), LINKS)).toEqual([starKey('b', 31), starKey('a', 11), starKey('b', 1), starKey('a', 1)]);
    expect(downstream(starKey('b', 1), LINKS)).toEqual([starKey('b', 31)]);
  });

  it('points at the earliest red foundation first, else the earliest dark one', () => {
    const marks = [
      { lecture_id: 'b', page: 33, correct: false },
      { lecture_id: 'a', page: 2, correct: true },
    ];
    const stars = layoutStars(LECTURES, marks, 1000, 400);
    expect(startHere(starKey('b', 41), LINKS, stars)?.name).toBe('Closure');
    const none = layoutStars(LECTURES, [{ lecture_id: 'a', page: 2, correct: true }], 1000, 400);
    expect(startHere(starKey('b', 41), LINKS, none)?.name).toBe('Relations');
  });
});
