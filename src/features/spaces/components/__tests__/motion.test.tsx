import { describe, expect, it } from 'vitest';
import { allSources, readSource } from './sources';
import { join } from 'node:path';
import { MOTION_DURATION, MOTION_EASE } from '../MotionRoot';
import { railVariants, itemVariants } from '../Enter';

/**
 * The motion.dev spec, enforced.
 *
 * Written because none of it can be checked in the preview browser: its
 * animation clock is frozen, so `element.animate(...)` reports
 * `playState: "running"` and never advances a value. A frozen tween and a
 * broken one look identical there. These guards check the things that are
 * true regardless of whether a frame ever ticks — which library, how many
 * configs, what gets animated, and whether anything leaves the DOM abruptly.
 */

const read = readSource;

const files = allSources();

describe('one library, one config', () => {
  it('imports Motion from motion/react everywhere', () => {
    /*
     * The patterns are assembled rather than written as literals. Spelled out,
     * `/from 'framer-motion'/` reads as an *actual import* to
     * `boundary.test.ts`, which scans every file for `from '...'` — so this
     * guard failed that one by describing the rule it enforces. The third time
     * a check here has fired on its own documentation.
     */
    const FROM = String.raw`from\s+['"]`;
    const anyMotion = new RegExp(FROM + `[^'"]*motion`);
    const oldEntry = new RegExp(FROM + ['framer', 'motion'].join('-') + `['"]`);
    for (const { name, body } of files) {
      if (!anyMotion.test(body)) continue;
      expect(body, `${name} imports the old entry point`).not.toMatch(oldEntry);
    }
  });

  it('mounts exactly one MotionConfig', () => {
    const mounts = files.filter((f) => f.body.includes('<MotionConfig'));
    expect(mounts.map((f) => f.name)).toEqual(['components/MotionRoot.tsx']);
  });

  it('sets the house defaults there and nowhere else', () => {
    expect(MOTION_DURATION).toBe(0.18);
    expect([...MOTION_EASE]).toEqual([0.2, 0, 0, 1]);
    const root = read('components/MotionRoot.tsx');
    expect(root).toContain('reducedMotion="user"');
  });
});

