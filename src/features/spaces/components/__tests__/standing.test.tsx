import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { viewerStanding } from '../../mocks/library';
import { standingFor } from '../../mocks/rank';

/**
 * The viewer's rank is read, never restated.
 *
 * This is the oldest defect in the namespace and it has now been fixed three
 * times in three places, which is why it is worth a guard rather than a fourth
 * fix. `SpacesTopBar` once carried `rank = 'Rank 1', xp = 60` as prop defaults
 * while the leaderboard stated the same two numbers independently; that was
 * resolved by `viewerStanding()`, and `mocks/library.ts` explains it above that
 * function. `HomeScreen` kept its own copy — `RANK`, `XP`, `XP_PER_RANK` as
 * module constants — so the bar at the top of Home and the cell in the middle
 * of Home were two sources for one fact, agreeing only because the literals
 * happened to match the fixture.
 *
 * That is the shape worth naming: not a wrong value, a *second* value. It looks
 * correct on every screen until the fixture moves, and then one of them is
 * silently stale. The same shape as Library's `?? 's-dbs'`, which was right
 * only because the one orphan fixture really did come from Database Systems.
 *
 * The mock this screen was redesigned from has it too, drawn rather than coded:
 * "Lvl 3 · 230 XP" in the bar over "Rank 1 · 60 XP" in the cell. Two numbers
 * for one person, and a vocabulary v4 does not use — Foundations Rule 7 locks
 * progression to XP and Rank.
 */

const SRC = join(process.cwd(), 'src/features/spaces');

const read = (p: string) =>
  readFileSync(join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) ?? []).length))
    .replace(/^(\s*)\/\/.*$/gm, '$1');

const screens = readdirSync(join(SRC, 'screens')).filter((f) => f.endsWith('.tsx'));

describe('one source for the viewer’s standing', () => {
  it('finds the screens', () => {
    expect(screens.length).toBeGreaterThanOrEqual(12);
  });

  it('lets no screen declare its own rank or XP constant', () => {
    /*
     * Comments are stripped first, deliberately: the note in `HomeScreen`
     * *quotes* the constants it removed in order to explain the defect, and a
     * rule that fires on the prose explaining it is a rule people switch off.
     * `modes.test.tsx` learned this, and so did `mock-stability.test.ts`.
     */
    const offenders: string[] = [];
    for (const f of screens) {
      const body = read(`screens/${f}`);
      for (const [i, line] of body.split('\n').entries()) {
        // `const RANK = 'Rank 1'` / `const XP = 60` / `const XP_PER_RANK = 250`
        if (/^\s*const\s+(RANK|XP|XP_PER_RANK)\s*=/.test(line)) {
          offenders.push(`screens/${f}:${i + 1}  ${line.trim()}`);
        }
        // A rank label written out rather than derived from `rankLabel`.
        if (/['"`]Rank \d+['"`]/.test(line)) {
          offenders.push(`screens/${f}:${i + 1}  hardcoded rank label — ${line.trim()}`);
        }
      }
    }
    expect(
      offenders,
      `screens stating progression instead of reading it:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('has Home read the same source the top bar does', () => {
    const home = read('screens/HomeScreen.tsx');
    expect(/viewerStanding\(\)/.test(home), 'Home no longer reads viewerStanding()').toBe(true);
    expect(/standingFor\(/.test(home), 'Home derives its own thresholds again').toBe(true);
  });

  it('agrees with itself: the label, the XP and the gap to the next rank', () => {
    // Not a source check — an arithmetic one. If these ever disagree, the
    // screens are consistent with each other and wrong together.
    const me = viewerStanding();
    const p = standingFor(me.xp);
    expect(me.rank).toBe(`Rank ${p.rank}`);
    expect(p.into + p.toNext).toBe(p.span);
    expect(p.pct).toBe(Math.round((p.into / p.span) * 100));
  });
});
