import { people } from '../mocks/people';
import {
  linalgContributions,
  normalizationContributions,
  sharedSpaceIds,
  spaceContributions,
} from '../mocks/contributions';
import { conceptContributions } from '../mocks/concepts';
import { visibleContributions } from '../mocks/engagement';
import type { Contribution, Person } from '../types';
import { leaderboardNow, type RankedPerson } from './social';
import { liveWorld } from './world';

/**
 * Other people, as a person's page needs them.
 *
 * Demo: the fixture cast. Live: the people the viewer can actually meet — in
 * their race, their friends, their requests — so a profile is never reachable
 * for someone the viewer has no connection to.
 */

export const personNow = (id: string): Person | undefined => {
  const world = liveWorld();
  if (!world) return people.find((p) => p.id === id);
  const s = world.social;
  return (
    s.leaderboard.find((r) => r.person.id === id)?.person ??
    s.friends.find((f) => f.id === id) ??
    s.requests.find((r) => r.person.id === id)?.person
  );
};

export const standingOfNow = (id: string): RankedPerson | undefined =>
  leaderboardNow().find((r) => r.person.id === id);

/** The Spaces the viewer and this person are both in, by id. */
export const sharedSpaceIdsNow = (viewerId: string, personId: string): string[] => {
  const world = liveWorld();
  return world ? (world.social.sharedSpaceIds[personId] ?? []) : sharedSpaceIds(viewerId, personId);
};

/**
 * What this person has published, as anyone may see it. Live: nothing yet —
 * contributions have no table.
 */
export const publishedByNow = (personId: string): Contribution[] => {
  if (liveWorld()) return [];
  return visibleContributions(
    [
      ...normalizationContributions,
      ...spaceContributions,
      ...linalgContributions,
      ...conceptContributions,
    ].filter((c) => c.author.id === personId),
    null,
  );
};
