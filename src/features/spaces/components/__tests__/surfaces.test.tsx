import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SURFACES } from '../Scene';

/**
 * Rules the three newest surfaces have to keep: Practice, Settings, and ⌘K.
 *
 * Source-reading guards, for the same reason `modes.test.tsx` is one — each of
 * these is a rule about *composition* or about what a screen refuses to do,
 * and neither survives a render test that only sees the happy path.
 */

const SRC = join(process.cwd(), 'src/features/spaces');
const read = (p: string) =>
  readFileSync(join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('Practice is private', () => {
  const practice = read('screens/PracticeScreen.tsx');

  it('is a plain surface with no top bar', () => {
    // Working, not choosing: the console texture comes off, and the five
    // destinations go with it. Stage (since 2026-10-11) or focus — never browse.
    expect(['focus', 'stage']).toContain(SURFACES.practice);
    expect(practice).toContain('SURFACES.practice');
    expect(practice).not.toContain('SpacesTopBar');
  });

  it('grants no XP and touches no rank', () => {
    /*
     * Abi's call, 2026-08-31: practice grants nothing and clears nothing.
     * It is a place to be wrong safely — the moment it scores you, you stop
     * guessing honestly. The tally at the end is for you and goes nowhere.
     */
    expect(practice).not.toMatch(/\bxp\b/i);
    expect(practice).not.toMatch(/\brank\b/i);
    expect(practice).not.toMatch(/grantXp|awardBadge|viewerStanding/);
  });

  it('does not mark ideas cleared on the map', () => {
    expect(practice).not.toMatch(/setLit|markCleared|conceptState|mastery/i);
  });

  it('always offers a way out', () => {
    // A focus surface with no exit is a trap, not a mode.
    // The words live in the locale files now; the source names their key.
    expect(practice).toContain("t('practiceScreen.leave')");
    expect(readFileSync(join(process.cwd(), 'src/i18n/locales/en/v4Space.json'), 'utf8')).toContain(
      '"leave": "Leave practice"',
    );
  });
});

describe('search is a jump tool, not a browse surface', () => {
  const palette = read('components/SearchPalette.tsx');

  it('never renders a result body inline', () => {
    /*
     * Doc 2: results are a title and a destination. A preview pane would
     * quietly turn the palette into a sixth destination, and content would
     * start being read in a box that cannot be linked to.
     */
    expect(palette).not.toMatch(/\.body|\.excerpt|\.content\b/);
  });

  it('names the Space on every result', () => {
    expect(palette).toContain('hit.spaceName');
  });

  it('groups by object type', () => {
    /* The group names live in the translations; the palette carries their keys. */
    const words = JSON.parse(readFileSync(join(process.cwd(), 'src/i18n/locales/en/v4Spaces.json'), 'utf8'));
    for (const [key, label] of [['spaces', 'Spaces'], ['lessons', 'Lessons'], ['ideas', 'Ideas']]) {
      expect(palette).toContain(`'search.group.${key}'`);
      expect(words.search.group[key]).toBe(label);
    }
  });

  it('is mounted once, by the bar, rather than per screen', () => {
    const bar = read('components/SpacesTopBar.tsx');
    expect(bar).toContain('<SearchPalette');
    expect(bar).toContain('useSearchPalette()');
  });
});
