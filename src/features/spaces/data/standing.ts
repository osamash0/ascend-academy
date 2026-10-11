import { viewerStanding } from '../mocks/library';
import { rankLabel } from '../mocks/rank';
import { liveWorld } from './world';

/**
 * The viewer's XP and rank, now.
 *
 * Demo: the fixture leaderboard's viewer row. Live: the XP ledger's total, put
 * through the same rank curve, so a rank is never stated separately from the
 * XP it is derived from. A plain function rather than a hook so a component's
 * prop defaults can read it.
 */
export function standingNow(): { xp: number; rank: string } {
  const world = liveWorld();
  if (!world) {
    const s = viewerStanding();
    return { xp: s.xp, rank: s.rank };
  }
  return { xp: world.xp, rank: rankLabel(world.xp) };
}
