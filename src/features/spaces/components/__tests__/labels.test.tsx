import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One phrase, one altitude.
 *
 * Home reads a single label map at two very different sizes: the hero cell, and
 * every row in "Also waiting". That was fine until one entry was written for
 * the hero and reused as a row label — `continue` read "Pick up where you left
 * off", so the hero said it about `Basics` while a row said it about
 * `Differential Cryptanalysis`. Two items, one sentence, both true.
 *
 * Worth being precise about why the obvious fix was wrong: the hero's Lesson
 * (`s-dbs/2`) was never in `homeFeed` at all, so there was no duplicate item to
 * filter — `recentlyViewed()`'s `.filter(r => r.lessonId !== nextAction.lessonId)`
 * has no analogue here. And a person really can be part-way through two
 * Lessons, so dropping one would have hidden real work to tidy up copy.
 *
 * The rule that came out of it: **a row names a state, the hero gives an
 * instruction.** "Up next", "Due for review" and "New since you were here" all
 * name a state; only `continue` had drifted into the imperative, which is
 * exactly the voice the hero wants and a list does not. So the map keeps
 * states, and `HERO_LABEL` carries the one instruction.
 *
 * Source-level, like `modes.test.tsx` — the assertion is about which strings a
 * file declares, and rendering Home would need its whole data layer to check a
 * property of two object literals.
 */

const SRC = join(process.cwd(), 'src/features/spaces');
const HOME = 'screens/HomeScreen.tsx';

const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

/**
 * The string values of a top-level `const <name> ... = { ... }` object.
 *
 * Brace-matched rather than a regex to the first `}`: these literals sit under
 * doc comments that themselves contain braces and quotes, and a lazy match ends
 * the object early and silently reports fewer labels than exist — which would
 * make this test pass by seeing nothing.
 */
const labelsOf = (body: string, name: string): Record<string, string> => {
  const start = body.indexOf(`const ${name}`);
  if (start === -1) throw new Error(`${name} not found in ${HOME}`);
  const open = body.indexOf('{', body.indexOf('=', start));
  let depth = 0;
  let end = -1;
  for (let i = open; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const literal = body.slice(open + 1, end);
  const out: Record<string, string> = {};
  for (const m of literal.matchAll(/(\w+)\s*:\s*'((?:[^'\\]|\\.)*)'/g)) {
    out[m[1]] = m[2];
  }
  return out;
};

describe('Home never says the same thing at two altitudes', () => {
  const home = read(HOME);
  const rows = labelsOf(home, 'REASON_LABEL');
  const hero = labelsOf(home, 'HERO_LABEL');

  it('reads both maps', () => {
    // Guards the parser above: if brace matching broke, these go empty and
    // every assertion below would pass vacuously.
    expect(Object.keys(rows).sort()).toEqual(['continue', 'new', 'next', 'review']);
    expect(Object.keys(hero).length).toBeGreaterThan(0);
  });

  it('never gives the hero and a row the same phrase', () => {
    const shared = Object.values(hero).filter((phrase) =>
      Object.values(rows).includes(phrase),
    );
    expect(
      shared,
      `these phrases would appear on the hero and on a row at once:\n${shared.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps the hero override to the reasons that actually differ', () => {
    // An entry equal to its row label is a second place stating one fact, which
    // is the §A failure this screen has already had once.
    const redundant = Object.entries(hero)
      .filter(([reason, phrase]) => rows[reason] === phrase)
      .map(([reason]) => reason);
    expect(
      redundant,
      `HERO_LABEL restates REASON_LABEL for: ${redundant.join(', ')}`,
    ).toEqual([]);
  });

  it('leaves the instruction to the hero and the state to the rows', () => {
    // "Pick up …" is the imperative. It belongs to the hero and nowhere else.
    expect(Object.values(hero)).toContain('Pick up where you left off');
    expect(Object.values(rows)).not.toContain('Pick up where you left off');
  });

  it('uses the hero map at the hero, not the row map', () => {
    // The defect was the call site, not the strings: one map read twice.
    expect(/label=\{heroLabel\(next\.reason\)\}/.test(home)).toBe(true);
    expect(
      /label=\{REASON_LABEL\[next\.reason\]\}/.test(home),
      'the hero is reading the row labels again',
    ).toBe(false);
  });
});
