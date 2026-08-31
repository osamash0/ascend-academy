import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The set of files the guards sweep, in one place.
 *
 * This existed as a hand-copied `readdirSync` in five test files, and the
 * copies drifted exactly where you would expect. When `components/hub/` was
 * added, four of them were taught to recurse and the fifth —
 * `responsive.test.tsx` — was not, so it went on reporting green while checking
 * a directory that no longer held all the components. Worse, it read
 * `components/` only, so no screen had ever been swept for a pinned width.
 *
 * A guard that stops at a directory boundary is more dangerous than a missing
 * one: the tick claims the namespace was checked. Sharing the walker means the
 * next subdirectory is picked up by every guard at once, or by none of them.
 */

const SRC = join(process.cwd(), 'src/features/spaces');

/**
 * Source with comments stripped.
 *
 * Not fussiness. Guards here have fired four separate times on the prose
 * explaining the rule they enforce — a screen's doc comment saying the Learn
 * bar is "deliberately absent" read as the violation it was describing. A rule
 * that flags its own documentation is a rule people switch off.
 */
export const readSource = (relPath: string) =>
  readFileSync(join(SRC, relPath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

export type Source = { name: string; body: string };

const walk = (dir: string): Source[] =>
  readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === '__tests__'
        ? []
        : walk(`${dir}/${e.name}`)
      : e.name.endsWith('.tsx') && !e.name.includes('.test.')
        ? [{ name: `${dir}/${e.name}`, body: readSource(`${dir}/${e.name}`) }]
        : [],
  );

/**
 * Every `.tsx` under the given directories, recursively.
 *
 * Names are relative to `src/features/spaces` and keep their directory
 * (`components/hub/HeroCover.tsx`), so a failure message says where to look
 * rather than just naming a file that might exist in two places.
 */
export const sourceFiles = (...dirs: string[]): Source[] => dirs.flatMap(walk);

/** Everything that renders UI. The default sweep for a guard about the UI. */
export const allSources = (): Source[] => sourceFiles('screens', 'components');
