import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('the pager and the companion divide the window between them', () => {
  const pager = read('LessonPager.tsx');
  const rail = read('components/reader/ReaderRail.tsx');
  const readerScreen = read('screens/ReaderScreen.tsx');

  it('gives the pager the page minus the panel, as a class Tailwind can find', () => {
    /*
     * `fixed inset-x-0` is "the whole window", and the window is the one thing
     * that does not change when a panel opens over part of it. Measured on the
     * reader at 1016px with the rail out, before this: the next card sat at
     * 664–904 against a rail starting at 632 — the entire card behind it, at
     * equal `z-30`, with nothing to click. It was still inside the rail's
     * rectangle with the dock switched off, so this is not a docking artefact
     * and moving the pager out of the transform does not fix it.
     *
     * A literal, because a class assembled from a variable is a class Tailwind
     * never emits: the DOM would read correctly, no rule would exist behind
     * it, and every test in this namespace would stay green. That has already
     * happened once here, to the dock's own clamp.
     */
    expect(pager, 'the inset is not a literal class').toContain("'sm:right-96'");
    expect(readerScreen, 'the reader never tells the pager a companion is out').toMatch(
      /companionOpen=\{railTab !== null\}/,
    );
  });

  it('switches at the width where the panel stops being the whole screen', () => {
    /*
     * A coupling nothing else holds. `ReaderRail` is `w-full sm:w-96`: below
     * `sm` it covers everything and there is no room to make. If the rail's
     * breakpoint moved and the pager's did not, the pager would carve out
     * 384px it does not need at a width where the panel is 100% wide, or fail
     * to carve it out at a width where the panel is 384.
     *
     * Both halves are read from the files rather than restated here, so the
     * assertion is that the two agree — not that either equals a number this
     * test happens to know.
     */
    const railWidth = rail.match(/\b(\w+):w-(\d+)\b/);
    const pagerInset = pager.match(/\b(\w+):right-(\d+)\b/);
    expect(railWidth, 'the rail has no responsive width any more').not.toBeNull();
    expect(pagerInset, 'the pager has no responsive inset any more').not.toBeNull();
    expect(pagerInset![1], 'the pager makes room at a different width than the rail takes it')
      .toBe(railWidth![1]);
    expect(pagerInset![2], 'the pager makes room of a different size than the rail occupies')
      .toBe(railWidth![2]);
  });

  it('takes the page out of reach at the same edge, and spells it the same way', () => {
    /*
     * A third rule hanging off `ReaderRail`'s `sm:`, and the one where being
     * wrong is an accessibility bug rather than a layout one. Below `sm` the
     * panel is the whole screen — measured at 375px, `elementFromPoint` at the
     * centre of both pager cards returns a rail descendant while both stay
     * focusable — so `ReaderScreen` marks what the rail covers `inert`. At `sm`
     * and above the article is readable beside the panel and must stay
     * selectable, or selection-to-ask disappears at desktop.
     *
     * The query is written as `min-width` — the panel case — rather than as
     * `max-width: 639.98px`, so both files name the same edge the same way and
     * there is no off-by-one to keep in step. Read from the files, not
     * restated, as with the inset above.
     */
    const railWidth = rail.match(/\b(\w+):w-\d+\b/);
    /*
     * A *standalone quoted* query, so this cannot latch onto the dock's
     * `[@media(min-width:900px)]:` Tailwind class — which it did on the first
     * run, and reported 900 with every part of the rule correct.
     */
    const inertQuery = readerScreen.match(/'\(min-width:\s*(\d+)px\)'/);
    expect(railWidth, 'the rail has no responsive width any more').not.toBeNull();
    expect(inertQuery, 'the reader no longer asks which side of the breakpoint it is on')
      .not.toBeNull();
    expect(railWidth![1], 'the rule is written against a breakpoint other than `sm`').toBe('sm');
    /*
     * `sm` is 640px and that number has to be stated once. It is stated here
     * with the thing that would invalidate it asserted beside it:
     * `tailwind.config.ts` sets `screens` only inside `container`, which
     * narrows the centring wrapper and does not move a variant. An override in
     * `theme.screens` or `theme.extend.screens` would silently decouple the
     * query from the class, and nothing else would notice.
     */
    const tw = readFileSync(join(process.cwd(), 'tailwind.config.ts'), 'utf8');
    expect(tw, 'a screens override could move `sm` out from under this query')
      .not.toMatch(/['"]?sm['"]?\s*:\s*['"]\d+px['"]/);
    expect(inertQuery![1], 'the inert rule switches at a width `sm` does not').toBe('640');
  });

  it('keeps the pager out of the wrapper the dock moves', () => {
    /*
     * A transformed ancestor becomes the containing block for its
     * `position: fixed` descendants, so the pager — written inside `<article>`
     * — was dragged 192px left with the column. Measured at 1016px: the
     * previous card ran from −272 to −32, entirely off the window, and content
     * left of the origin creates no scroll area, so it was unreachable rather
     * than merely out of sight.
     *
     * Checked as a fact about the source's shape because jsdom has no layout
     * and cannot see a containing block: the pager is passed to `readerChrome`
     * as the floating argument, and `</article>` closes before it.
     */
    const pagerAt = readerScreen.indexOf('<LessonPager');
    const articleEnds = readerScreen.indexOf('</article>');
    expect(pagerAt, 'the reader no longer mounts the pager').toBeGreaterThan(-1);
    expect(articleEnds, 'the reader no longer renders an article').toBeGreaterThan(-1);
    expect(pagerAt, 'the pager is back inside the column the dock transforms')
      .toBeGreaterThan(articleEnds);
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
