import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { firstContributionAt, moments } from '../moments';
import { libraryItems } from '../library';
import { xpEvents } from '../rank';
import { studyDays, TODAY } from '../history';

const SRC = join(process.cwd(), 'src/features/spaces');
const strip = (p: string) =>
  readFileSync(join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('a record, not an achievement set', () => {
  /*
   * Abi's decision, held in place. The badge wall broke three locked rules at
   * once — the word, the score, and two of the six criteria — and the value of
   * writing that down is that the next person to add "just one badge" has to
   * argue with a failing test rather than with a comment.
   */

  it('shows no total, because a total implies the rest are owed', () => {
    /*
     * `3/6` on the Ascent profile is precisely what Doc 1 rule 4 excludes:
     * "Ranks and the Ascent profile read from XP only … they don't have a
     * second progression bolted on." A thing you can be behind on is a
     * currency, whatever it is called.
     */
    const screen = strip('screens/MomentsScreen.tsx');
    expect(screen, 'the screen counts moments out of a total').not.toMatch(
      /\{\s*\w+\.length\s*\}\s*\/|\/\s*\{\s*\w+\.length\s*\}/,
    );
    const profile = strip('screens/ProfileScreen.tsx');
    expect(profile, 'Profile shows a completion score again').not.toMatch(
      /earned\.length|\/\{badges\.length\}/,
    );
  });

  it('dangles nothing unearned', () => {
    /*
     * The retired set padlocked "Get 25 likes on your work" — an instruction
     * to go and farm likes, which is the behaviour rule 3's anti-farming
     * clauses exist to suppress. A moment has already happened or is absent;
     * there is no third state.
     */
    const screen = strip('screens/MomentsScreen.tsx');
    expect(screen).not.toMatch(/earned|locked|Lock\b|unlock/i);
    for (const m of moments()) {
      expect(Object.keys(m), `${m.id} carries an earned flag`).not.toContain('earned');
    }
  });

  it('keeps the achievement fixture retired', () => {
    // The whole point of the rename is that it does not quietly come back
    // under the old shape in a new file.
    for (const f of readdirSync(join(SRC, 'mocks')).filter((f) => f.endsWith('.ts'))) {
      expect(strip(`mocks/${f}`), `mocks/${f} defines achievements again`).not.toMatch(
        /earned:\s*(true|false)/,
      );
    }
  });

  it('leaves "badge" meaning exactly one thing', () => {
    /*
     * Doc 1 rule 7, and the docs' own note: "badge must mean exactly one
     * thing. Otherwise remove." Every `Badge` in the codebase must now be a
     * label on content — Origin, Mode, Visibility, Endorsed — which is what
     * `components/badges.tsx` always meant.
     */
    const CONTENT_BADGES = /Origin|Mode|Visibility|Endorsed/;
    for (const dir of ['mocks', 'screens'] as const) {
      for (const f of readdirSync(join(SRC, dir))) {
        if (!f.endsWith('.ts') && !f.endsWith('.tsx')) continue;
        const body = strip(`${dir}/${f}`);
        for (const m of body.matchAll(/(\w*)Badge\b/g)) {
          expect(
            CONTENT_BADGES.test(m[1]) || m[1] === '',
            `${dir}/${f} uses "${m[0]}" for something that is not a content label`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('every moment is derived', () => {
  it('never invents a date it does not have', () => {
    /*
     * Spaces carry no creation date, so "You made a Space" has none. Left null
     * and rendered without one — the orphan row's fabricated `'s-dbs'` is the
     * reason this is a rule and not a preference.
     */
    const undated = moments().filter((m) => m.at === null);
    expect(undated.length, 'no undated moment — this guard would be vacuous').toBeGreaterThan(0);
    for (const m of undated) {
      expect(m.detail.trim().length, m.id).toBeGreaterThan(0);
    }
  });

  it('puts undated moments last rather than guessing a place', () => {
    const order = moments();
    const firstUndated = order.findIndex((m) => m.at === null);
    if (firstUndated === -1) return;
    for (const m of order.slice(firstUndated)) {
      expect(m.at, 'a dated moment sorts after an undated one').toBeNull();
    }
  });

  it('reads the first contribution off the contribution, not the ledger', () => {
    /*
     * These disagreed. The ledger's milestone claimed 14 June while the
     * earliest contribution is dated 2 June — two statements of one fact, and
     * only visible once something sorted them.
     */
    const contributions = libraryItems
      .filter((i) => i.kind === 'contribution')
      .map((i) => i.updatedAt)
      .sort();
    expect(firstContributionAt()).toBe(contributions[0]);

    const milestone = xpEvents.find((e) => e.source === 'milestone');
    expect(milestone, 'no milestone event').toBeDefined();
    expect(
      milestone!.at.slice(0, 10),
      'the milestone is dated differently from the contribution it marks',
    ).toBe(firstContributionAt()!.slice(0, 10));
  });

  it('dates every learning event to a day the record actually holds', () => {
    /*
     * Both learning events originally sat in June, on days `studyDays` does
     * not contain — the ledger and the study record describing the same two
     * Lessons a couple of months apart.
     */
    const days = new Set(studyDays.map((d) => d.date));
    for (const e of xpEvents.filter((e) => e.source === 'learning')) {
      expect(days.has(e.at.slice(0, 10)), `${e.label} falls on a day never studied`).toBe(true);
    }
  });

  it('never records something before the thing it happened to', () => {
    /*
     * Matched to the contribution each event **names**, not to the earliest
     * one. The loose version compared against `firstContributionAt()` and so
     * passed a ledger that had "Mnemonic for the normal forms" liked on 2
     * August against a contribution created on the 28th — twenty-six days
     * before it was written — because 2 August was still after the *first*
     * contribution. It caught nothing it was written to catch.
     */
    const createdAt = new Map(
      libraryItems
        .filter((i) => i.kind === 'contribution')
        .map((i) => [i.title, i.updatedAt] as const),
    );

    let checked = 0;
    for (const e of xpEvents) {
      const quoted = e.label.match(/“([^”]+)”/)?.[1];
      if (!quoted) continue;
      const born = createdAt.get(quoted);
      if (!born) continue;
      checked += 1;
      expect(e.at >= born, `“${quoted}” earned XP on ${e.at.slice(0, 10)}, before it existed on ${born.slice(0, 10)}`).toBe(true);
    }
    expect(checked, 'no event names a contribution — this guard would be vacuous').toBeGreaterThan(0);

    // And nothing engagement-related predates the first contribution at all.
    const earliest = firstContributionAt()!;
    for (const e of xpEvents.filter((e) => e.source !== 'learning')) {
      expect(e.at >= earliest, `${e.label} predates your first contribution`).toBe(true);
    }
  });

  it('puts the first Lesson before the first contribution', () => {
    /*
     * Abi's call: learning comes first. It did not — the orphan contribution
     * was dated 2 June against a first Lesson on 12 August, so the very first
     * thing that ever happened to this account was publishing.
     *
     * Asserted on the rendered order rather than on the fixtures, because that
     * is what somebody reads.
     */
    const order = moments().map((m) => m.id);
    expect(order.indexOf('m-lesson')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('m-contribution')).toBeGreaterThan(order.indexOf('m-lesson'));
  });

  it('gives every finished Lesson the XP that finishing one earns', () => {
    /*
     * Five study days begin "Finished" and only two earned XP, in a product
     * whose first rule about XP is that learning earns it. Three Lessons were
     * finished for nothing.
     */
    const finished = studyDays.filter((d) => d.summary.startsWith('Finished')).map((d) => d.date);
    const learningDays = new Set(
      xpEvents.filter((e) => e.source === 'learning').map((e) => e.at.slice(0, 10)),
    );
    for (const d of finished) {
      expect(learningDays.has(d), `a Lesson was finished on ${d} and earned nothing`).toBe(true);
    }
  });

  it('records nothing after the day the fixtures are anchored to', () => {
    for (const m of moments()) {
      if (m.at === null) continue;
      expect(m.at.slice(0, 10) <= TODAY, `${m.id} is in the future`).toBe(true);
    }
  });

  it('names the thing that happened, not just the category', () => {
    // "Your first contribution" without the title is a headline with no fact
    // under it. Every moment quotes the real object.
    for (const m of moments()) {
      expect(m.title.trim().length, m.id).toBeGreaterThan(0);
      expect(m.detail.trim().length, m.id).toBeGreaterThan(3);
      /*
       * A full stop, not "a full stop or a quote mark". Written the loose way
       * first, it passed `You finished “Vectors and Matrices”` — a sentence
       * with no end, because the closing quote satisfied the character class.
       */
      expect(m.detail, `${m.id} ends mid-sentence`).toMatch(/\.$/);
    }
  });
});
