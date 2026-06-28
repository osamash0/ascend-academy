import { describe, expect, it } from 'vitest';
import type { Slide } from '@/types/domain';
import {
  allVisitedStates,
  computeCompletionPct,
  computeSlideTransition,
  countByState,
  statesFromLegacyCompleted,
} from '@/lib/slideProgress';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal Slide factory — only fields slideProgress.ts actually reads. */
function makeSlides(count: number): Slide[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `slide-${i + 1}`,
    slide_number: i + 1,
    title: `Slide ${i + 1}`,
    content_text: null,
    summary: null,
  }));
}

// ─── computeSlideTransition ───────────────────────────────────────────────────

describe('computeSlideTransition', () => {
  it('marks origin as visited and destination as current on a normal forward step', () => {
    const slides = makeSlides(5);
    const patch = computeSlideTransition(0, 1, {}, slides);
    expect(patch['1']).toBe('visited'); // slide_number 1 (index 0)
    expect(patch['2']).toBe('current'); // slide_number 2 (index 1)
    expect(Object.keys(patch)).toHaveLength(2);
  });

  it('marks skipped slides in a forward jump', () => {
    const slides = makeSlides(5);
    // Jump from index 0 to index 3 — slides at indices 1 and 2 are skipped
    const patch = computeSlideTransition(0, 3, {}, slides);
    expect(patch['1']).toBe('visited'); // origin
    expect(patch['2']).toBe('skipped'); // gap
    expect(patch['3']).toBe('skipped'); // gap
    expect(patch['4']).toBe('current'); // destination
  });

  it('does NOT downgrade visited → skipped in a forward jump', () => {
    const slides = makeSlides(5);
    const prior = { '2': 'visited' as const, '3': 'skipped' as const };
    // Jump from index 0 to index 3; slide 2 (index 1) is already visited
    const patch = computeSlideTransition(0, 3, prior, slides);
    expect(patch['2']).toBeUndefined(); // must not overwrite visited
    expect(patch['3']).toBe('skipped');
    expect(patch['4']).toBe('current');
  });

  it('only marks origin as visited on backward navigation (no skipping)', () => {
    const slides = makeSlides(5);
    const patch = computeSlideTransition(3, 1, {}, slides);
    expect(patch['4']).toBe('visited'); // origin (slide_number 4)
    expect(patch['2']).toBe('current'); // destination (slide_number 2)
    // slides at indices 2 (slide_number 3) should NOT be affected
    expect(patch['3']).toBeUndefined();
    expect(Object.keys(patch)).toHaveLength(2);
  });

  it('handles fromIndex === toIndex: destination wins (current overwrites visited)', () => {
    const slides = makeSlides(3);
    const patch = computeSlideTransition(1, 1, {}, slides);
    // origin = visited, destination = current; same slide, destination written last
    expect(patch['2']).toBe('current');
    expect(Object.keys(patch)).toHaveLength(1);
  });

  it('handles adjacent forward step (no gap to skip)', () => {
    const slides = makeSlides(4);
    const patch = computeSlideTransition(1, 2, {}, slides);
    expect(patch['2']).toBe('visited');
    expect(patch['3']).toBe('current');
    expect(Object.keys(patch)).toHaveLength(2);
  });

  it('returns empty patch if slides array is empty', () => {
    const patch = computeSlideTransition(0, 1, {}, []);
    expect(patch).toEqual({});
  });

  it('returns partial patch if toIndex is out of bounds (origin still visited)', () => {
    const slides = makeSlides(2);
    const patch = computeSlideTransition(0, 99, {}, slides);
    expect(patch['1']).toBe('visited'); // origin still visited
    // destination key for out-of-bounds index — no entry added
    expect(patch['100']).toBeUndefined();
  });

  it('handles initial slide load (fromIndex = -1 produces no fromSlide entry)', () => {
    const slides = makeSlides(3);
    const patch = computeSlideTransition(-1, 0, {}, slides);
    expect(patch['1']).toBe('current'); // destination
    // slides[-1] is undefined → no visited entry
    expect(Object.keys(patch)).toHaveLength(1);
  });
});

// ─── countByState ─────────────────────────────────────────────────────────────

describe('countByState', () => {
  it('counts each state correctly in a mixed map', () => {
    const states = {
      '1': 'visited' as const,
      '2': 'skipped' as const,
      '3': 'current' as const,
      '4': 'visited' as const,
    };
    expect(countByState(states)).toEqual({ visited: 2, skipped: 1, current: 1 });
  });

  it('returns zeros for an empty map', () => {
    expect(countByState({})).toEqual({ visited: 0, skipped: 0, current: 0 });
  });

  it('counts correctly when all slides are visited', () => {
    const states = { '1': 'visited' as const, '2': 'visited' as const };
    expect(countByState(states)).toEqual({ visited: 2, skipped: 0, current: 0 });
  });

  it('counts correctly when all slides are skipped', () => {
    const states = { '1': 'skipped' as const, '2': 'skipped' as const };
    expect(countByState(states)).toEqual({ visited: 0, skipped: 2, current: 0 });
  });

  it('handles a single current slide', () => {
    const states = { '3': 'current' as const };
    expect(countByState(states)).toEqual({ visited: 0, skipped: 0, current: 1 });
  });
});

