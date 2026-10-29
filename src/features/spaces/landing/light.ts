import type { CSSProperties } from 'react';
import type { Attention, LessonLight } from './types';

/**
 * Attention as light, in the Lesson's own colour.
 *
 * The console garden told urgency in teal, sand and coral. On the stage the
 * only colour is the content's, so each Lesson speaks in its own colour and
 * attention is how much of it shows: a page that needs you is that colour at
 * full strength, a calm page is close to dark. Darkness is the content
 * (Doc 2): an unlit page is a page that is landing. Under the floor there is
 * no light at all.
 */

export const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** How much of a Lesson's marker ring is drawn, 0–100. */
export const RING: Record<LessonLight, number> = { act: 100, watch: 55, calm: 28, few: 0 };

/** Below this a page's help index reads as landing: no colour, just the ground. */
const LANDING = 0.12;

/**
 * A page cell's colour, or null for the neutral ground (drawn with a class).
 * A page a finding is about is lit outright; any other page shows its help
 * index as a share of the Lesson's colour.
 */
export function cellColor(color: string, help: number, finding: Attention | null): CSSProperties | null {
  if (finding) return { background: finding === 'calm' ? mix(color, 55) : color };
  if (help > LANDING) return { background: mix(color, Math.round(help * 70)) };
  return null;
}
