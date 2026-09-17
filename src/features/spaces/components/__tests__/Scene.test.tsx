import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Scene, SURFACES } from '../Scene';

/**
 * Guard: switching surface must never remount the tree.
 *
 * The bug this exists for: `Scene` used to return a plain wrapper for `focus`
 * and a `DepthScene` for `browse`. Two different component types at the same
 * position, so React tore the whole subtree down and rebuilt it on every
 * switch — top bar included. Moving from a Space's Overview to its Map read as
 * a full page refresh.
 *
 * A remount is invisible to a snapshot test: the markup is identical before
 * and after. What changes is *node identity*. So that is what this asserts —
 * the very same DOM node must survive the switch.
 */

const Probe = () => <div data-testid="probe">content</div>;

describe('Scene', () => {
  it('keeps the same DOM node when the surface changes', () => {
    const { getByTestId, rerender } = render(
      <Scene surface={SURFACES.spaceOverview}>
        <Probe />
      </Scene>,
    );
    const before = getByTestId('probe');

    // Overview → Map: browse to focus, the switch that caused the flash.
    rerender(
      <Scene surface={SURFACES.map}>
        <Probe />
      </Scene>,
    );
    const after = getByTestId('probe');

    expect(after, 'the subtree remounted — the ground must change, not the tree').toBe(
      before,
    );
  });

  it('survives a switch back without remounting either', () => {
    const { getByTestId, rerender } = render(
      <Scene surface={SURFACES.map}>
        <Probe />
      </Scene>,
    );
    const first = getByTestId('probe');
    rerender(
      <Scene surface={SURFACES.spaceOverview}>
        <Probe />
      </Scene>,
    );
    rerender(
      <Scene surface={SURFACES.map}>
        <Probe />
      </Scene>,
    );
    expect(getByTestId('probe')).toBe(first);
  });

  it('renders a blackout layer that carries the focus ground', () => {
    // The mechanism the test above depends on: one tree, and a layer whose
    // opacity does the work. If this disappears, the first test would pass
    // while the ground stopped changing at all.
    const { container } = render(
      <Scene surface={SURFACES.map}>
        <Probe />
      </Scene>,
    );
    const blackout = container.querySelector('[aria-hidden].fixed.inset-0');
    expect(blackout, 'no blackout layer — the focus ground is not being applied').not.toBeNull();
  });

  it('classifies every known screen as exactly browse or focus', () => {
    // Stops a new screen being added without a deliberate decision about
    // whether the cosmic theme is spent on it.
    for (const [screen, surface] of Object.entries(SURFACES)) {
      expect(['browse', 'focus'], `${screen} has no surface`).toContain(surface);
    }
    // The map must never drift back to a textured ground: "darkness is the
    // content" is unbuildable on a gradient.
    expect(SURFACES.map).toBe('focus');
    expect(SURFACES.lessonReader).toBe('focus');
  });
});
