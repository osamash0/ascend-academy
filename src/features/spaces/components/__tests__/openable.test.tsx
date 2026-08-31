import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A cell that carries a Lesson has to open it.
 *
 * This exists because `deadends.test.tsx` cannot catch the defect it was built
 * for. That file asks whether every `<button>` has a handler — a good question
 * with a blind spot on its left: it can only see controls that are *already*
 * controls. `BentoCell` chooses its own tag from its props:
 *
 *     const Tag = to ? Link : onClick ? 'button' : 'div'
 *
 * so a cell given neither never becomes a control, and walks straight past a
 * test that only inspects buttons. Home's hero did exactly that. It was the
 * widest cell on the landing screen, it said "Pick up where you left off", the
 * file's own comment promised "every cell here opens a Lesson or practice" —
 * and all five cells rendered as `div`s. Inert on click, skipped by Tab, while
 * the smaller rows below it opened fine.
 *
 * Which is CYCLE.md §E: a rule stated in a comment and enforced by memory. The
 * fix is one prop; keeping it fixed is this file.
 *
 * Source-level, like `modes.test.tsx` and for the same reason — the assertion
 * is about *composition*, which props a call site passes. Rendering Home would
 * need its whole data layer and would still miss a second screen that made the
 * same mistake tomorrow.
 */

const SRC = join(process.cwd(), 'src/features/spaces');

const read = (p: string) =>
  readFileSync(join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/**
 * Every `<BentoCell …>` opening tag in a file.
 *
 * Brace-depth aware rather than a regex to the next `>`: `art={<Icon ... />}`
 * and `onClick={() => navigate(...)}` both contain `>` characters, so the naive
 * match ends the tag early and reports a cell as handler-less because it
 * stopped reading before the handler.
 */
const bentoCells = (body: string): string[] => {
  const tags: string[] = [];
  for (let i = body.indexOf('<BentoCell'); i !== -1; i = body.indexOf('<BentoCell', i + 1)) {
    let depth = 0;
    for (let j = i; j < body.length; j++) {
      const c = body[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) {
        tags.push(body.slice(i, j + 1));
        break;
      }
    }
  }
  return tags;
};

/** The label, however it is written — a string or an indexed lookup. */
const labelOf = (tag: string) =>
  tag.match(/label=(?:"([^"]+)"|\{([^}]+)\})/)?.slice(1).find(Boolean) ?? '(no label)';

/**
 * Cells that legitimately carry no Lesson, and so are readouts rather than
 * controls. Deliberately a list of *exact labels*: a new cell is opt-in, so
 * adding one and forgetting the handler fails here instead of shipping inert.
 *
 * Streak and Rank are the honest cases — neither names a Lesson, so there is
 * nothing for a click to open, and inventing a destination for them would be
 * deciding a question the design docs have left open.
 */
const READOUTS: Record<string, string[]> = {
  'screens/HomeScreen.tsx': ['Streak', 'Rank'],
  /*
   * The three on Profile that genuinely have nowhere to go.
   *
   * 'Spaces', 'Published' and 'Likes received' were here too, and they were
   * the wrong kind of exemption: each names a screen that already exists and
   * itemises exactly what it counts — the hub for Spaces, "How your work
   * landed" for the other two. Counting something on one screen and detailing
   * it on another with no way across is a gap, not a readout.
   *
   * These three are different, and the distinction is the point of the list.
   * There is no rank screen, no streak screen, and the badge wall is rendered
   * inside the Badges cell itself. Giving them a destination would mean
   * inventing one — the same move as the `?? 's-dbs'` Space that Library's
   * orphan row used to state as fact. A cell that opens somewhere arbitrary is
   * worse than one that opens nothing, because it looks answered.
   *
   * `BentoCell` earns this: `console-focusable hover:bg-white/[0.06]` is
   * applied only when `to || onClick`, so a readout has no hover state and no
   * focus ring. It does not pretend to be a control.
   */
  /*
   * 'Rank' has left this list — it opens `/v4/profile/rank` now.
   *
   * It was the honest case for an exemption right up until the screen it
   * needed existed: there was no rank screen, so a destination would have been
   * invented. Building one is what made the cell a control, and the staleness
   * check below is what caught the entry the moment it did.
   */
  // 'Streak' left too, for the same reason 'Rank' did: the screen it
  // needed now exists (`/v4/profile/history`).
  'screens/ProfileScreen.tsx': ['Badges'],
};

/** Every screen that uses a BentoCell, found rather than listed. */
const SCREENS_WITH_CELLS = readdirSync(join(SRC, 'screens'))
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => `screens/${f}`)
  .filter((f) => read(f).includes('<BentoCell'));

