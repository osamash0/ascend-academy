import { describe, expect, it } from 'vitest';
import { planToday } from '../today';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const LECTURES = [
  { id: 'intro', title: 'Introduction', total_slides: 20, ideas: [{ name: 'Basics', first_page: 1 }] },
  {
    id: 'norm',
    title: 'Normalization',
    total_slides: 82,
    ideas: [
      { name: 'FDs', first_page: 4 },
      { name: 'Closure', first_page: 32 },
      { name: 'BCNF', first_page: 41 },
    ],
  },
];

describe('today’s session', () => {
  it('reads on, revisits the latest miss, and refreshes the longest-faded idea', () => {
    const steps = planToday({
      lectures: LECTURES,
      marks: [
        { lecture_id: 'norm', page: 34, correct: false, at: daysAgo(1) },
        { lecture_id: 'norm', page: 10, correct: true, at: daysAgo(12) },
        { lecture_id: 'intro', page: 3, correct: true, at: daysAgo(9) },
      ],
      weak: [{ lecture_id: 'norm', idea: 'closure steps', page: 34 }],
      resume: { lectureId: 'norm', page: 50, pages: 82 },
      now: NOW,
    });
    expect(steps.map((s) => [s.kind, s.title, s.page])).toEqual([
      ['read', 'Normalization', 50],
      ['revisit', 'Closure', 32],
      ['refresh', 'FDs', 4],
    ]);
    expect(steps[1].why).toContain('pages 32–40');
    expect(steps[2].why).toContain('12 days ago');
  });

  it('on a first visit, just starts at the beginning', () => {
    const steps = planToday({ lectures: LECTURES, marks: [], weak: [], resume: null, now: NOW });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'read', title: 'Introduction', page: 1 });
  });
});
