import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, planExam } from '../examPlan';

const LECTURES = [
  { id: 'a', title: 'Basics', total_slides: 40, ideas: [{ name: 'Models', first_page: 1 }, { name: 'Keys', first_page: 21 }] },
  { id: 'b', title: 'Normalization', total_slides: 60, ideas: [{ name: 'FDs', first_page: 1 }, { name: 'Closure', first_page: 31 }] },
];
const BASE = { lectures: LECTURES, trail: {}, marks: [], weak: [], today: '2026-10-11' };

describe('the exam plan', () => {
  it('counts calendar days, whatever the time zone', () => {
    expect(daysBetween('2026-10-11', '2026-10-21')).toBe(10);
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  });

  it('reads first, rehearses everything two days out, and keeps the last day light', () => {
    const plan = planExam({ ...BASE, exam: '2026-10-21' });
    expect(plan.daysLeft).toBe(10);
    expect(plan.unreadPages).toBe(100);
    // 70% of 10 days reading → 7 days at 15 pages.
    expect(plan.pagesPerDay).toBe(15);
    expect(plan.days.map((d) => d.kind)).toEqual(['read', 'read', 'read', 'read', 'read', 'read', 'read', 'review', 'rehearse', 'eve']);
    expect(plan.days[8].steps[0]).toMatchObject({ kind: 'rehearse', title: 'Full rehearsal', lectureIds: ['a', 'b'] });
    // Every page is planned exactly once, in lecture order.
    const reads = plan.days.flatMap((d) => d.steps).filter((s) => s.kind === 'read');
    expect(reads.reduce((n, s) => n + s.minutes, 0)).toBe(100);
    expect(reads[0]).toMatchObject({ lectureId: 'a', page: 1, why: 'Pages 1–15' });
    expect(reads.find((s) => s.lectureId === 'b')).toMatchObject({ page: 1 });
  });

  it('starts from where you stopped and puts your misses first, and on the last day', () => {
    const plan = planExam({
      ...BASE,
      exam: '2026-10-16',
      trail: { a: { page: 40, pages: 40 }, b: { page: 30, pages: 60 } },
      weak: [{ lecture_id: 'b', idea: 'closure steps', page: 34 }],
    });
    expect(plan.unreadPages).toBe(30);
    const first = plan.days[0].steps;
    expect(first[0]).toMatchObject({ kind: 'read', lectureId: 'b', page: 31 });
    expect(first[1]).toMatchObject({ kind: 'revisit', title: 'Closure', page: 31 });
    expect(plan.days.at(-1)).toMatchObject({ kind: 'eve' });
    expect(plan.days.at(-1)!.steps[0]).toMatchObject({ kind: 'revisit', title: 'Closure' });
  });

  it('keeps a miss even before the lecture is grouped into ideas, and rehearses in chunks when review runs dry', () => {
    const plan = planExam({
      ...BASE,
      lectures: LECTURES.map((l) => ({ ...l, ideas: null })),
      exam: '2026-10-21',
      weak: [{ lecture_id: 'b', idea: '2PL phases', page: 34 }],
    });
    const steps = plan.days.flatMap((d) => d.steps);
    expect(steps.find((s) => s.kind === 'revisit')).toMatchObject({ title: '2PL phases', page: 34 });
    expect(plan.days[7].steps.at(-1)).toMatchObject({ kind: 'rehearse', title: 'Rehearse Basics & Normalization' });
    expect(plan.days.some((d) => d.steps.length === 0)).toBe(false);
  });

  it('has nothing to plan on or after the exam day', () => {
    expect(planExam({ ...BASE, exam: '2026-10-11' }).days).toEqual([]);
  });
});
