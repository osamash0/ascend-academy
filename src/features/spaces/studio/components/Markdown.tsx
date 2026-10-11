import { createContext, memo, useContext, type ReactNode } from 'react';
import { Streamdown, defaultRehypePlugins } from 'streamdown';
import { cn } from '@/lib/utils';
import { RecallTerm } from './RecallTerm';
import { isPlainTerm, termKey, type TermState } from '../recall';

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

interface HNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
  position?: { start?: { offset?: number } };
}

const hastText = (n: HNode): string =>
  n.type === 'text' ? (n.value ?? '') : (n.children ?? []).map(hastText).join('');

/**
 * Stamps each recall term with its index, counted over the whole tree in
 * reading order. A term is a `**bold**` span of plain text (the same rule as
 * `termsIn`); other bold stays ordinary bold.
 */
function rehypeTermIndex() {
  return (tree: HNode, file: { value?: unknown }) => {
    const source = typeof file.value === 'string' ? file.value : '';
    let i = 0;
    const walk = (n: HNode) => {
      if (n.type === 'element' && n.tagName === 'strong') {
        const kids = n.children ?? [];
        const at = n.position?.start?.offset;
        const asterisks = at === undefined || source.slice(at, at + 2) === '**';
        if (asterisks && kids.every((k) => k.type === 'text') && isPlainTerm(hastText(n))) {
          n.properties = { ...n.properties, dataTermIndex: i++ };
        }
        return;
      }
      n.children?.forEach(walk);
    };
    walk(tree);
  };
}

/** Held in context so term components stay mounted while their state changes. */
const RecallContext = createContext<MarkdownRecall | null>(null);

function RecallStrong(props: { children?: ReactNode; [k: string]: unknown }) {
  const recall = useContext(RecallContext);
  const idx = props['data-term-index'];
  if (!recall || typeof idx !== 'number') return <strong>{props.children}</strong>;
  const key = termKey(recall.blockId, idx);
  return (
    <RecallTerm
      text={hastTextOf(props.children)}
      state={recall.get(key)}
      page={recall.page}
      onReveal={() => recall.onReveal(key)}
      onMark={(t) => recall.onMark(key, t)}
    />
  );
}

const hastTextOf = (n: ReactNode): string =>
  typeof n === 'string' || typeof n === 'number'
    ? String(n)
    : Array.isArray(n)
      ? n.map(hastTextOf).join('')
      : '';

const RECALL_COMPONENTS = { strong: RecallStrong };
const RECALL_REHYPE = [...REHYPE_PLUGINS, rehypeTermIndex];
/** One block: term indexes run across the whole text, not per Streamdown block. */
const ONE_BLOCK = (md: string) => [md];

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
  const stream = (
    <Streamdown
      className={cn('studio-prose', className)}
      rehypePlugins={recall ? RECALL_REHYPE : REHYPE_PLUGINS}
      disallowedElements={NO_ELEMENTS}
      components={recall ? RECALL_COMPONENTS : undefined}
      parseMarkdownIntoBlocksFn={recall ? ONE_BLOCK : undefined}
    >
      {children}
    </Streamdown>
  );
  return recall ? <RecallContext.Provider value={recall}>{stream}</RecallContext.Provider> : stream;
});
