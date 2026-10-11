import { memo, type ReactNode } from 'react';
import { Streamdown, defaultRehypePlugins } from 'streamdown';
import { cn } from '@/lib/utils';
import { RecallTerm } from './RecallTerm';
import { termKey, termsIn, type TermState } from '../recall';

/**
 * Streamdown's defaults include rehype-raw, which parses raw HTML out of the
 * text. Material text and model output are untrusted, so raw HTML is dropped
 * (the remark side then keeps it as plain text) and only sanitize + harden stay.
 */
const REHYPE_PLUGINS = [defaultRehypePlugins.sanitize, defaultRehypePlugins.harden];
/**
 * Images are off: a remote image is a fetch to someone else's server, a way
 * to leak what the student is reading. The Material's own pages are shown by
 * the Peek and the original view, never through Markdown.
 */
const NO_ELEMENTS = ['img'];

/**
 * The one renderer (spec §3.4). The clean page, AI answers and created items
 * all go through it, so the Material and the assistant read as one surface.
 */
export interface MarkdownRecall {
  blockId: string;
  page: number;
  get(key: string): TermState;
  onReveal(key: string): void;
  onMark(key: string, t: 'knew' | 'notYet'): void;
}

const textOf = (n: ReactNode): string =>
  typeof n === 'string' || typeof n === 'number'
    ? String(n)
    : Array.isArray(n)
      ? n.map(textOf).join('')
      : '';

export const Markdown = memo(function Markdown({
  children,
  className,
  recall,
}: {
  children: string;
  className?: string;
  /** Key terms (**term**) render as RecallTerms, keyed `blockId:n` in reading order. */
  recall?: MarkdownRecall;
}) {
  let components;
  if (recall) {
    // The n-th occurrence of a text maps to the index of that occurrence among all terms.
    const order = termsIn(children);
    const seen = new Map<string, number>();
    components = {
      strong: ({ children: c }: { children?: ReactNode }) => {
        const text = textOf(c);
        const nth = seen.get(text) ?? 0;
        seen.set(text, nth + 1);
        let idx = -1;
        for (let i = 0, k = 0; i < order.length; i++) {
          if (order[i] === text && k++ === nth) {
            idx = i;
            break;
          }
        }
        if (idx < 0) return <strong>{c}</strong>;
        const key = termKey(recall.blockId, idx);
        return (
          <RecallTerm
            text={text}
            state={recall.get(key)}
            page={recall.page}
            onReveal={() => recall.onReveal(key)}
            onMark={(t) => recall.onMark(key, t)}
          />
        );
      },
    };
  }
  return (
    <Streamdown
      className={cn('studio-prose', className)}
      rehypePlugins={REHYPE_PLUGINS}
      disallowedElements={NO_ELEMENTS}
      components={components}
    >
      {children}
    </Streamdown>
  );
});
