import { describe, expect, it } from 'vitest';
import { allSources } from './sources';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A snapping track must reserve its own gutter.
 *
 * The defect this exists to prevent, in full: the hub's rails have
 * `padding-left: 64px` so the first card lines up under its heading, and
 * `snap-x snap-mandatory` so cards come to rest on edges. Those two are not
 * independent. A mandatory track must rest on a snap point, and `snap-start`
 * aligns a card's leading edge to the *scrollport* edge — the padding box, not
 * the content box. So the browser scrolled each rail by exactly its
 * `padding-left` on mount to satisfy the snap, and the gutter vanished: the
 * first card sat flush at x=0 under a heading at x=64, and the last card was
 * clipped.
 *
 * `scroll-padding-left` insets the snapport so that scrollLeft=0 *is* a snap
 * point. The two values have to agree, and nothing else in the suite compares
 * them — which is how they came apart in the first place.
 *
 * Two reasons this is a source guard rather than a render test. jsdom
 * implements no scroll-snap geometry at all, so a render test would pass with
 * the bug fully present. And the failure was invisible on the one rail that
 * happens to fit its viewport: "New this week" never overflows, never snaps,
 * and looked correct the whole time — so measuring one rail, which is what I
 * did, could not see it.
 */

const files = allSources();

const read = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** Pulls the `sm:`-prefixed and bare values out of a Tailwind spacing group. */
const spacing = (classes: string, prefix: string) => {
  const found: Record<string, string> = {};
  for (const m of classes.matchAll(
    new RegExp(`(?:(sm|md|lg):)?${prefix}-(\\[[^\\]]+\\]|[\\w.]+)`, 'g'),
  )) {
    found[m[1] ?? 'base'] = m[2];
  }
  return found;
};

describe('a snapping track reserves its gutter', () => {
  it('never combines horizontal snap with padding and no scroll-padding', () => {
    const offenders: string[] = [];
    for (const { name, body } of files) {
      const src = body;
      if (!/overflow-x-auto/.test(src)) continue;
      if (!/\bsnap-x\b/.test(src)) continue;
      // A track with no left padding has no gutter to lose.
      if (!/\bp[xl]-/.test(src)) continue;
      if (!/\bscroll-p[xl]-/.test(src)) {
        offenders.push(`${name}: snap-x + padding with no scroll-padding`);
      }
    }
    expect(
      offenders,
      `snapping tracks whose gutter the snap will eat:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps the rails scroll-padding in step with their padding, breakpoint by breakpoint', () => {
    /*
     * The generic check above only asks that *some* scroll-padding exists. This
     * one asserts the numbers match at every breakpoint, because a mismatched
     * pair is the same bug with a smaller offset — and the mobile gutter
     * (`22px`) and desktop gutter (`16` = 64px) differ, so there are two to
     * keep in step, not one.
     */
    const rails = read(join(process.cwd(), 'src/features/spaces/components/hub/Rails.tsx'));

    const gutter = rails.match(/const GUTTER = '([^']+)'/)?.[1];
    const scrollGutter = rails.match(/const SCROLL_GUTTER =\s*'([^']+)'/)?.[1];

    expect(gutter, 'Rails.tsx no longer defines GUTTER — this guard is now blind').toBeTruthy();
    expect(
      scrollGutter,
      'Rails.tsx no longer defines SCROLL_GUTTER — the snap will eat the gutter',
    ).toBeTruthy();

    const pad = spacing(gutter!, 'px');
    const scrollPad = spacing(scrollGutter!, 'scroll-pl');

    expect(Object.keys(pad).length, 'GUTTER declares no padding at all').toBeGreaterThan(0);
    expect(Object.keys(scrollPad).sort(), 'the two differ in which breakpoints they cover').toEqual(
      Object.keys(pad).sort(),
    );
    for (const bp of Object.keys(pad)) {
      expect(
        scrollPad[bp],
        `at "${bp}": padding is ${pad[bp]} but scroll-padding is ${scrollPad[bp]}`,
      ).toBe(pad[bp]);
    }
  });

  it('applies the scroll gutter to the track, not just declares it', () => {
    // The constant existing is not the same as it being used — a dangling
    // `const` satisfied an earlier guard in this suite for exactly this reason.
    const rails = read(join(process.cwd(), 'src/features/spaces/components/hub/Rails.tsx'));
    const track = rails.match(/'gap-4 overflow-x-auto[^}]*?\)/s)?.[0] ?? '';
    expect(track, 'could not find the rail track className — guard needs updating').toContain(
      'overflow-x-auto',
    );
    expect(track, 'SCROLL_GUTTER is defined but not applied to the track').toContain(
      'SCROLL_GUTTER',
    );
  });
});
