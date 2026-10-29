import type { LandingInsight } from './types';

/** The translator, narrowed to what the copy needs (keeps `i18next` itself outside the seal). */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * A finding's words, from its kind and its numbers.
 *
 * The engine says what it found; this says it the way the room talks — in
 * pages, Lessons, people and checkpoints, and in the viewer's language. Kept
 * out of the components so a card is a layout, not a sentence.
 */
export interface CardCopy {
  headline: string;
  summary: string;
  why: string;
}

export function cardCopy(t: Translate, insight: LandingInsight, lesson: string): CardCopy {
  const m = insight.metrics;
  const values: Record<string, string | number> = { ...m, lesson, page: insight.page ?? '', first: insight.first ?? '', last: insight.last ?? '' };
  if (insight.kind === 'overpacked' && typeof m.ratio === 'number') values.ratio = m.ratio.toFixed(1);
  return {
    headline: t(`kind.${insight.kind}.headline`, values),
    summary: t(`kind.${insight.kind}.summary`, values),
    why: t(`kind.${insight.kind}.why`, values),
  };
}

/** The feed's lede: the loudest finding sets the tone. */
export function ledeKey(insights: LandingInsight[], readers: number, floor: number): 'act' | 'watch' | 'calm' | 'floor' {
  if (readers < floor) return 'floor';
  if (insights.some((i) => i.attention === 'act')) return 'act';
  if (insights.some((i) => i.attention === 'watch')) return 'watch';
  return 'calm';
}