describe('every screen with cells is swept, not just Home', () => {
  /*
   * This file used one flat `Set` of labels and read `HomeScreen.tsx` alone.
   * Two of the four entries — 'Your latest note' and 'Badges' — name cells on
   * *Library* and *Profile*, screens it never opened. They exempted nothing,
   * and their presence implied those screens had been considered. They had
   * not: Library's four cells had never been checked for dead ends at all,
   * and three of them were buttons faking navigation with `navigate()`.
   *
   * Keying by screen is what makes an entry falsifiable. A label that names no
   * cell on the screen it claims now fails, so the list cannot quietly rot
   * into a description of a layout that has moved on.
   */
  it('finds them all', () => {
    expect(SCREENS_WITH_CELLS).toContain('screens/HomeScreen.tsx');
    expect(SCREENS_WITH_CELLS).toContain('screens/LibraryScreen.tsx');
    expect(SCREENS_WITH_CELLS.length).toBeGreaterThanOrEqual(3);
  });

  it('gives every cell a destination, an action, or a named exemption', () => {
    const inert: string[] = [];
    for (const f of SCREENS_WITH_CELLS) {
      const allowed = READOUTS[f] ?? [];
      for (const tag of bentoCells(read(f))) {
        if (/\bto=|onClick=/.test(tag)) continue;
        const label = labelOf(tag);
        if (allowed.includes(label)) continue;
        inert.push(`${f}: ${label}`);
      }
    }
    expect(inert, `cells that look like controls and do nothing:\n${inert.join('\n')}`).toEqual([]);
  });

  it('has no exemption for a cell that is gone or now a control', () => {
    const stale: string[] = [];
    for (const [f, labels] of Object.entries(READOUTS)) {
      const tags = bentoCells(read(f));
      for (const label of labels) {
        const cell = tags.find((t) => labelOf(t) === label);
        if (!cell) stale.push(`${f}: "${label}" names no cell`);
        else if (/\bto=|onClick=/.test(cell)) stale.push(`${f}: "${label}" is now a control`);
      }
    }
    expect(stale, `READOUTS is out of date:\n${stale.join('\n')}`).toEqual([]);
  });
});

describe('a cell that names a Lesson opens it', () => {
  const home = read('screens/HomeScreen.tsx');
  const cells = bentoCells(home);

  it('finds every cell on Home', () => {
    // The hero, Streak, Rank, Due for review, New since you were here.
    expect(cells.length).toBe(5);
  });

  it('gives each one a destination, or names it a readout', () => {
    const inert = cells
      .filter((tag) => !/\bto=|onClick=/.test(tag))
      .map(labelOf)
      .filter((label) => !READOUTS['screens/HomeScreen.tsx'].includes(label));

    expect(
      inert,
      `Home cells that look like controls and do nothing:\n${inert.join('\n')}`,
    ).toEqual([]);
  });

  it('opens the hero, not just the small print', () => {
    /*
     * The regression that started this file: the widest cell was the dead one.
     *
     * Identified by `next.reason` rather than by the map that supplies its
     * label. This originally matched `REASON_LABEL[next.reason]` and broke the
     * moment the hero stopped sharing the rows' label map — a true failure
     * about a stale detail, which is the least useful kind. What this test
     * actually cares about is that a cell keyed to `next` exists and opens
     * `next`'s Lesson; which map phrases it is `labels.test.tsx`'s business.
     */
    const hero = cells.find((tag) => /next\.reason/.test(tag));
    expect(hero, 'Home no longer has a hero cell keyed to `next`').toBeDefined();
    expect(/\bto=/.test(hero!), 'the hero cell is inert again').toBe(true);
    expect(
      /next\.spaceId.*next\.lessonId/s.test(hero!),
      'the hero opens something other than the Lesson it names',
    ).toBe(true);
  });

  it('keeps Streak and Rank as readouts, so the set stays meaningful', () => {
    // If these ever gain a destination the allowlist above is stale, and
    // "readout" has quietly stopped meaning anything.
    for (const label of ['Streak', 'Rank']) {
      const cell = cells.find((tag) => labelOf(tag) === label);
      expect(cell, `Home lost its ${label} cell`).toBeDefined();
      expect(/\bto=|onClick=/.test(cell!), `${label} became a control — update READOUTS`).toBe(
        false,
      );
    }
  });
});

/**
 * The other half of the same defect: two ways to do one thing.
 *
 * Home's four Recently-viewed covers were `<Pressable>` buttons calling
 * `navigate()`, while the "Also waiting" rows directly beneath them were
 * `<Link>`s. Same act, two implementations — and the button half silently lost
 * cmd-click, middle-click, open-in-new-tab and the status-bar preview, which is
 * not a style preference but four behaviours a person expects from a link.
 */
describe('opening a Lesson is always a link', () => {
  /*
   * Scoped to Home on purpose, and this is the interesting part of the test.
   *
   * Run repo-wide, the same rule also fires on `SpaceScreen.tsx` and
   * `LessonScreen.tsx`, which each open a Lesson from a button handler. Those
   * are real instances of this defect and they are *not* fixed here — both
   * screens belong to a session building them right now, and widening a gate
   * across someone else's in-flight files converts a finding into a merge
   * conflict. They are reported instead.
   *
   * So the gate is narrow and honest rather than broad and switched off. When
   * those two screens settle, add them to SCREENS — the rule is already
   * written, and it will pass or it will tell you why not.
   */
  const SCREENS = ['screens/HomeScreen.tsx'];

  it('never navigates to a Lesson from a button handler', () => {
    const offenders: string[] = [];
    for (const path of SCREENS) {
      const body = read(path);
      // `navigate('/v4/space/.../lesson/...')` inside an onClick is the smell.
      // A cell/tile/row target is a link; `navigate` stays for dialogs, wizards
      // and post-action redirects, which have no href to be.
      const matches = body.match(/onClick=\{[^}]*navigate\(\s*`?\/v4\/space\/[^`')]*lesson/g) ?? [];
      for (const m of matches) offenders.push(`${path}: ${m.slice(0, 72)}…`);
    }
    expect(
      offenders,
      `Lesson targets that should be links:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('leaves no Lesson target on Home as a bare button', () => {
    const body = read('screens/HomeScreen.tsx');
    // Every Recently-viewed cover and every bento cell that names a Lesson.
    expect(/<PressableLink/.test(body), 'the Recently viewed rail stopped being links').toBe(true);
    expect((body.match(/\bto=\{`\/v4\/space\//g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
