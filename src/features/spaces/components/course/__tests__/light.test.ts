import { describe, expect, it } from 'vitest';
import { FADE_AFTER_DAYS, ideaAt, lightIdeas } from '../light';

const IDEAS = [{ first_page: 1 }, { first_page: 12 }, { first_page: 30 }];
const NOW = Date.parse('2026-10-10T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe('lighting a lecture’s ideas', () => {
  it('files a page under the idea whose pages contain it', () => {
    expect(ideaAt(IDEAS, 1)).toBe(0);
    expect(ideaAt(IDEAS, 11)).toBe(0);
    expect(ideaAt(IDEAS, 12)).toBe(1);
    expect(ideaAt(IDEAS, 80)).toBe(2);
    expect(ideaAt([{ first_page: 5 }], 2)).toBe(-1);
  });

  it('leaves untested ideas dark, lights right answers, and a wrong one wins', () => {
    const marks = [
      { lecture_id: 'L', page: 14, correct: true },
      { lecture_id: 'L', page: 33, correct: true },
      { lecture_id: 'L', page: 31, correct: false },
      { lecture_id: 'other', page: 2, correct: true },
    ];
    expect(lightIdeas('L', IDEAS, marks, NOW)).toEqual(['dark', 'lit', 'weak']);
  });

  it('lets a right answer fade after a week, and the newest proof keeps it lit', () => {
    const old = [{ lecture_id: 'L', page: 14, correct: true, at: daysAgo(FADE_AFTER_DAYS + 2) }];
    expect(lightIdeas('L', IDEAS, old, NOW)[1]).toBe('fading');
    const refreshed = [...old, { lecture_id: 'L', page: 20, correct: true, at: daysAgo(1) }];
    expect(lightIdeas('L', IDEAS, refreshed, NOW)[1]).toBe('lit');
  });
});
