import { formatList } from '../../i18n/format';

/**
 * What a planner says, before it is said in a language.
 *
 * The planners stay pure and language-free: they return a key and what fills
 * it, and the screen says it with `t`. German orders a sentence differently,
 * so a finished English sentence cannot be translated after the fact.
 *
 * A plain string is the deck's own words — a Lesson title, an idea's name —
 * and is shown as it is. A param can itself be a phrase ("pages 31–39" inside
 * "Fading · Normalization, pages 31–39"), or a list of names, which is joined
 * the way the language joins lists ("A, B und C").
 */
export interface Phrase {
  key: string;
  params?: Record<string, string | number | string[] | Phrase>;
}

export type Words = string | Phrase;

export const phrase = (key: string, params?: Phrase['params']): Phrase => ({ key, params });

/** "page 67", or "pages 31–39". */
export const pagesPhrase = (first: number, last: number): Phrase =>
  first === last ? phrase('plan.page', { page: first }) : phrase('plan.pages', { first, last });

/** A translate function bound to the v4Space namespace — `useTranslation('v4Space').t`. */
type Translate = (key: string, params: Record<string, string | number>) => string;

/** Say it. */
export function say(t: Translate, words: Words): string {
  if (typeof words === 'string') return words;
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(words.params ?? {})) {
    params[k] = Array.isArray(v) ? formatList(v) : typeof v === 'object' ? say(t, v) : v;
  }
  return t(words.key, params);
}
