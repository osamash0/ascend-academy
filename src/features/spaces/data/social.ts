import * as fixtures from '../mocks/social';
import { leaderboard as fixtureLeaderboard, type FriendRequest, type RankedPerson } from '../mocks/library';
import { rankLabel } from '../mocks/rank';
import type { Person } from '../types';
import { loadLiveRepository } from './liveRepository';
import { liveWorld } from './world';

export type { FriendRequest, RankedPerson };

/**
 * Social's data: the fixtures in demo; live, the viewer's real friends,
 * requests addressed to them and a race of real people — friends and
 * classmates, never test or seed accounts — by XP, ranks derived from it.
 */

export const leaderboardNow = (): RankedPerson[] => {
  const world = liveWorld();
  if (!world) return fixtureLeaderboard;
  return world.social.leaderboard.map((r) => ({
    person: r.person,
    xp: r.xp,
    rank: rankLabel(r.xp),
    sharedSpaces: r.sharedSpaces,
    ...(r.isViewer ? { isViewer: true } : {}),
  }));
};

export const currentFriends = (): Person[] => {
  const world = liveWorld();
  return world ? [...world.social.friends] : fixtures.currentFriends();
};

export const currentRequests = (): FriendRequest[] => {
  const world = liveWorld();
  return world ? [...world.social.requests] : fixtures.currentRequests();
};

export const isFriend = (personId: string): boolean => currentFriends().some((f) => f.id === personId);

/** Accept: at once on screen, then on the server. */
export const acceptRequest = (personId: string): void => {
  const world = liveWorld();
  if (!world) return fixtures.acceptRequest(personId);
  const req = world.social.requests.find((r) => r.person.id === personId);
  if (!req) return;
  world.social.requests = world.social.requests.filter((r) => r.person.id !== personId);
  if (!world.social.friends.some((f) => f.id === personId)) world.social.friends.push(req.person);
  void answer(personId, 'accept');
};

export const declineRequest = (personId: string): void => {
  const world = liveWorld();
  if (!world) return fixtures.declineRequest(personId);
  world.social.requests = world.social.requests.filter((r) => r.person.id !== personId);
  void answer(personId, 'decline');
};

/**
 * Whether the people in the viewer's Spaces see them (LS-036): off until they
 * switch it on. The demo has no one to hide from, so it reads as on.
 */
export const showInSpacesNow = (): boolean => {
  const world = liveWorld();
  return world ? world.showInSpaces === true : true;
};

/** Switch it, and say what the server kept. Throws if the change did not save. */
export async function setShowInSpaces(on: boolean): Promise<boolean> {
  const world = liveWorld();
  if (!world) return on;
  const repo = await loadLiveRepository();
  const { showInSpaces } = await repo.setShowInSpaces(on);
  world.showInSpaces = showInSpaces;
  return showInSpaces;
}

function answer(personId: string, verdict: 'accept' | 'decline'): Promise<void> {
  return loadLiveRepository()
    .then((repo) => repo.answerFriendRequest(personId, verdict))
    .then(() => undefined)
    .catch(() => {
      /* The screen already moved on; a lost answer is re-asked next visit. */
    });
}
