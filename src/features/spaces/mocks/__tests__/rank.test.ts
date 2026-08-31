import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { leaderboard, viewerStanding } from '../library';
import { standingFor, viewerXp, xpBySource, xpEvents, xpForRank, rankLabel } from '../rank';

/**
 * Rank reads from XP only, and from one place.
 *
 * Doc 1, Engagement rule 4: "Ranks and the Ascent profile read from XP only.
 * Likes and stars are content signals; they don't have a second progression
 * bolted on."
 */

describe('one rank, one source', () => {
  it('states a rank nowhere but the curve', () => {
    /*
     * The defect this file exists for. Every leaderboard row used to carry a
     * hand-written `rank: 'Rank 9'` beside its XP, `ProfileScreen` held
     * `const xp = 60; const rank = 1;`, and a local `XP_IN_RANK = 250` drove
     * the progress bar on a fourth curve. They agreed for the viewer and for
     * nobody else: at 250 XP a rank, Keller's 12,480 XP is Rank 50.
     *
     * A hand-written label agrees with any curve, which is why nothing caught
     * it. Asserting the *absence* of literals is the only form this check can
     * take — a value test would just compare one hardcoded number to another.
     */
    const strip = (p: string) =>
      readFileSync(join(process.cwd(), 'src/features/spaces', p), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    for (const f of ['mocks/library.ts', 'screens/ProfileScreen.tsx', 'screens/RankScreen.tsx']) {
      expect(strip(f), `${f} writes a rank literal instead of deriving one`).not.toMatch(
        /['"]Rank \d/,
      );
    }
    // And the old per-rank constant is not back under another name.
    expect(strip('screens/ProfileScreen.tsx')).not.toMatch(/XP_IN_RANK/);
  });

  it('gives every leaderboard row a rank derived from its XP', () => {
    for (const r of leaderboard) {
      expect(r.rank, `${r.person.name}`).toBe(rankLabel(r.xp));
    }
  });

  it('orders rank by XP, so the board cannot contradict itself', () => {
    // Sorted by XP descending; ranks must be non-increasing down the list.
    const ranks = leaderboard.map((r) => standingFor(r.xp).rank);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
  });
});

describe('the curve', () => {
  it('starts at zero and never goes backwards', () => {
    let prev = -1;
    for (let n = 1; n <= 30; n += 1) {
      const at = xpForRank(n);
      expect(at, `Rank ${n} costs less than Rank ${n - 1}`).toBeGreaterThan(prev);
      prev = at;
    }
    expect(xpForRank(1)).toBe(0);
  });

  it('puts each XP total in the rank whose band contains it', () => {
    /*
     * The boundary cases, because the iterative search was written to avoid a
     * closed-form logarithm landing on the wrong side of one. Exactly
     * `xpForRank(n)` must be Rank n, and one XP short must be Rank n-1.
     */
    for (let n = 2; n <= 12; n += 1) {
      expect(standingFor(xpForRank(n)).rank, `exactly at Rank ${n}`).toBe(n);
      expect(standingFor(xpForRank(n) - 1).rank, `one short of Rank ${n}`).toBe(n - 1);
    }
  });

  it('never reports being more than a rank through a rank', () => {
    for (const xp of [0, 1, 60, 249, 250, 900, 3020, 12480]) {
      const s = standingFor(xp);
      expect(s.pct, `${xp} XP`).toBeGreaterThanOrEqual(0);
      expect(s.pct, `${xp} XP`).toBeLessThanOrEqual(100);
      expect(s.into + s.toNext, `${xp} XP`).toBe(s.span);
    }
  });
});

describe('the ledger adds up', () => {
  it('is the source of the viewer XP, not a second opinion', () => {
    /*
     * The direction matters: the itemised list is the truth and the total is
     * computed from it. The other way round, the screen could itemise 54 XP
     * under a headline reading 60 and nothing would fail.
     *
     * Written first as `expect(viewerXp()).toBe(xpEvents.reduce(...))`, which
     * could not fail: `viewerXp` *is* that reduction, so it compared a
     * function to its own definition. Changing an event's amount moved both
     * sides together and the test stayed green.
     *
     * The invariant is real but it is now structural, not behavioural — the
     * total is derived, so it cannot disagree. What can still regress is
     * somebody putting the literal back, so that is what this checks.
     */
    const lib = readFileSync(
      join(process.cwd(), 'src/features/spaces/mocks/library.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(lib, 'the viewer row states its own XP again').toMatch(/xp: viewerXp\(\)/);
    expect(viewerStanding().xp).toBe(viewerXp());

    /*
     * This one does have teeth: `xpBySource` groups and re-totals, so a bug
     * that overwrote instead of accumulating — or dropped a source — would
     * make the parts disagree with the whole while every amount stayed right.
     */
    expect(xpBySource().reduce((n, s) => n + s.total, 0)).toBe(viewerXp());
    expect(xpBySource().reduce((n, s) => n + s.count, 0)).toBe(xpEvents.length);
  });

  it('exercises every source, so no branch of the screen is dead', () => {
    /*
     * Five sources, five render paths — icon, label and meaning per source. A
     * source with no fixture is a path that never executes, which is how the
     * orphan copy and the "Needs a new home" pill sat unexercised while a
     * guard over them iterated an empty array and passed.
     */
    const sources = new Set(xpEvents.map((e) => e.source));
    for (const s of ['learning', 'liked', 'endorsed', 'used', 'milestone']) {
      expect(sources.has(s as never), `no fixture earns XP by being ${s}`).toBe(true);
    }
  });

  it('awards the lifetime milestone exactly once', () => {
    // Doc 1: "the *first contribution in your account's history* — crossing
    // the creator threshold, once, ever." Per-Space bonuses were rejected by
    // name, so more than one of these is the rejected design reappearing.
    expect(xpEvents.filter((e) => e.source === 'milestone')).toHaveLength(1);
  });

  it('names no Space it does not have', () => {
    // Account-wide events have no Space. The orphan row's `?? 's-dbs'` is the
    // failure this forecloses: a fabricated context stated as fact.
    for (const e of xpEvents) {
      if (e.spaceName === null) continue;
      expect(e.spaceName.trim().length, e.label).toBeGreaterThan(0);
    }
    expect(xpEvents.some((e) => e.spaceName === null), 'no account-wide event').toBe(true);
  });

  it('never grants XP for publishing alone', () => {
    /*
     * Doc 1 rule 2: XP is granted "only when a contribution is liked,
     * endorsed, or used — never per post". A fixture rewarding the act of
     * posting would put the rejected design on screen as if it shipped.
     */
    for (const e of xpEvents) {
      expect(e.label.toLowerCase(), `${e.label} reads as a reward for posting`).not.toMatch(
        /^(published|posted|shared)\b/,
      );
    }
  });
});

describe('no second progression', () => {
  it('keeps likes and stars off the Rank screen', () => {
    /*
     * Rule 4, checked against the screen rather than trusted. A like count
     * here would be a second scoreboard beside XP — and Doc 1 rule 7 spells
     * out the consequence: "there is no star currency in the Ascent profile".
     *
     * The `Heart` and `Star` *icons* are allowed and used: Heart marks
     * XP-from-being-liked, Star marks the milestone. What is banned is a
     * count. So this looks for numbers bound to those words, not the words.
     */
    const body = readFileSync(
      join(process.cwd(), 'src/features/spaces/screens/RankScreen.tsx'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(body, 'the Rank screen counts likes').not.toMatch(/likeCount|\.likes\b/);
    expect(body, 'the Rank screen counts stars').not.toMatch(/starCount|\.stars\b/);
  });
});
