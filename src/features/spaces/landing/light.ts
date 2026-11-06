import type { CSSProperties } from 'react';
import type { Attention, LandingLesson, LessonLight } from './types';

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
 * A page cell's colour, or null for no colour (drawn with a class: the dark
 * ground for a landing page, an outline for a page with nothing to say yet).
 * A page a finding is about is lit outright; any other page shows its help
 * index as a share of the Lesson's colour. A page fewer than the floor have
 * reached (`help` null) never takes a colour.
 */
export function cellColor(color: string, help: number | null, finding: Attention | null): CSSProperties | null {
  if (finding) return { background: finding === 'calm' ? mix(color, 55) : color };
  if (help !== null && help > LANDING) return { background: mix(color, Math.round(help * 70)) };
  return null;
}

/** Does this Lesson have a page too few people have reached? Such a Lesson is drawn with an outline and never folds as landing. */
export function hasOutline(lesson: LandingLesson): boolean {
  return Boolean(lesson.help?.some((h) => h === null));
}
