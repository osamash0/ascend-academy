import type { World } from '../data/world';

/**
 * A live world with nothing in it — a brand-new account. Tests spread what
 * they need over it, so adding a field to World is one edit here, not one in
 * every test that builds a world by hand.
 */
export const emptyWorld = (over: Partial<World> = {}): World => ({
  viewer: { id: 'u', name: 'Lea', avatarUrl: null },
  spaces: [],
  lessons: [],
  activity: [],
  streakDays: 0,
  xp: 0,
  notifications: [],
  record: { studyDays: [], xpEvents: [], moments: [] },
  social: { leaderboard: [], friends: [], requests: [], sharedSpaceIds: {} },
  ...over,
});
