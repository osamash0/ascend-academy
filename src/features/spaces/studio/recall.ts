import type { CanvasBlock } from './types';

/** What you remember of one key term: untouched, looked at, or marked. */
export type TermState = 'blank' | 'seen' | 'knew' | 'notYet';
export interface RecallState {
  on: boolean;
  terms: Record<string, TermState>;
}

export const termKey = (blockId: string, index: number) => `${blockId}:${index}`;

/** The **term** texts of a summary, in order. */
export function termsIn(markdown: string): string[] {
  return Array.from(markdown.matchAll(/\*\*(.+?)\*\*/g), (m) => m[1]);
}

export const stateOf = (s: RecallState, key: string): TermState => s.terms[key] ?? 'blank';

export const mark = (s: RecallState, key: string, t: TermState): RecallState => ({
  ...s,
  terms: { ...s.terms, [key]: t },
});

/** Progress of the calm summary only: written, extracted and generated blocks carry no recall terms. */
export function pageProgress(blocks: CanvasBlock[], s: RecallState): { knew: number; total: number } {
  let knew = 0;
  let total = 0;
  for (const b of blocks) {
    if (b.origin !== 'summary') continue;
    termsIn(b.markdown).forEach((_, i) => {
      total += 1;
      if (stateOf(s, termKey(b.id, i)) === 'knew') knew += 1;
    });
  }
  return { knew, total };
}

export const tryAgain = (s: RecallState): string[] =>
  Object.keys(s.terms).filter((k) => s.terms[k] === 'notYet');

export function retry(s: RecallState): RecallState {
  const terms: Record<string, TermState> = {};
  for (const [k, v] of Object.entries(s.terms)) terms[k] = v === 'notYet' ? 'blank' : v;
  return { ...s, terms };
}

export const reset = (s: RecallState): RecallState => ({ ...s, terms: {} });
