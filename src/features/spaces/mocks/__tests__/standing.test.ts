import { describe, expect, it } from 'vitest';
import { leaderboard, viewerStanding } from '../library';
import { viewer } from '../people';

/**
 * The viewer's rank and XP have exactly one source.
 *
 * Written after finding the top bar carrying `rank = 'Rank 1', xp = 60` as prop
 * defaults while the Social leaderboard stated the same two numbers
 * independently. Nothing was wrong on screen — but editing either one would
 * have made the bar and Social disagree, and both would have looked right.
 */

describe('the viewer has one standing', () => {
  it('the leaderboard carries a viewer row', () => {
    expect(viewerStanding().person.id).toBe(viewer.id);
  });

  it('only one row is flagged as the viewer', () => {
    expect(leaderboard.filter((r) => r.isViewer)).toHaveLength(1);
  });

  it('is ordered by XP, because Doc 1 says rankings read XP only', () => {
    const xps = leaderboard.map((r) => r.xp);
    expect([...xps].sort((a, b) => b - a)).toEqual(xps);
  });

  it('never ranks on likes or stars', () => {
    // Likes and stars are content signals. A second progression bolted onto
    // them is the thing Doc 1 rules out, so the shape must not carry one.
    for (const row of leaderboard) {
      expect(row).not.toHaveProperty('likeCount');
      expect(row).not.toHaveProperty('starCount');
    }
  });
});
