import { viewer } from './people';

/**
 * Rank, and where XP came from.
 *
 * Doc 1, Engagement rule 4 is the whole constraint: **"Ranks and the Ascent
 * profile read from XP only. Likes and stars are content signals; they don't
 * have a second progression bolted on."** So there is one number here, and
 * everything else on the Rank screen is an explanation of it.
 *
 * ## Why this file exists
 *
 * The viewer's rank was stated in three places that could disagree:
 *
 *   1. `leaderboard` in `mocks/library.ts` — a hardcoded `rank: 'Rank 1'`
 *      string next to each person's XP.
 *   2. `ProfileScreen` — `const xp = 60; const rank = 1;`, two literals that
 *      never read the leaderboard at all.
 *   3. `XP_IN_RANK = 250` in the same screen, used for the progress bar.
 *
 * They agreed for the viewer and for nobody else. At 250 XP a rank, Keller's
 * 12,480 XP is Rank 50; the fixture said Rank 9. The viewer matched only by
 * coincidence — 60 XP lands in Rank 1 under any curve that starts above 60.
 * That is the same shape as the orphan's `?? 's-dbs'` Space: correct-looking
 * because one arbitrary case happened to line up.
 *
 * `library.ts` already carries a comment saying this exact bug was fixed for
 * the top bar. It was fixed in one of the three places.
 */

/**
 * Each rank costs 25% more XP than the one before, and the first costs 250.
 *
 * **This curve is an assumption, not a locked decision.** Doc 1 defers "what
 * publishing a Lesson earns" and the rest of the numbers to a Gamification doc
 * that does not exist yet, so the shape is mine: it needs to be steep enough
 * that Rank 12 means something and shallow enough that Rank 2 arrives while
 * you still care. Written as two named constants so that when that doc lands
 * the curve is one edit and every screen follows.
 */
const FIRST_RANK_COST = 250;
const RANK_GROWTH = 1.25;

/** Total XP required to *reach* rank `n`. Rank 1 starts at zero. */
export const xpForRank = (n: number): number =>
  n <= 1
    ? 0
    : Math.round((FIRST_RANK_COST * (RANK_GROWTH ** (n - 1) - 1)) / (RANK_GROWTH - 1));

export interface Standing {
  /** The rank this XP total has reached. */
  rank: number;
  /** XP earned since reaching the current rank. */
  into: number;
  /** XP the current rank spans end to end. */
  span: number;
  /** XP still to go before the next rank. */
  toNext: number;
  /** How far through the current rank, 0–100. */
  pct: number;
}

/**
 * The one rank calculation.
 *
 * Iterative rather than a closed-form logarithm because the inverse of the
 * geometric sum lands on rank boundaries by floating point — `xpForRank(9)` XP
 * exactly would sometimes resolve to Rank 8. Ranks are small integers and this
 * runs a handful of times per render.
 */
export const standingFor = (xp: number): Standing => {
  let rank = 1;
  while (xp >= xpForRank(rank + 1)) rank += 1;
  const floor = xpForRank(rank);
  const ceiling = xpForRank(rank + 1);
  const span = ceiling - floor;
  const into = xp - floor;
  return { rank, into, span, toNext: ceiling - xp, pct: Math.round((into / span) * 100) };
};

/** `Rank 4` — the label, so no screen writes the word itself. */
export const rankLabel = (xp: number) => `Rank ${standingFor(xp).rank}`;

/**
 * Where a single piece of XP came from.
 *
 * The five sources are Doc 1's, not invented: XP is earned "from learning *and*
 * from contributions that get liked, endorsed, or used", plus "one milestone
 * bonus … for the *first contribution in your account's history*".
 */
export type XpSource = 'learning' | 'liked' | 'endorsed' | 'used' | 'milestone';

export interface XpEvent {
  id: string;
  source: XpSource;
  /** What happened, in the person's own terms. */
  label: string;
  /** Where it happened. `null` for account-wide events like the milestone. */
  spaceName: string | null;
  amount: number;
  at: string;
}

/**
 * The viewer's XP, itemised.
 *
 * Every one of the five sources appears at least once, deliberately. A source
 * with no fixture is a render path that never executes — the reason the orphan
 * copy, the warning border and the "Needs a new home" pill sat unexercised for
 * so long, and the reason a guard over them iterated an empty array and passed.
 *
 * The amounts vary rather than implying a fixed rate per like. What XP a like
 * is worth is a Gamification-doc number nobody has decided, and inventing a
 * constant here would put a made-up rule in front of people.
 */
/*
 * The dates are not decoration — Moments reads firsts off them.
 *
 * Three were wrong when written. Both learning events sat on June days the
 * study record does not contain; the milestone claimed 14 June while the
 * viewer's earliest contribution is dated 2 June; and "Mnemonic for the normal
 * forms" was liked on 21 July, nine days before the contribution was created.
 * All four only became visible once a screen derived an ordering from them —
 * a ledger nobody sorts can hold any dates at all.
 */
export const xpEvents: XpEvent[] = [
  {
    id: 'xp-1',
    source: 'learning',
    label: 'Finished “Vectors and Matrices”',
    spaceName: 'Intro to Linear Algebra',
    amount: 10,
    at: '2026-08-12T10:00:00Z',
  },
  {
    id: 'xp-2',
    source: 'learning',
    label: 'Finished “Orthogonality and Projections”',
    spaceName: 'Intro to Linear Algebra',
    amount: 10,
    at: '2026-08-17T16:30:00Z',
  },
  {
    id: 'xp-3',
    source: 'milestone',
    label: 'Your first contribution — once, ever',
    spaceName: null,
    amount: 20,
    at: '2026-06-02T09:00:00Z',
  },
  {
    id: 'xp-4',
    source: 'liked',
    label: '“Mnemonic for the normal forms” was liked',
    spaceName: 'Database Systems',
    amount: 6,
    at: '2026-08-02T12:00:00Z',
  },
  {
    id: 'xp-5',
    source: 'endorsed',
    label: 'An Owner endorsed “Mnemonic for the normal forms”',
    spaceName: 'Database Systems',
    amount: 8,
    at: '2026-08-06T12:00:00Z',
  },
  {
    id: 'xp-6',
    source: 'used',
    label: 'Someone completed your practice set',
    spaceName: 'Database Systems',
    amount: 6,
    at: '2026-08-11T18:40:00Z',
  },
];

/**
 * The viewer's XP total — **derived**, so the ledger and the leaderboard
 * cannot drift into two answers.
 *
 * This is the direction that matters: the itemised list is the truth and the
 * total is computed from it. The other way round, a screen could show six
 * events adding to 54 under a headline reading 60, and nothing would fail.
 */
export const viewerXp = (): number => xpEvents.reduce((n, e) => n + e.amount, 0);

/** XP by source, largest first — the shape the Rank screen groups by. */
export const xpBySource = (): { source: XpSource; total: number; count: number }[] => {
  const totals = new Map<XpSource, { total: number; count: number }>();
  for (const e of xpEvents) {
    const cur = totals.get(e.source) ?? { total: 0, count: 0 };
    totals.set(e.source, { total: cur.total + e.amount, count: cur.count + 1 });
  }
  return [...totals.entries()]
    .map(([source, v]) => ({ source, ...v }))
    .sort((a, b) => b.total - a.total);
};

/** Used by the leaderboard so the viewer's row cannot state its own number. */
export const viewerId = viewer.id;
