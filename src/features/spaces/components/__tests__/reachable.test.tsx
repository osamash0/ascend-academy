import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every component has a call site.
 *
 * `LessonTile` was written, reviewed and committed, matched the console
 * language exactly — and nothing in the repo imported it. Its progress bar,
 * its watermark, its markers slot and its "Done" badge had therefore never
 * rendered against anything. A component with no call site is written, not
 * built, and it rots quietly: it is the one file nobody notices when a token
 * changes underneath it.
 *
 * `Notice` was the same. So was `ClassificationChips`' Discover rule, which
 * described the one card that never mounted it.
 */

const ROOT = join(process.cwd(), 'src/features/spaces');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const sources = walk(ROOT)
  .filter((p) => !p.includes('__tests__'))
  .map((p) => ({ path: p, name: p.slice(ROOT.length + 1), body: readFileSync(p, 'utf8') }));

/** Exported React components — capitalised `export function`. */
const exported = sources.flatMap(({ name, body }) =>
  [...body.matchAll(/^export function ([A-Z]\w+)/gm)].map((m) => ({ file: name, symbol: m[1] })),
);

describe('nothing in the namespace is unreachable', () => {
  it('finds components to check', () => {
    expect(exported.length).toBeGreaterThan(15);
  });

  it('mounts every exported component somewhere', () => {
    const orphans: string[] = [];
    for (const { file, symbol } of exported) {
      const used = sources.some(
        ({ name, body }) =>
          name !== file &&
          // Mounted as JSX, or re-exported by the barrel.
          (new RegExp(`<${symbol}[\\s/>]`).test(body) || new RegExp(`\\b${symbol}\\b`).test(body)),
      );
      if (!used) orphans.push(`${file}: <${symbol}> is never mounted`);
    }
    expect(orphans, `unreachable components:\n${orphans.join('\n')}`).toEqual([]);
  });
});

describe('classification shows where you are choosing', () => {
  const tile = readFileSync(join(ROOT, 'components/SpaceTile.tsx'), 'utf8');
  const screen = readFileSync(join(ROOT, 'screens/SpacesScreen.tsx'), 'utf8');

  it('is mounted by the Discover card', () => {
    expect(tile).toContain('ClassificationChips');
  });

  it('is on in Discover and off in Mine', () => {
    // "Classification helps you choose, not once you have chosen." Showing it
    // inside a Space you visit daily is furniture that crowds out the one
    // thing you came for.
    expect(screen).toMatch(/showClassification=\{tab === 'discover'\}/);
  });

  it('leaves the cap in the component rather than at the call site', () => {
    // The rule is "at most two, most specific first". A call site passing
    // `max={4}` would break it with all four gates green, so no call site
    // passes `max` at all.
    for (const { name, body } of sources) {
      if (name === 'components/badges.tsx') continue;
      expect(body, `${name} overrides the classification cap`).not.toMatch(
        /<ClassificationChips[^>]*\bmax=/,
      );
    }
  });
});
