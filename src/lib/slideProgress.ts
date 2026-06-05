/**
 * Pure, framework-free utilities for the four-state slide progress system.
 *
 * Four states a slide can be in:
 *   visited   — student explicitly navigated through it
 *   skipped   — student jumped past it (gap in forward navigation)
 *   current   — the slide they are on right now
 *   unvisited — absent from the map (default)
 *
 * These functions are unit-testable with no React dependency.
 */
import type { Slide, SlideState } from '@/types/domain';

// ─── Core transition engine ───────────────────────────────────────────────────

/**
 * Compute the state patch produced by navigating from `fromIndex` to `toIndex`.
 *
 * Rules:
 *   - The origin slide is marked `visited` (we just left it).
 *   - The destination slide is marked `current`.
 *   - Any slides jumped over forward are marked `skipped` UNLESS they are
 *     already `visited` (never downgrade visited → skipped).
 *   - Backward navigation never changes states (only origin → visited applies).
 *
 * Returns a partial patch to merge into the existing slideStates map.
 */
export function computeSlideTransition(
  fromIndex: number,
  toIndex: number,
  currentStates: Record<string, SlideState>,
  slides: Slide[],
): Record<string, SlideState> {
  const patch: Record<string, SlideState> = {};

  // Mark the slide we just left as visited
  const fromSlide = slides[fromIndex];
  if (fromSlide) {
    patch[String(fromSlide.slide_number)] = 'visited';
  }

  // Mark the destination as current
  const toSlide = slides[toIndex];
  if (toSlide) {
    patch[String(toSlide.slide_number)] = 'current';
  }

  // Forward jump: mark the gap as skipped (never downgrade visited → skipped)
  if (toIndex > fromIndex + 1) {
    for (let i = fromIndex + 1; i < toIndex; i++) {
      const gapSlide = slides[i];
      if (!gapSlide) continue;
      const key = String(gapSlide.slide_number);
      if (currentStates[key] !== 'visited') {
        patch[key] = 'skipped';
      }
    }
  }

  return patch;
}

// ─── Derived statistics ───────────────────────────────────────────────────────

export function countByState(states: Record<string, SlideState>) {
  let visited = 0;
  let skipped = 0;
  let current = 0;
  for (const v of Object.values(states)) {
    if (v === 'visited') visited++;
    else if (v === 'skipped') skipped++;
    else if (v === 'current') current++;
  }
  return { visited, skipped, current };
}

/**
 * Completion percentage based ONLY on `visited` slides.
 * Skipped slides do not count toward completion.
 */
export function computeCompletionPct(
  states: Record<string, SlideState>,
  totalSlides: number,
): number {
  if (totalSlides === 0) return 0;
  const { visited } = countByState(states);
  return Math.round((visited / totalSlides) * 100);
}

// ─── Legacy migration helper ─────────────────────────────────────────────────

/**
 * Build a `slide_states` map from the old `completed_slides INTEGER[]` column.
 *
 * Used for students who have progress rows without `slide_states` yet.
 * The old system incorrectly marked slides 1..N as completed whenever the
 * student was on slide N, so we trust the array as-is and call all entries
 * `visited`.  The current slide is marked `current` unless already visited.
 */
export function statesFromLegacyCompleted(
  completedSlides: number[],
  lastSlideIndex: number,
  slides: Slide[],
): Record<string, SlideState> {
  const states: Record<string, SlideState> = {};
  const completedSet = new Set(completedSlides);

  for (const slide of slides) {
    if (completedSet.has(slide.slide_number)) {
      states[String(slide.slide_number)] = 'visited';
    }
  }

  // Mark the current slide (don't downgrade visited → current)
  const currentSlide = slides[lastSlideIndex];
  if (currentSlide) {
    const key = String(currentSlide.slide_number);
    if (states[key] !== 'visited') {
      states[key] = 'current';
    }
  }

  return states;
}

// ─── All-visited map (used by lecture completion) ────────────────────────────

export function allVisitedStates(slides: Slide[]): Record<string, SlideState> {
  const states: Record<string, SlideState> = {};
  for (const s of slides) {
    states[String(s.slide_number)] = 'visited';
  }
  return states;
}
