import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Opening a Lesson is always a link.
 *
 * This file used to guard `BentoCell` too: a cell that names a Lesson had to
 * open it, because the cell picked its own tag and a cell given neither `to`
 * nor `onClick` rendered as an inert `div` (Home's hero did exactly that). The
 * bentos are gone (2026-10-10, "one fact, once" — every cell repeated something
 * already on its screen), and with them `BentoCell`. The one thing a screen
 * offers is now `UpNext`, which is a `Link` by construction.
 *
 * What remains is the other half of the same defect: two ways to do one thing.
 * Home's Recently-viewed covers were `<Pressable>` buttons calling
 * `navigate()`, while the rows beneath them were `<Link>`s — and the button
 * half silently lost cmd-click, middle-click, open-in-new-tab and the
 * status-bar preview, four behaviours a person expects from a link.
 *
 * Source-level, like `modes.test.tsx`: the assertion is about composition.
 */

const SRC = join(process.cwd(), 'src/features/spaces');

const read = (p: string) =>
  readFileSync(join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('opening a Lesson is always a link', () => {
  /*
   * Space joined Home on 2026-10-10, once its Continue button became the
   * `UpNext` link. `LessonScreen` still starts the reader from a handler —
   * its target depends on what the Lesson has (deck, passages, idea, practice)
   * — so it is not listed yet.
   */
  const SCREENS = ['screens/HomeScreen.tsx', 'screens/SpaceScreen.tsx'];

  it('never navigates to a Lesson from a button handler', () => {
    const offenders: string[] = [];
    for (const path of SCREENS) {
      const body = read(path);
      // `navigate('/v4/space/.../lesson/...')` inside an onClick is the smell.
      const matches = body.match(/onClick=\{[^}]*navigate\(\s*`?\/v4\/space\/[^`')]*lesson/g) ?? [];
      for (const m of matches) offenders.push(`${path}: ${m.slice(0, 72)}…`);
    }
    expect(offenders, `Lesson targets that should be links:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('leaves no Lesson target on Home as a bare button', () => {
    const body = read('screens/HomeScreen.tsx');
    expect(/<PressableLink/.test(body), 'the Recently viewed rail stopped being links').toBe(true);
    expect(/<UpNext/.test(body), 'Home lost its Up next card').toBe(true);
    // The hero, the queue rows and the rail — each a `to` into a Lesson.
    expect((body.match(/\bto=\{`\/v4\/space\//g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('makes Up next a link by construction', () => {
    const stage = read('components/stage.tsx');
    const upNext = stage.slice(stage.indexOf('export function UpNext'));
    expect(upNext).toMatch(/<Link\b/);
    expect(upNext).not.toMatch(/navigate\(/);
  });
});
