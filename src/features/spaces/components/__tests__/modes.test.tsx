import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
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

/**
 * Every screen, classified. Exhaustive by construction.
 *
 * This was two hand-written arrays, and they went stale exactly as you would
 * expect: four screens — `PersonScreen`, `ReaderScreen`, `SpacesHubScreen` and
 * `SpaceRoute` — had been added without anyone adding them here, so the
 * Learn/Studio rule was simply not checked for them. Two of the four I wrote
 * myself.
 *
 * The list is now read off the filesystem and every screen *must* appear in
 * this map, so adding one fails the suite until somebody says which mode it is.
 * A missing entry is a question the author has to answer, rather than a silent
 * exemption.
 */
type Mode = 'learn' | 'studio' | 'shim' | 'own-ground';

const MODE: Record<string, Mode> = {
  'HomeScreen.tsx': 'learn',
  'SpacesScreen.tsx': 'learn',
  /*
   * Learn in mode — minimal chrome, one primary action, no multi-select — but
   * it supplies its own ground rather than going through `Scene`.
   *
   * `SPACES-HUB-HANDOFF.md` replaces the visual system for this one page: bg
   * `#0a0b0d` with full-bleed cover art and three scrims, which is what
   * `Scene`/`DepthScene` exists to provide and cannot provide *this*. Forcing
   * it through Scene would put the console texture under art designed to own
   * the screen.
   *
   * A separate value rather than a quiet exemption, because the thing Scene
   * actually guarantees is `reducedMotion="user"` — and that now comes from
   * `MotionRoot` at the route level, which this screen does sit under. The
   * assertion below checks that instead, so the guarantee is still enforced,
   * just at its new home.
   */
  'SpacesHubScreen.tsx': 'own-ground',
  'SpaceScreen.tsx': 'learn',
  'LessonScreen.tsx': 'learn',
  'ConceptScreen.tsx': 'learn',
  'LibraryScreen.tsx': 'learn',
  'SocialScreen.tsx': 'learn',
  'ProfileScreen.tsx': 'learn',
  'PersonScreen.tsx': 'learn',
  // Learn in a *focus* surface: Scene, no top bar, one thing at a time.
  'PracticeScreen.tsx': 'learn',
  'ReaderScreen.tsx': 'learn',
  'LibraryStudioScreen.tsx': 'studio',
  'SpaceManageScreen.tsx': 'studio',
  'SettingsScreen.tsx': 'studio',
  // A router shim: picks a tab and renders SpaceScreen. It has no UI of its
  // own, so the chrome rules have nothing to say about it.
  'SpaceRoute.tsx': 'shim',
};

const ALL_SCREENS = readdirSync(join(SRC, 'screens')).filter((f) => f.endsWith('.tsx'));
const screensWhere = (mode: Mode) =>
  ALL_SCREENS.filter((f) => MODE[f] === mode).map((f) => `screens/${f}`);

const STUDIO_SCREENS = screensWhere('studio');
const LEARN_SCREENS = screensWhere('learn');

describe('every screen is classified', () => {
  it('leaves none unaccounted for', () => {
    const unclassified = ALL_SCREENS.filter((f) => !MODE[f]);
    expect(
      unclassified,
      `unclassified screens — add them to MODE as learn, studio or shim:\n${unclassified.join('\n')}`,
    ).toEqual([]);
  });

  it('does not name screens that no longer exist', () => {
    // The other direction: a renamed screen leaving a dead entry behind, which
    // would quietly shrink the set being checked.
    const ghosts = Object.keys(MODE).filter((f) => !ALL_SCREENS.includes(f));
    expect(ghosts, `MODE names screens that are gone:\n${ghosts.join('\n')}`).toEqual([]);
  });

  it('checks a realistic number of them', () => {
    expect(LEARN_SCREENS.length + STUDIO_SCREENS.length).toBeGreaterThanOrEqual(14);
  });
});

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

  it('holds a ground-owning screen to the guarantee Scene was providing', () => {
    /*
     * Scene's job is two things: the browse/focus ground, and
     * `reducedMotion="user"`. A screen that supplies its own ground still owes
     * the second — and it comes from `MotionRoot` at the route level now, so
     * this checks the screen is actually mounted under it rather than trusting
     * that it is.
     */
    const ownGround = screensWhere('own-ground');
    expect(ownGround.length, 'no ground-owning screen — this guard is vacuous')
      .toBeGreaterThan(0);
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    for (const f of ownGround) {
      const name = f.replace('screens/', '').replace('.tsx', '');
      expect(app, `${f} is not routed`).toContain(name);
      expect(app, 'the v4 routes are not under MotionRoot').toContain('<MotionRoot />');
      // And it must not quietly reintroduce a second config.
      expect(read(f), `${f} mounts its own MotionConfig`).not.toContain('MotionConfig');
      /*
       * The duty that was actually dropped. `Scene` pairs the mobile bottom bar
       * with the spacer that reserves room for it; this screen mounts the bar
       * (via `SpacesTopBar`) and, until this guard, not the spacer — so the
       * last rail sat underneath it on every phone. Owning your ground means
       * owning the bottom of it too.
       */
      if (read(f).includes('<SpacesTopBar')) {
        /*
         * `<MobileNavSpacer`, with the angle bracket. Written first as a plain
         * `toContain('MobileNavSpacer')`, which passed with the element deleted
         * — the leftover `import` line was enough to satisfy it. A guard that a
         * dangling import can satisfy is not checking that anything renders.
         */
        expect(read(f), `${f} mounts the mobile bar with no spacer under it`).toContain(
          '<MobileNavSpacer',
        );
      }
    }
  });

  it('keeps multi-select out of Learn screens', () => {
    // "Learn — no tables or multi-select." A checkbox on a calm screen is the
    // first step to it becoming a console. Applies to the ground-owning screen
    // too: it is Learn in every respect except where its background comes from.
    for (const f of [...LEARN_SCREENS, ...screensWhere('own-ground')]) {
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
