import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every screen renders all four states.
 *
 * §5.4 requires empty, loading, error and ready per screen. Eight of the
 * twelve never called `useScenario`, so `?mock=loading` and `?mock=error` were
 * silent no-ops on them — the states were not merely unreviewed, they were
 * unreachable. And three of the eight used the *error* state for a bad id, so
 * mistyping a Lesson URL claimed the connection had dropped and offered a
 * retry that could never work.
 */

const SCREENS = join(process.cwd(), 'src/features/spaces/screens');
const COMPONENTS = join(process.cwd(), 'src/features/spaces/components');

const read = (dir: string, f: string) =>
  readFileSync(join(dir, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const screens = readdirSync(SCREENS)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ name: f, body: read(SCREENS, f) }));

describe('every screen can be seen loading and failing', () => {
  it('finds all the screens', () => {
    expect(screens.length).toBeGreaterThanOrEqual(12);
  });

  it('gives each one a loading state', () => {
    for (const { name, body } of screens) {
      // Either it fetches (and gets `state` from its data hook) or it does not
      // (and takes the round-trip from `useScreenState`). SpaceRoute is a
      // router shim with no UI of its own.
      if (name === 'SpaceRoute.tsx') continue;
      expect(
        /useScreenState|state === 'loading'/.test(body),
        `${name} can never render a loading state`,
      ).toBe(true);
    }
  });

  it('gives each one an error state', () => {
    for (const { name, body } of screens) {
      if (name === 'SpaceRoute.tsx') continue;
      expect(body.includes('SpacesError'), `${name} can never render an error`).toBe(true);
    }
  });

  it('never uses the error state for a missing thing', () => {
    /*
     * A bad id is not a failed load. They need different words — "the
     * connection dropped" is a lie about a mistyped URL — and different
     * actions: retrying will never find a Lesson that does not exist.
     */
    for (const { name, body } of screens) {
      const notFoundish = /if \(!\w+ (\|\| !\w+ )?\)\s*\n?\s*return chrome\(<SpacesError/;
      expect(notFoundish.test(body), `${name} reports "not found" as a failure`).toBe(false);
    }
  });

  it('names what failed rather than always blaming Spaces', () => {
    // One component, twelve screens: an unlabelled error says "Couldn't load
    // your Spaces" on a Lesson, which is about something you did not ask for.
    for (const { name, body } of screens) {
      if (!body.includes('<SpacesError')) continue;
      if (name === 'SpacesScreen.tsx') continue; // it *is* Spaces
      expect(body, `${name} does not say what failed`).toMatch(/<SpacesError what=/);
    }
  });
});

describe('skeletons mirror what they replace', () => {
  const states = read(COMPONENTS, 'states.tsx');

  it('offers a shape per layout rather than one for everything', () => {
    for (const shape of ['SpacesSkeleton', 'DetailSkeleton', 'ListSkeleton']) {
      expect(states).toContain(`export function ${shape}`);
    }
  });

  it('draws the Spaces rail at the size the rail actually is', () => {
    /*
     * It drew 96px tiles while `SpaceTile` is 200px, so the rail jumped every
     * time it loaded — and it was also the loading state for three screens
     * with no tile rail at all. Its own comment promised "nothing shifts when
     * the content lands".
     */
    const tile = read(COMPONENTS, 'SpaceTile.tsx');
    const size = tile.match(/h-\[(\d+)px\] w-\[\1px\]/)?.[1] ?? '200';
    const rail = states.slice(states.indexOf('export function SpacesSkeleton'));
    expect(rail, `the skeleton does not match SpaceTile's ${size}px`).toContain(`w-[${size}px]`);
  });

  it('marks every skeleton busy for screen readers', () => {
    const count = (states.match(/aria-busy="true"/g) ?? []).length;
    expect(count).toBe(3);
  });
});
