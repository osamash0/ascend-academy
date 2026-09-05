import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { archivedForViewer, myHubSpaces, sortSpaces } from '../hub';
import { visibleSpaces } from '../spaces';

/**
 * Three gaps from `docs/design-v4/notes-spaces-screen.md`, held closed.
 *
 * The hub was built to `SPACES-HUB-HANDOFF.md`, which is a different document
 * from the notes — so three of the nine recorded gaps were never in its scope.
 * One of them was not a gap but a regression: the previous Spaces screen
 * handled archived Spaces and the hub dropped them entirely.
 */

const strip = (p: string) =>
  readFileSync(join(process.cwd(), 'src/features/spaces', p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('archived Spaces are never hidden', () => {
  /*
   * `notes-spaces-screen.md` gap 5: "Archived: collapsed section at bottom,
   * never hidden (progress lives there)." Doc 1 defines the state as
   * "read-only, keeps progress, earns no XP" — archiving is not deleting, so a
   * screen that omits them is claiming something the model does not say.
   */

  it('has one to show, or this guard proves nothing', () => {
    expect(
      archivedForViewer().length,
      'no archived Space the viewer is in — every assertion below is vacuous',
    ).toBeGreaterThan(0);
  });

  it('keeps them out of the active set and in the archived one', () => {
    const active = myHubSpaces();
    for (const s of archivedForViewer()) {
      expect(s.state).toBe('archived');
      expect(active.map((a) => a.id), `${s.name} is in both sets`).not.toContain(s.id);
    }
  });

  it("loses none of the viewer's Spaces between the two sets", () => {
    /*
     * The actual regression, stated as a sum. `myHubSpaces` filtered on
     * `state === 'active'` and nothing picked up the remainder, so a Space
     * could be in neither and no test noticed.
     */
    const mine = visibleSpaces().filter((s) => s.viewerRole !== null);
    expect(myHubSpaces().length + archivedForViewer().length).toBe(mine.length);
  });

  it('renders them on the screen, below everything else', () => {
    const screen = strip('screens/SpacesHubScreen.tsx');
    expect(screen, 'the hub does not read the archived set').toContain('archivedForViewer');
    expect(screen, 'archived work is not disclosed as a collapsed section').toContain('<details');
    // Below the rails: the last rail must appear before the disclosure.
    expect(screen.indexOf('New this week')).toBeLessThan(screen.indexOf('<details'));
  });
});

describe('your Spaces can be ordered', () => {
  const mine = myHubSpaces();

  it('sorts by name without touching the original', () => {
    const before = mine.map((s) => s.id);
    const byName = sortSpaces(mine, 'name').map((s) => s.name);
    expect([...byName].sort((a, b) => a.localeCompare(b))).toEqual(byName);
    expect(mine.map((s) => s.id), 'sorting mutated its input').toEqual(before);
  });

  it('sorts by last active, newest first', () => {
    const dates = sortSpaces(mine, 'active').map((s) => s.lastActiveAt);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });

  it('keeps every Space, whichever order', () => {
    for (const by of ['name', 'active'] as const) {
      expect(sortSpaces(mine, by)).toHaveLength(mine.length);
    }
  });

  it('offers the control regardless of how many you have', () => {
    /*
     * The note says "past ~8 Spaces". Deliberately not implemented that way:
     * the viewer has five, so a threshold would mean the control never
     * rendered and the whole path shipped unexercised — the failure mode this
     * suite keeps finding. A control that appears at eight and vanishes at
     * seven is also a moving target in the one row meant to stay put.
     */
    const screen = strip('screens/SpacesHubScreen.tsx');
    expect(screen).toContain('sortSpaces');
    expect(screen, 'the sort control is gated on a count').not.toMatch(
      /length\s*>\s*\d+\s*&&[\s\S]{0,120}(Last active|A–Z)/,
    );
    expect(myHubSpaces().length, 'the fixtures now exceed the threshold').toBeLessThan(8);
  });
});

describe('a card says which kind of Space it is', () => {
  it('marks Guided and Open on the card', () => {
    // Gap 7. The one card fact that changes what you can *do* in a Space
    // rather than what is in it.
    expect(strip('components/hub/Rails.tsx')).toContain('<ModeBadge');
  });

  it("has both kinds among the viewer's Spaces, so both render", () => {
    const modes = new Set(myHubSpaces().map((s) => s.mode));
    expect(modes.has('guided'), 'no Guided Space in the fixtures').toBe(true);
    expect(modes.has('open'), 'no Open Space in the fixtures').toBe(true);
  });
});
