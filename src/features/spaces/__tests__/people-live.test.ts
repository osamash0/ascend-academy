import { afterEach, describe, expect, it } from 'vitest';
import * as people from '../data/people';
import { people as cast } from '../mocks/people';
import { setLiveWorld } from '../data/world';
import { emptyWorld } from './emptyWorld';

const ana = { id: 'a', name: 'Ana', avatarUrl: null };

afterEach(() => setLiveWorld(null));

describe('people, live', () => {
  it('demo is the fixture cast', () => {
    expect(people.personNow(cast[1].id)).toBe(cast[1]);
  });

  it('a person you can meet is found; a stranger is not', () => {
    setLiveWorld(emptyWorld({
      social: {
        leaderboard: [{ person: ana, xp: 120, sharedSpaces: 1, isViewer: false }],
        friends: [], requests: [], sharedSpaceIds: { a: ['c-dbs'] },
      },
    }));
    expect(people.personNow('a')).toEqual(ana);
    expect(people.personNow(cast[1].id)).toBeUndefined();
    expect(people.standingOfNow('a')?.xp).toBe(120);
    expect(people.sharedSpaceIdsNow('u', 'a')).toEqual(['c-dbs']);
    expect(people.publishedByNow('a')).toEqual([]);
  });
});
