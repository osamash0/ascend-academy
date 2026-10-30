import { describe, expect, it } from 'vitest';
import { homeFromWorld } from '../data/home';
import type { World } from '../data/world';
import { emptyWorld } from './emptyWorld';
import type { Lesson, Space } from '../types';

const space = (id: string, over: Partial<Space> = {}) =>
  ({ id, name: id.toUpperCase(), viewerRole: 'member', state: 'active', newSinceLastVisit: 0, ...over }) as Space;

const lesson = (spaceId: string, order: number, over: Partial<Lesson> = {}) =>
  ({
    id: `${spaceId}-${order}`, spaceId, title: `L${order}`, order, state: 'published',
    progress: 'not-started', percentComplete: 0,
    material: { uploadedAt: `2026-10-0${order}T10:00:00Z` }, ...over,
  }) as Lesson;

const world = (over: Partial<World>): World =>
  emptyWorld({
    spaces: [space('dbs')],
    lessons: [lesson('dbs', 1), lesson('dbs', 2), lesson('dbs', 3)],
    streakDays: 9, // the stored counter: Home must not read it
    record: {
      // Three days in a row, then a gap: the run is 3.
      studyDays: ['2026-10-11', '2026-10-10', '2026-10-09', '2026-10-07'].map((date) => ({ date, summary: '' })),
      xpEvents: [],
      moments: [],
    },
    ...over,
  });

describe('Home from the live world', () => {
  it('a brand-new account is onboarded, with no fake next action', () => {
    const home = homeFromWorld(world({}));
    expect(home.kind).toBe('onboard');
    expect(home.next).toBeNull();
    expect(home.feed).toEqual([]);
  });

  it('continues the most recent unfinished Lesson, then offers the one after it', () => {
    const home = homeFromWorld(world({
      lessons: [
        lesson('dbs', 1, { progress: 'done', percentComplete: 100 }),
        lesson('dbs', 2, { progress: 'in-progress', percentComplete: 40 }),
        lesson('dbs', 3),
      ],
      activity: [
        { lessonId: 'dbs-1', at: '2026-10-11T09:00:00Z' },
        { lessonId: 'dbs-2', at: '2026-10-10T09:00:00Z' },
      ],
    }));
    expect(home.kind).toBe('resume');
    expect(home.next).toMatchObject({ lessonId: 'dbs-2', reason: 'continue', percentComplete: 40 });
    expect(home.feed.map((i) => [i.lessonId, i.reason])).toEqual([['dbs-3', 'next']]);
    expect(home.recent.map((r) => r.lessonId)).toEqual(['dbs-1']); // never the next action twice
    expect(home.streakDays).toBe(3);
  });

  it('surfaces Lessons uploaded since the last visit, newest first, without repeats', () => {
    const home = homeFromWorld(world({
      spaces: [space('dbs', { newSinceLastVisit: 2 })],
      lessons: [lesson('dbs', 1, { progress: 'in-progress' }), lesson('dbs', 2), lesson('dbs', 3)],
      activity: [{ lessonId: 'dbs-1', at: '2026-10-11T09:00:00Z' }],
    }));
    expect(home.feed.map((i) => [i.lessonId, i.reason])).toEqual([
      ['dbs-2', 'next'],
      ['dbs-3', 'new'],
    ]);
  });

  it('everything done is a celebration, not an empty up-next', () => {
    const done = { progress: 'done', percentComplete: 100 } as const;
    const home = homeFromWorld(world({
      lessons: [lesson('dbs', 1, done), lesson('dbs', 2, done)],
      activity: [{ lessonId: 'dbs-2', at: '2026-10-11T09:00:00Z' }],
    }));
    expect(home.kind).toBe('review');
  });

  it('ignores activity in Spaces you have left', () => {
    const home = homeFromWorld(world({
      spaces: [space('dbs', { viewerRole: null })],
      activity: [{ lessonId: 'dbs-1', at: '2026-10-11T09:00:00Z' }],
    }));
    expect(home.kind).toBe('onboard');
  });
});
