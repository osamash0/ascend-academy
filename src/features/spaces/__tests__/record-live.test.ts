import { afterEach, describe, expect, it } from 'vitest';
import * as history from '../mocks/history';
import * as rank from '../mocks/rank';
import * as record from '../data/record';
import { setLiveWorld, type World } from '../data/world';

afterEach(() => setLiveWorld(null));

const live = (r: Partial<World['record']>) =>
  setLiveWorld({
    viewer: { id: 'u', name: 'Lea', avatarUrl: null },
    spaces: [], lessons: [], activity: [], streakDays: 0, xp: 0, notifications: [],
    record: { studyDays: [], xpEvents: [], moments: [], ...r },
  });

describe('the record', () => {
  it('demo answers exactly as the fixtures do', () => {
    expect(record.currentRun()).toBe(history.currentRun());
    expect(record.longestRun()).toBe(history.longestRun());
    expect(record.daysStudied()).toBe(history.daysStudied());
    expect(record.recentWeeks()).toEqual(history.recentWeeks());
    expect(record.xpBySource()).toEqual(rank.xpBySource());
    expect(record.todayNow()).toBe(history.TODAY);
  });

  it('live counts runs from the real days, with nothing borrowed from the fixtures', () => {
    live({
      studyDays: [
        { date: '2026-10-12', summary: 'Read 4 pages' },
        { date: '2026-10-11', summary: 'Read 2 pages' },
        { date: '2026-10-03', summary: 'Read 9 pages' },
        { date: '2026-10-02', summary: '3 of 4 questions right' },
        { date: '2026-10-01', summary: 'Finished a Lesson' },
      ],
      xpEvents: [
        { id: '1', source: 'learning', label: 'Answered a question right', spaceName: null, amount: 10, at: '2026-10-12T10:00:00Z' },
        { id: '2', source: 'milestone', label: 'Earned “Curious Mind”', spaceName: null, amount: 15, at: '2026-10-11T10:00:00Z' },
        { id: '3', source: 'learning', label: 'Finished a Lesson', spaceName: null, amount: 20, at: '2026-10-01T10:00:00Z' },
      ],
    });
    expect(record.currentRun()).toBe(2);
    expect(record.longestRun()).toBe(3);
    expect(record.daysStudied()).toBe(5);
    expect(record.lastStudied()).toBe('2026-10-12');
    expect(record.xpBySource()).toEqual([
      { source: 'learning', total: 30, count: 2 },
      { source: 'milestone', total: 15, count: 1 },
    ]);
    expect(record.todayNow()).toBe(new Date().toISOString().slice(0, 10));
  });

  it('a new account has an empty record, not the fixture one', () => {
    live({});
    expect(record.currentRun()).toBe(0);
    expect(record.momentsNow()).toEqual([]);
    expect(record.xpEventsNow()).toEqual([]);
  });
});
