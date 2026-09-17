import { describe, expect, it } from 'vitest';
import { leaderboard, viewerStanding } from '../library';
import { viewer } from '../people';
import { sharedSpaceIds } from '../contributions';
import { allSpaces } from '../spaces';

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

describe('"Spaces in common" is one number', () => {
  it('agrees with the list it counts, for every person', () => {
    /*
     * Social stated `sharedSpaces` as a literal per row while `PersonScreen`
     * derived the same fact from the member lists — so Social said Chidi
     * shared 1 Space and his profile listed 2, and both looked right. Derived
     * from one source now; this asserts they cannot drift apart again.
     */
    for (const row of leaderboard) {
      if (row.isViewer) continue;
      expect(row.sharedSpaces, `${row.person.name}`).toBe(
        sharedSpaceIds(viewer.id, row.person.id).length,
      );
    }
  });

  it('counts your own row as the Spaces you are in', () => {
    const mine = viewerStanding();
    expect(mine.sharedSpaces).toBe(allSpaces.filter((s) => s.viewerRole !== null).length);
  });

  it('is never a count of nothing for someone on your leaderboard', () => {
    // A person is on your board because you share a Space. Zero would mean
    // the board and the member lists disagree about why they are there.
    for (const row of leaderboard) {
      expect(row.sharedSpaces, `${row.person.name}`).toBeGreaterThan(0);
    }
  });
});
