import { afterEach, describe, expect, it, vi } from 'vitest';

const { answerMock } = vi.hoisted(() => ({ answerMock: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('../data/liveRepository', async (orig) => ({
  ...(await orig<typeof import('../data/liveRepository')>()),
  loadLiveRepository: async () => ({ answerFriendRequest: answerMock }),
}));

import * as social from '../data/social';
import { leaderboard as fixtureLeaderboard } from '../mocks/library';
import { rankLabel } from '../mocks/rank';
import { setLiveWorld } from '../data/world';
import { emptyWorld } from './emptyWorld';

const ana = { id: 'a', name: 'Ana', avatarUrl: null };
const ben = { id: 'b', name: 'Ben', avatarUrl: null };

afterEach(() => {
  setLiveWorld(null);
  answerMock.mockClear();
});

describe('Social, live', () => {
  it('demo is the fixture race', () => {
    expect(social.leaderboardNow()).toBe(fixtureLeaderboard);
  });

  it('the race is real people with ranks derived from their XP', () => {
    setLiveWorld(emptyWorld({
      social: {
        leaderboard: [
          { person: ana, xp: 900, sharedSpaces: 2, isViewer: false },
          { person: { id: 'u', name: 'Lea', avatarUrl: null }, xp: 40, sharedSpaces: 3, isViewer: true },
        ],
        friends: [], requests: [], sharedSpaceIds: {},
      },
    }));
    const race = social.leaderboardNow();
    expect(race.map((r) => [r.person.name, r.rank])).toEqual([['Ana', rankLabel(900)], ['Lea', rankLabel(40)]]);
    expect(race.filter((r) => r.isViewer)).toHaveLength(1);
  });

  it('accepting moves a request to friends at once and tells the server', async () => {
    setLiveWorld(emptyWorld({
      social: { leaderboard: [], friends: [ana], requests: [{ person: ben, sharedSpaces: 1 }], sharedSpaceIds: {} },
    }));
    social.acceptRequest('b');
    expect(social.currentRequests()).toEqual([]);
    expect(social.currentFriends().map((f) => f.id)).toEqual(['a', 'b']);
    expect(social.isFriend('b')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(answerMock).toHaveBeenCalledWith('b', 'accept');
  });
});
