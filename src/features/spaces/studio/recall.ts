import type { CanvasBlock } from './types';

/** What you remember of one key term: untouched, looked at, or marked. */
export type TermState = 'blank' | 'seen' | 'knew' | 'notYet';
export interface RecallState {
  on: boolean;
  terms: Record<string, TermState>;
}

export const termKey = (blockId: string, index: number) => `${blockId}:${index}`;

const CH = String.raw`[^*\\`+"`"+String.raw`_\[\]<>&]`;
const EDGE = String.raw`[^*\s\\`+"`"+String.raw`_\[\]<>&]`;
const BODY = `${EDGE}(?:(?:(?!\\n[ \\t]*\\n)${CH})*${EDGE})?`;
const TERM_SCAN = new RegExp(String.raw`\*\*(${BODY})\*\*`, 'g');
const TERM_WHOLE = new RegExp(`^${EDGE}(?:${CH}*${EDGE})?$`);
/** Whether rendered bold text is a recall term (the renderer and termsIn share this rule). */
export const isPlainTerm = (text: string) => TERM_WHOLE.test(text);

/**
 * The key terms of a summary, in order: exactly the `**term**` spans the
 * renderer turns into RecallTerms. Code spans and fences are not terms, bold
 * may wrap a line, and a term is plain text (bold holding other markup stays
 * ordinary bold, and so does the renderer: see Markdown's rehype stamp).
 */
export function termsIn(markdown: string): string[] {
  const text = markdown
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[`~]*[ \t]*(?=\n|$)|$)/gm, ' ')
    .replace(/(`+)[\s\S]*?\1/g, ' ');
  const out: string[] = [];
  for (const m of text.matchAll(TERM_SCAN)) out.push(m[1].replace(/\s*\n\s*/g, ' '));
  return out;
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
