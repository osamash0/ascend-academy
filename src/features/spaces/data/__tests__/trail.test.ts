import { beforeEach, describe, expect, it } from 'vitest';
import { markTrail, readTo, readTrail } from '../trail';

const mark = (page: number) => markTrail('lec', { page, pages: 66, course: 'space' });

describe('the reading trail (LS-055)', () => {
  beforeEach(() => window.localStorage.clear());

  it('resumes where you are but keeps the furthest page you reached', () => {
    mark(16);
    mark(3); // looking back, or a deep link to page 3
    const m = readTrail().lec;
    expect(m.page).toBe(3);
    expect(readTo(m)).toBe(16);
  });

  it('moves the high-water mark forward as you read on', () => {
    mark(16);
    mark(3);
    mark(20);
    expect(readTo(readTrail().lec)).toBe(20);
  });

  it('reads a mark written before the high-water mark existed', () => {
    expect(readTo({ page: 12, pages: 66 })).toBe(12);
    expect(readTo(undefined)).toBe(0);
  });

  it('never reports more pages than the deck has', () => {
    expect(readTo({ page: 3, pages: 10, furthest: 99 })).toBe(10);
  });
});
