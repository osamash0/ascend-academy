import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Rules for the small end.
 *
 * Nothing here had been checked below `sm` before this pass. The interesting
 * finding was not an overflow — it was the per-Space map "fitting" perfectly
 * at 375px by scaling its 896-unit viewBox down by 0.36, which turned every
 * label into 4.7px of unreadable type. Fitting and working are different
 * things, and only one of them is visible in a screenshot.
 */

const SRC = join(process.cwd(), 'src/features/spaces/components');
const read = (p: string) =>
  readFileSync(join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const files = readdirSync(SRC)
  .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
  .map((f) => ({ name: f, body: read(f) }));

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

  it('carries the same five destinations, in the same order', () => {
    const keys = (src: string) =>
      [...src.matchAll(/key:\s*'(home|spaces|library|social|profile)'/g)].map((m) => m[1]);
    expect(keys(mobile)).toEqual(keys(bar));
    expect(keys(mobile)).toHaveLength(5);
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
      for (const w of pinned) {
        const at = body.indexOf(w);
        const around = body.slice(Math.max(0, at - 400), at);
        expect(
          /overflow-x-auto|overflow-hidden|overflow-x-scroll/.test(around),
          `${name}: ${w} with nothing to scroll it`,
        ).toBe(true);
      }
    }
  });
});
