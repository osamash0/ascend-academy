import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Learn and Studio must not blur — Doc 2, Learn/Studio rule 5: "A screen never
 * mixes the two."
 *
 * These read the source rather than render, because what is being asserted is
 * a *composition* rule: which chrome a screen is allowed to mount. A render
 * test would need every screen's data and would still miss the one that
 * imports the wrong bar.
 */

const SRC = join(process.cwd(), 'src/features/spaces');

/**
 * Reads a file with comments stripped.
 *
 * Necessary, not fussy: SpaceManageScreen's own doc comment says the Learn bar
 * is "deliberately absent", and a naive substring match read that sentence as
 * the violation it was describing. The vocabulary checker learned the same
 * lesson — a rule that fires on the prose explaining it is a rule people
 * switch off.
 */
const read = (p: string) =>
  readFileSync(join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const STUDIO_SCREENS = [
  'screens/LibraryStudioScreen.tsx',
  'screens/SpaceManageScreen.tsx',
  'screens/SettingsScreen.tsx',
];
const LEARN_SCREENS = [
  'screens/HomeScreen.tsx',
  'screens/SpacesScreen.tsx',
  'screens/SpaceScreen.tsx',
  'screens/LessonScreen.tsx',
  'screens/ConceptScreen.tsx',
  'screens/LibraryScreen.tsx',
  'screens/SocialScreen.tsx',
  'screens/ProfileScreen.tsx',
  // Practice is Learn in a *focus* surface: Scene, no top bar, one question.
  'screens/PracticeScreen.tsx',
];

describe('Learn and Studio never mix', () => {
  it('keeps the Learn top bar off every Studio screen', () => {
    // Studio is reached *from* Learn and replaces it; carrying the five
    // destinations into a management console is what blurs the two.
    for (const f of STUDIO_SCREENS) {
      expect(read(f).includes('SpacesTopBar'), `${f} mounts the Learn bar`).toBe(false);
    }
  });

  it('gives every Studio screen the Studio shell', () => {
    for (const f of STUDIO_SCREENS) {
      expect(read(f).includes('StudioShell'), `${f} has no Studio chrome`).toBe(true);
    }
  });

  it('keeps the Studio shell off every Learn screen', () => {
    for (const f of LEARN_SCREENS) {
      expect(read(f).includes('StudioShell'), `${f} mounts Studio chrome`).toBe(false);
    }
  });

  it('renders every Learn screen through Scene', () => {
    // The browse/focus ground rule is enforced by construction, not memory.
    for (const f of LEARN_SCREENS) {
      expect(read(f).includes('<Scene'), `${f} bypasses Scene`).toBe(true);
    }
  });

  it('keeps multi-select out of Learn screens', () => {
    // "Learn — no tables or multi-select." A checkbox on a calm screen is the
    // first step to it becoming a console.
    for (const f of LEARN_SCREENS) {
      expect(read(f).includes('type="checkbox"'), `${f} has multi-select`).toBe(false);
    }
  });
});

describe('Origin is never optional where content appears', () => {
  /*
   * `badges.tsx` states it: "never optional where content appears — separation
   * is the whole point, and a badge that sometimes shows is a badge nobody
   * trusts." Two surfaces gated it on `space.mode === 'open'`, arguing that in
   * a Guided Space everything is Official by definition.
   *
   * That premise is gone (Abi, 2026-08-31): a promoted Lesson is Community
   * origin inside a Guided Space. The gate would therefore have hidden the
   * marker on precisely the Lesson that needs it — in the Space where nothing
   * else on the row says a Member wrote it.
   */
  for (const f of ['components/LessonRow.tsx', 'screens/LessonScreen.tsx']) {
    it(`shows it unconditionally in ${f}`, () => {
      const body = read(f);
      expect(body, `${f} does not show Origin at all`).toContain('<OriginBadge');
      expect(body, `${f} gates Origin on the Space's mode`).not.toMatch(
        /mode === 'open'\s*&&\s*<OriginBadge/,
      );
    });
  }
});