// ─── computeCompletionPct ─────────────────────────────────────────────────────

describe('computeCompletionPct', () => {
  it('returns 0 when no slides are visited (only current/skipped)', () => {
    const states = { '1': 'current' as const, '2': 'skipped' as const };
    expect(computeCompletionPct(states, 5)).toBe(0);
  });

  it('returns 100 when all slides are visited', () => {
    const states = { '1': 'visited' as const, '2': 'visited' as const, '3': 'visited' as const };
    expect(computeCompletionPct(states, 3)).toBe(100);
  });

  it('computes partial completion correctly', () => {
    const states = { '1': 'visited' as const, '2': 'visited' as const, '3': 'current' as const };
    expect(computeCompletionPct(states, 4)).toBe(50); // 2/4 = 50%
  });

  it('rounds fractional percentages', () => {
    const states = { '1': 'visited' as const };
    // 1/3 = 33.33… → Math.round → 33
    expect(computeCompletionPct(states, 3)).toBe(33);
  });

  it('guards against totalSlides = 0 (div-by-zero protection)', () => {
    expect(computeCompletionPct({}, 0)).toBe(0);
  });

  it('does NOT count skipped slides toward completion', () => {
    const states = { '1': 'visited' as const, '2': 'skipped' as const };
    expect(computeCompletionPct(states, 4)).toBe(25); // only 1 visited out of 4
  });

  it('returns 0 for an empty states map', () => {
    expect(computeCompletionPct({}, 5)).toBe(0);
  });
});

// ─── statesFromLegacyCompleted ────────────────────────────────────────────────

describe('statesFromLegacyCompleted', () => {
  it('marks all completed slide numbers as visited', () => {
    const slides = makeSlides(5);
    const states = statesFromLegacyCompleted([1, 2, 3], 3, slides);
    expect(states['1']).toBe('visited');
    expect(states['2']).toBe('visited');
    expect(states['3']).toBe('visited');
  });

  it('marks lastSlideIndex as current when not already visited', () => {
    const slides = makeSlides(5);
    // slide at index 3 has slide_number 4, and it is NOT in completed list
    const states = statesFromLegacyCompleted([1, 2], 3, slides);
    expect(states['4']).toBe('current');
  });

  it('does NOT downgrade visited → current for the current slide', () => {
    const slides = makeSlides(3);
    // Slide at index 1 (slide_number 2) is both completed AND the current position
    const states = statesFromLegacyCompleted([2], 1, slides);
    expect(states['2']).toBe('visited'); // must not be overwritten to 'current'
  });

  it('returns empty map for empty completed array and lastSlideIndex = -1', () => {
    const slides = makeSlides(3);
    const states = statesFromLegacyCompleted([], -1, slides);
    expect(states).toEqual({});
  });

  it('ignores completed slide numbers that have no matching slide object', () => {
    const slides = makeSlides(3); // slide_numbers: 1, 2, 3
    // slide_number 99 does not exist in slides — should be ignored
    const states = statesFromLegacyCompleted([1, 99], 0, slides);
    expect(states['99']).toBeUndefined();
    expect(states['1']).toBe('visited');
  });

  it('handles empty slides array gracefully', () => {
    const states = statesFromLegacyCompleted([1, 2], 0, []);
    expect(states).toEqual({});
  });

  it('works with a single slide fully completed', () => {
    const slides = makeSlides(1);
    const states = statesFromLegacyCompleted([1], 0, slides);
    expect(states['1']).toBe('visited');
  });
});

// ─── allVisitedStates ─────────────────────────────────────────────────────────

describe('allVisitedStates', () => {
  it('marks every slide as visited', () => {
    const slides = makeSlides(4);
    const states = allVisitedStates(slides);
    expect(states['1']).toBe('visited');
    expect(states['2']).toBe('visited');
    expect(states['3']).toBe('visited');
    expect(states['4']).toBe('visited');
    expect(Object.keys(states)).toHaveLength(4);
  });

  it('returns an empty map for an empty slides array', () => {
    expect(allVisitedStates([])).toEqual({});
  });

  it('uses slide_number (not array index) as the map key', () => {
    // Non-contiguous slide numbers (e.g. after a slide was deleted)
    const slides: Slide[] = [
      { id: 'a', slide_number: 5, title: null, content_text: null, summary: null },
      { id: 'b', slide_number: 10, title: null, content_text: null, summary: null },
    ];
    const states = allVisitedStates(slides);
    expect(states['5']).toBe('visited');
    expect(states['10']).toBe('visited');
    expect(states['0']).toBeUndefined();
    expect(states['1']).toBeUndefined();
  });
});
