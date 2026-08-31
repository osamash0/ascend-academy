import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLD_THRESHOLD } from '../SpaceMap';
import { ascentSpaces } from '../AscentMap';
import { allSpaces } from '../../mocks/spaces';
import { lessonsForSpace } from '../../mocks/lessons';

/**
 * Two maps, one set of rules.
 *
 * Abi's call, 2026-08-31: Ascent inherits Doc 2's ten map rules rather than
 * being a different visual. That is only true if something checks it — an
 * inherited rule that lives in a comment is a rule the second map will drift
 * away from the first time either is edited.
 */

const SRC = join(process.cwd(), 'src/features/spaces/components');
const read = (p: string) =>
  readFileSync(join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const spaceMap = read('SpaceMap.tsx');
const ascent = read('AscentMap.tsx');

describe('both maps mean the same thing by the same colour', () => {
  it('uses gold for earned and violet for where you are, in both', () => {
    // Rule: gold is earned, violet is present, near-black is everything you
    // have not learned. Two maps disagreeing on this is worse than one map.
    for (const [name, body] of [
      ['SpaceMap', spaceMap],
      ['AscentMap', ascent],
    ] as const) {
      expect(body, `${name} lost the gold`).toContain('#ffcf7a');
      expect(body, `${name} lost the violet`).toContain('#6c5ce7');
    }
  });

  it('puts no gradient behind either map', () => {
    /*
     * The vision file names the slop directly: "treating the cosmos as
     * texture — nebula gradients, ambient purple haze". Darkness is the
     * content. The only gradients allowed are the two body halos and the
     * edgeless wash that darkens the ground.
     */
    for (const [name, body] of [
      ['SpaceMap', spaceMap],
      ['AscentMap', ascent],
    ] as const) {
      expect(body, `${name} has a Tailwind gradient`).not.toMatch(/bg-gradient-to-/);
    }
  });
});

describe('both maps fold rather than drawing everything', () => {
  it('shares one threshold', () => {
    // Imported, not re-declared. `map.test.ts` learned this the hard way: its
    // own local copy meant raising the real one turned nothing red.
    expect(ascent).toContain('FOLD_THRESHOLD');
    expect(ascent).not.toMatch(/const\s+FOLD_THRESHOLD\s*=/);
    expect(FOLD_THRESHOLD).toBeLessThanOrEqual(20);
  });
});

describe('a body is a real target on both maps', () => {
  it('gives every body a click handler and a keyboard equivalent', () => {
    /*
     * The per-Space map's bodies carried `role="button"` and `tabIndex={0}`
     * with no handler at all — focusable, announced as buttons, inert. An SVG
     * <g> gives you neither Enter nor Space for free, so `role="button"` is a
     * promise the element cannot keep on its own.
     */
    for (const [name, body] of [
      ['SpaceMap', spaceMap],
      ['AscentMap', ascent],
    ] as const) {
      expect(body, `${name} bodies have no onClick`).toContain('onClick=');
      expect(body, `${name} bodies are not keyboard-operable`).toContain('onKeyDown=');
      expect(body, `${name} does not handle Enter`).toContain("'Enter'");
    }
  });

  it('draws a hit area larger than the visible dot', () => {
    // An 8–9px core is not a target. Both draw a transparent disc over it.
    for (const [name, body] of [
      ['SpaceMap', spaceMap],
      ['AscentMap', ascent],
    ] as const) {
      // Either spelling of "invisible" counts — SpaceMap animates its disc
      // on hover so it uses rgba(...,0); Ascent's is plainly transparent.
      expect(body, `${name} has no enlarged hit area`).toMatch(
        /fill="(transparent|rgba\(255,255,255,0\))"/,
      );
    }
  });
});

describe('Ascent draws Spaces, not Lessons', () => {
  it('only includes Spaces the viewer is actually in', () => {
    // Progress is what lights the map, and you have none in a Space you have
    // not joined — a Discover Space on your journey would always be unlit.
    for (const s of ascentSpaces(allSpaces)) {
      expect(s.viewerRole, `${s.id} is on Ascent without being joined`).not.toBeNull();
    }
  });

  it('skips Spaces with no path to light', () => {
    for (const s of ascentSpaces(allSpaces)) {
      expect(lessonsForSpace(s.id).length).toBeGreaterThan(0);
    }
  });

  it('has something to draw against the fixtures', () => {
    // A map guard that runs over an empty list passes and proves nothing.
    expect(ascentSpaces(allSpaces).length).toBeGreaterThan(1);
  });
});
