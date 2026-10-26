import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MAX_MOONS, Planet, moonStates, planetSize } from '../sky/Planet';
import { StarField, starsFor } from '../sky/StarField';
import { PLANET_TONES, toneFor } from '../sky/seed';
import { FOLD_THRESHOLD, MAP_PALETTE } from '../SpaceMap';
import { allSpaces } from '../../mocks/spaces';

/**
 * The night sky's two pieces: a planet whose moons are Lessons, and the stars
 * behind it. The palette is the map's — gold earned, white "you are here",
 * faint everything else — and nothing is counted on screen; the numbers live
 * in the accessible name.
 */

const moons = (root: ParentNode = document) => [...root.querySelectorAll('[data-moon]')];
const byState = (state: string) => moons().filter((m) => m.getAttribute('data-moon') === state);

describe('a planet’s moons are its Lessons', () => {
  it('draws one moon per Lesson, gold for done, one white for here, faint for open', () => {
    render(<Planet size={80} lessonCount={10} lessonsDone={3} current glow={0.3} seed="dbs" />);
    expect(moons()).toHaveLength(10);
    expect(byState('done')).toHaveLength(3);
    expect(byState('current')).toHaveLength(1);
    expect(byState('open')).toHaveLength(6);
    for (const m of byState('done')) expect(m.getAttribute('fill')).toBe(MAP_PALETTE.goldCore);
    const here = byState('current')[0];
    expect(here.getAttribute('fill')).toBe(MAP_PALETTE.hereRim);
    expect(Number(here.getAttribute('fill-opacity'))).toBe(1);
    for (const m of byState('open')) expect(Number(m.getAttribute('fill-opacity'))).toBeLessThan(0.3);
  });

  it('has no "you are here" moon unless asked, and none once every Lesson is done', () => {
    expect(moonStates(10, 3, false)).not.toContain('current');
    expect(moonStates(10, 10, true)).not.toContain('current');
    expect(moonStates(10, 10, true).every((s) => s === 'done')).toBe(true);
  });

  it('folds past 24 Lessons, keeping the proportion', () => {
    render(<Planet size={80} lessonCount={60} lessonsDone={30} current glow={0.5} seed="big" />);
    expect(moons()).toHaveLength(MAX_MOONS);
    expect(byState('done')).toHaveLength(12);
    expect(byState('current')).toHaveLength(1);
  });

  it('never rounds unfinished up to finished, nor some progress down to none', () => {
    expect(moonStates(100, 99, false).filter((s) => s === 'done')).toHaveLength(MAX_MOONS - 1);
    expect(moonStates(100, 1, false).filter((s) => s === 'done')).toHaveLength(1);
  });

  it('never caps moons below what a route shows', () => {
    expect(MAX_MOONS).toBeGreaterThanOrEqual(FOLD_THRESHOLD);
  });

  it('draws no number at all', () => {
    const { container } = render(
      <Planet size={80} lessonCount={10} lessonsDone={3} glow={0.3} seed="dbs" label="x" />,
    );
    expect(container.querySelector('text')).toBeNull();
    expect(container.textContent).toBe('');
  });
});

describe('a planet is named for screen readers, or hidden', () => {
  it('is an image with the counts in its name when labelled', () => {
    render(
      <Planet
        size={80}
        lessonCount={10}
        lessonsDone={3}
        glow={0.3}
        seed="dbs"
        label="Datenbanksysteme. 3 of 10 Lessons done."
      />,
    );
    expect(screen.getByRole('img', { name: 'Datenbanksysteme. 3 of 10 Lessons done.' })).toBeTruthy();
  });

  it('is decoration when unlabelled, because its control carries the name', () => {
    const { container } = render(<Planet size={40} lessonCount={4} lessonsDone={0} glow={0} seed="a" />);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('progress is what lights a planet', () => {
  it('draws no halo with no progress, and a stronger one with more', () => {
    const { container, rerender } = render(
      <Planet size={80} lessonCount={10} lessonsDone={0} glow={0} seed="dbs" />,
    );
    expect(container.querySelector('[data-halo]')).toBeNull();
    rerender(<Planet size={80} lessonCount={10} lessonsDone={2} glow={0.2} seed="dbs" />);
    const low = Number(container.querySelector('[data-halo]')!.getAttribute('opacity'));
    rerender(<Planet size={80} lessonCount={10} lessonsDone={9} glow={0.9} seed="dbs" />);
    const high = Number(container.querySelector('[data-halo]')!.getAttribute('opacity'));
    expect(high).toBeGreaterThan(low);
  });
});

describe('planet size', () => {
  it('grows with Lessons on a square-root scale and stays in range', () => {
    expect(planetSize(0, 36, 72)).toBe(36);
    expect(planetSize(MAX_MOONS, 36, 72)).toBe(72);
    expect(planetSize(500, 36, 72)).toBe(72);
    // A quarter of the Lessons is half the extra width, not a quarter.
    expect(planetSize(MAX_MOONS / 4, 36, 72)).toBe(54);
  });
});

describe('the same Space is the same planet always', () => {
  it('picks a body tone from the id, not from list order', () => {
    const forward = allSpaces.map((s) => toneFor(s.id));
    const backward = [...allSpaces].reverse().map((s) => toneFor(s.id));
    expect(backward.reverse()).toEqual(forward);
    for (const tone of forward) expect(PLANET_TONES).toContain(tone);
    expect(new Set(forward).size).toBeGreaterThan(1);
  });
});

describe('the star field', () => {
  it('is the same sky on every render', () => {
    expect(starsFor('hub', 60)).toEqual(starsFor('hub', 60));
    expect(starsFor('hub', 60)).not.toEqual(starsFor('profile', 60));
  });

  it('stays faint and out of the way', () => {
    for (const s of starsFor('hub', 80)) {
      expect(s.o).toBeGreaterThanOrEqual(0.25);
      expect(s.o).toBeLessThanOrEqual(0.6);
    }
    const { container } = render(<StarField seed="hub" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('class')).toContain('pointer-events-none');
    expect(svg.querySelectorAll('circle').length).toBe(60);
  });
});
