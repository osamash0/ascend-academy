import { describe, expect, it } from 'vitest';
import { allSources, readSource } from './sources';
import { NAV_TABS, navHref } from '../SpacesTopBar';

/**
 * Rules for the small end.
 *
 * Nothing here had been checked below `sm` before this pass. The interesting
 * finding was not an overflow — it was the per-Space map "fitting" perfectly
 * at 375px by scaling its 896-unit viewBox down by 0.36, which turned every
 * label into 4.7px of unreadable type. Fitting and working are different
 * things, and only one of them is visible in a screenshot.
 */

/*
 * This file read `components/` one level deep, which meant two blind spots at
 * once: every subdirectory (`components/hub/`) and every *screen*. The
 * pinned-width sweep below had therefore never looked at a single screen —
 * where full-page layout actually lives — while reporting green.
 */
const read = (p: string) => readSource(p.includes('/') ? p : `components/${p}`);
const files = allSources();

describe('wide content scrolls instead of shrinking', () => {
  it('gives both maps a legible floor and their own scroller', () => {
    for (const f of ['SpaceMap.tsx', 'AscentMap.tsx']) {
      const body = read(f);
      expect(body, `${f} has no minimum width`).toMatch(/min-w-\[\d+px\]/);
      expect(body, `${f} has no horizontal scroller`).toContain('overflow-x-auto');
    }
  });
});

describe('the bottom bar and the top bar never both navigate', () => {
  const bar = read('SpacesTopBar.tsx');
  const mobile = read('MobileNav.tsx');

  it('hides the top pills where the bottom bar appears', () => {
    // Two navigation controls on one screen is two things that must agree
    // about which tab is active. They swap at the same breakpoint.
    expect(bar).toMatch(/hidden items-center gap-1 md:flex/);
    expect(mobile).toContain('md:hidden');
  });

  it('carries the same five destinations, from one source', () => {
    /*
     * This used to grep `key: '...'` out of both files and compare the two
     * lists — which passed while `MobileNav` held a full byte-for-byte copy of
     * the table *and* its own copy of the route rule. Renaming a label,
     * swapping an icon or changing where a tab goes left the two navs
     * disagreeing and the guard green.
     *
     * There is one table now, so the assertion is that the copy is gone.
     */
    expect(bar).toContain('export const NAV_TABS');
    expect(mobile).toContain('NAV_TABS');
    expect(mobile, 'MobileNav declares its own table again').not.toMatch(/const\s+\w*TABS\s*[:=]/);
    expect(mobile, 'MobileNav derives its own routes again').not.toMatch(/'\/v4\/spaces'/);
    expect(NAV_TABS).toHaveLength(5);
    expect(NAV_TABS.map((t) => t.key)).toEqual([
      'home',
      'spaces',
      'library',
      'social',
      'profile',
    ]);
  });

  it('sends every destination somewhere that exists', () => {
    // The route rule lives in `navHref`, so it is checkable rather than
    // restated in two components.
    for (const t of NAV_TABS) {
      expect(navHref(t.key)).toMatch(/^\/v4\//);
    }
    expect(navHref('spaces')).toBe('/v4/spaces');
  });

  it('portals out of the scene rather than sitting inside it', () => {
    /*
     * `DepthScene` animates a transform, and a transformed ancestor becomes
     * the containing block for `position: fixed`. The first version pinned
     * itself to the top of the scene instead of the bottom of the viewport
     * and looked like a second header. Nothing in the CSS was wrong.
     */
    expect(mobile).toContain('createPortal');
    expect(mobile).toContain('document.body');
  });

  it('leaves room for itself', () => {
    // A fixed bar covers the last row of every screen without a spacer, and
    // Scene mounts it so no screen can forget.
    expect(mobile).toContain('MobileNavSpacer');
    expect(read('Scene.tsx')).toContain('<MobileNavSpacer />');
  });

  it('respects the home indicator', () => {
    // Without this the bar sits under it and the two rightmost tabs — Social
    // and Profile — are the ones you cannot hit.
    expect(mobile).toContain('safe-area-inset-bottom');
  });
});

describe('nothing forces the page itself to scroll sideways', () => {
  it('never pins a width in px without a scroller around it', () => {
    for (const { name, body } of files) {
      /*
       * A *pinned* width only. `\b` alone matched the `w-[140px]` inside
       * `max-w-[140px]`, which is a cap — the opposite of the problem, and
       * exactly the kind of false positive that gets a guard switched off.
       */
      const pinned = body.match(/(?<![-\w])w-\[\d{3,}px\]/g) ?? [];
      if (!pinned.length) continue;
      /*
       * Whole file, not a window of the 400 characters before it.
       *
       * The window was a proximity hack that quietly assumed one component per
       * file. `hub/Rails.tsx` holds the rail track and the card as separate
       * components, so the card's `w-[300px]` sits ~30 lines below the track's
       * `overflow-x-auto` — genuinely inside the scroller, and reported as
       * overflowing the page. The first thing the widened sweep found was a
       * false positive, which is the failure mode that gets a guard deleted
       * rather than fixed.
       *
       * The cost is honest: a file containing any scroller now excuses every
       * pinned width in it. This is a regex looking at text, and it cannot see
       * which element actually contains which. It catches the case it was
       * written for — a fixed width in a file with no scroller anywhere — and
       * the real rule is checked where it is observable, in the browser at
       * 375px. See `CYCLE.md`.
       */
      const scroller = /overflow-x-auto|overflow-hidden|overflow-x-scroll/.test(body);
      expect(scroller, `${name}: ${pinned.join(', ')} with nothing to scroll it`).toBe(true);
    }
  });
});