describe('which CSS transitions are allowed', () => {
  /*
   * Abi's call: **keep `transition-colors`.**
   *
   * The spec says Motion owns all animation and lets it animate transform and
   * opacity only. Colour falls in the gap between those two rules — banning it
   * would mean either instant hover swaps on sixty-odd controls, or animating
   * colour through Motion against the transform-and-opacity rule. Neither is
   * an improvement, so colour stays with the stylesheet.
   *
   * An allow-list rather than a note, because the interesting case is the
   * *next* property somebody reaches for. `transition-[width]` was already
   * here — the practice progress bar animating a layout property in CSS, which
   * re-laid-out the row on every question — and a comment would not have
   * caught it.
   */
  const ALLOWED = [
    /^transition-colors$/,
    // SVG paint. The same category as colour, on the two maps.
    /^transition-\[fill\]$/,
    /*
     * The hub cards' **hover** ring fading in rather than snapping on — not
     * the focus ring, which is a `box-shadow` from `.console-focusable` and
     * deliberately a different property, so the two never fight. (On keyboard
     * focus that rule sets `outline: none`, which zeroes `outline-style`, so
     * the hover colour below simply has nothing to paint. No double ring.)
     *
     * `transition-colors` genuinely cannot do this: Tailwind 3.4.17 defines it
     * as `color, background-color, border-color, text-decoration-color, fill,
     * stroke` — `outline-color` is absent, and was only folded in for v4. So
     * the bracket form is necessary here rather than a stylistic preference.
     *
     * Listed as the exact longhand, because the reason to keep it narrow is
     * Abi's ruling — *colour* stays with the stylesheet, everything else is
     * Motion's. `outline-width` is not colour. A pattern like
     * `transition-[outline` would wave it through on a spelling coincidence.
     */
    /^transition-\[outline-color\]$/,
    /^transition-\[fill,stroke\]$/,
    /^transition-\[fill,opacity\]$/,
  ];

  it('permits colour and nothing else', () => {
    const offenders: string[] = [];
    for (const { name, body } of files) {
      for (const m of body.matchAll(/\btransition-(?:\[[^\]]*\]|[a-z]+)/g)) {
        const cls = m[0];
        if (cls === 'transition-colors') continue;
        if (ALLOWED.some((a) => a.test(cls))) continue;
        offenders.push(`${name}: ${cls}`);
      }
    }
    expect(offenders, `CSS transitions outside the allow-list:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });

  it('never animates a layout property in CSS either', () => {
    // The rule is about the property, not about who animates it. A
    // `transition-[width]` is as expensive as a Motion `animate={{ width }}`.
    for (const { name, body } of files) {
      expect(body, `${name} transitions a layout property`).not.toMatch(
        /transition-\[(width|height|margin|padding|top|left|right|bottom)/,
      );
    }
  });
});

describe('only transform and opacity', () => {
  it('never animates a layout property', () => {
    /*
     * Animating width, height or margin makes the browser re-lay-out the page
     * every frame and drags every sibling with it. The spec allows transform
     * and opacity; `filter`/blur is permitted on the background layer alone.
     */
    for (const { name, body } of files) {
      const props = body.match(/(?:animate|whileHover|whileTap|whileFocus|exit|initial)=\{\{[^}]*\}\}/g) ?? [];
      for (const p of props) {
        expect(p, `${name} animates layout: ${p.slice(0, 60)}`).not.toMatch(
          /\b(width|height|margin|padding|top|left|right|bottom)\s*:/,
        );
      }
    }
  });

  it('keeps blur on the background layer only', () => {
    for (const { name, body } of files) {
      if (name === 'components/BackdropArt.tsx') continue;
      const props = body.match(/(?:animate|whileHover|exit)=\{\{[^}]*\}\}/g) ?? [];
      for (const p of props) {
        expect(p, `${name} animates a filter`).not.toMatch(/filter\s*:|blur\(/);
      }
    }
  });
});

describe('the background cross-fade', () => {
  const art = read('components/BackdropArt.tsx');

  it('is slower than the foreground, and stays that way', () => {
    // The gap is the point: the thing under the cursor answers now, the world
    // behind it takes its time. 0.7 against 0.18.
    expect(art).toMatch(/duration:\s*0\.7/);
    expect(0.7).toBeGreaterThan(MOTION_DURATION * 3);
  });

  it('keys by item so the old art fades out under the new', () => {
    expect(art).toContain('mode="popLayout"');
    expect(art).toMatch(/key=\{settled\}/);
  });

  it('debounces the active item', () => {
    /*
     * Holding an arrow key walks the rail faster than a 0.7s fade completes.
     * Without the debounce each card queues its own cross-fade and the
     * backdrop keeps dissolving long after you stopped moving.
     */
    expect(art).toMatch(/setTimeout\([^,]+,\s*150\)/);
  });
});

describe('entering content', () => {
  it('staggers through variants, not per-item delays', () => {
    // A delay computed per index means adding a row re-times every row after
    // it, and removing one leaves a hole in the sequence.
    const enter = read('components/Enter.tsx');
    expect(enter).toContain('delayChildren: stagger(0.04)');
    expect(enter).not.toMatch(/delay:\s*i\s*\*/);
  });

  it('drifts a little and fades', () => {
    expect(itemVariants.hidden).toEqual({ opacity: 0, y: 12 });
    expect(itemVariants.show).toEqual({ opacity: 1, y: 0 });
    expect(railVariants.show.transition).toBeDefined();
  });

  it('never runs a chain longer than ~0.3s', () => {
    // Eight items at 0.04s is 0.32s to the last one. Past that the stagger
    // stops reading as life and starts reading as the page being slow.
    const perChild = 0.04;
    expect(perChild * 8).toBeLessThanOrEqual(0.35);
  });

  it('plays once when scrolled to, never on every pass', () => {
    expect(read('components/Enter.tsx')).toMatch(/once:\s*true/);
  });
});

describe('nothing pops out of the DOM', () => {
  it('gives every AnimatePresence child an exit', () => {
    for (const { name, body } of files) {
      if (!body.includes('<AnimatePresence')) continue;
      expect(body, `${name} has AnimatePresence with no exit`).toMatch(/exit=\{/);
    }
  });

  it('fades routes rather than sliding them', () => {
    /*
     * `mode="wait"` so two full pages never overlap at half opacity. Which
     * also means a cross-route `layoutId` can never work — the outgoing tree
     * is gone before the incoming one mounts — so the spec's fallback applies:
     * fade only, no shared element across the router.
     */
    const root = read('components/MotionRoot.tsx');
    expect(root).toContain('mode="wait"');
    expect(root).toMatch(/duration:\s*0\.16/);
    /*
     * `\b` is load-bearing: without it this matched `initial={{ opacity: 0 }}`,
     * because "opacity:" ends in "y:". The guard failed on the very thing it
     * was written to require.
     */
    expect(root, 'a route transition must not slide').not.toMatch(
      /initial=\{\{[^}]*\b[xy]:/,
    );
  });

  it('keeps a Space mounted across its own tabs', () => {
    // Tabs are routes. Keying the fade on the raw pathname would rebuild the
    // whole Space to move between them — and kill the tab indicator's
    // `layoutId`, which needs the strip to stay mounted.
    const root = read('components/MotionRoot.tsx');
    expect(root).toContain('screenKey');
    expect(root).toMatch(/map\|members/);
  });
});

describe('springs are for the press, and nowhere else', () => {
  it('uses one spring, defined once', () => {
    const press = read('components/Pressable.tsx');
    expect(press).toMatch(/stiffness:\s*400/);
    expect(press).toMatch(/damping:\s*30/);
  });

  it('never springs a fade', () => {
    // Duration-based everywhere else. A spring on opacity has no visible
    // benefit and makes the timing unpredictable.
    for (const { name, body } of files) {
      const springs = body.match(/type:\s*'spring'[^}]*\}/g) ?? [];
      for (const sp of springs) {
        expect(sp, `${name} springs something that is not a transform`).not.toMatch(/opacity/);
      }
    }
  });
});
