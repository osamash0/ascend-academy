import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLD_THRESHOLD, MAP_PALETTE } from '../SpaceMap';
import { AscentMap, ascentSpaces } from '../AscentMap';
import { allSpaces, visibleSpaces } from '../../mocks/spaces';
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
  it('reads the palette from one place instead of restating it', () => {
    /*
     * This used to assert that each file *contained* the hex literals — so it
     * required the duplication it was written to prevent, and extracting the
     * palette into `MAP_PALETTE` would have turned it red. A guard that makes
     * the fix look like a regression is worse than no guard at all.
     *
     * It now asserts the opposite: neither map may carry a raw map hex.
     */
    expect(MAP_PALETTE.goldCore).toBe('#ffcf7a');
    expect(MAP_PALETTE.hereCore).toBe('#8e99a8');
    for (const [name, body] of [
      ['SpaceMap', spaceMap.slice(spaceMap.indexOf('export function'))],
      ['AscentMap', ascent],
    ] as const) {
      expect(body, `${name} restates a palette colour`).not.toMatch(
        /#(ffcf7a|ffe9b8|8e99a8|e8edf3|5b4a2e|12151f)/i,
      );
      expect(body, `${name} does not use the shared palette`).toContain('MAP_PALETTE');
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

describe('Ascent is a night sky that shows rather than counts', () => {
  /*
   * 2026-10-26: the bodies were hollow 9px circles with "0/10" under each and
   * "0 / 2 Spaces cleared · 0/11 Lessons" above. Now each Space is a planet
   * with its real name, and the counts live only in the accessible names.
   */
  const mount = () => {
    const spaces = ascentSpaces(visibleSpaces());
    render(
      <MemoryRouter>
        <AscentMap spaces={spaces} />
      </MemoryRouter>,
    );
    return spaces;
  };

  it('draws a planet per Space, named with its real name', async () => {
    await i18n.changeLanguage('en');
    const spaces = mount();
    for (const s of spaces.slice(0, FOLD_THRESHOLD)) {
      expect(document.querySelector(`[data-planet="${s.id}"]`), `${s.id} has no planet`).toBeTruthy();
    }
    const labels = [...document.querySelectorAll('svg text')].map((t) => t.textContent ?? '');
    for (const s of spaces) {
      expect(labels.some((l) => s.name.startsWith(l.replace(/…$/, ''))), `${s.name} is not named`).toBe(true);
    }
  });

  it('prints no counters, but keeps them for screen readers', async () => {
    await i18n.changeLanguage('en');
    const { container } = render(
      <MemoryRouter>
        <AscentMap spaces={ascentSpaces(visibleSpaces())} />
      </MemoryRouter>,
    );
    const visible = [...container.querySelectorAll('text, p')].map((n) => n.textContent ?? '').join(' ');
    expect(visible).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(visible).not.toMatch(/Spaces cleared/);
    expect(screen.getByRole('group', { name: /^Your journey: \d+ of \d+ Spaces cleared/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /\d+ of \d+ Lessons cleared\.$/ }).length).toBeGreaterThan(1);
  });

  it('says "here you are" at most once, on the most recent Space', async () => {
    await i18n.changeLanguage('en');
    mount();
    expect(screen.queryAllByText('here you are').length).toBeLessThanOrEqual(1);
  });

  it('shows the legend in plain words', async () => {
    await i18n.changeLanguage('en');
    mount();
    expect(screen.getByText(/Gold: done · White: you are here · Faint: still open/)).toBeTruthy();
  });
});
