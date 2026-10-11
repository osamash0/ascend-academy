import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUp, ArrowUpRight, RotateCcw, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { timing } from '../Planes';
import { BlockView } from './Blocks';
import type { ExplainAnswer } from './spec';

/**
 * Explain: the page, answered as an interface — and then a conversation of them.
 *
 * The page's own answer arrives the way a generated one would — headline
 * first, then one block at a time, a quiet "composing" line holding the place
 * of the next. A page is composed once; turning back to it shows the finished
 * answer, not the performance.
 *
 * Below it, the reader can ask anything about the page. Each question gets
 * its own answer in whatever form fits it — a sentence, one of the native
 * tools, or a small app the model writes for that question (`Sandbox.tsx`).
 * A follow-up can come from the ask bar, from a suggestion, or from inside a
 * generated app (`LS.ask`); each one carries the conversation so far.
 *
 * What the reader does inside a block stays there (an edited table, a
 * closure half-stepped), and an `explore` part reaches out to the slide
 * through `onSpot`, lighting the same words on the page.
 */

export interface AskThread {
  question: string;
  title: string;
}

interface Props {
  /** Identifies the answer — a page — so it composes once. */
  answerKey: string;
  /** Null while the answer is being written. */
  answer: ExplainAnswer | null;
  /** The model could not answer; this one is composed from the page's own text. */
  fallback?: boolean;
  page: number;
  onSpot: (words: string | null) => void;
  /** Where a question goes when it cannot be answered here (demo): the tutor. */
  onAsk: (text: string) => void;
  /** Asks the model about this page and gets an interface back. Live lectures only. */
  ask?: ((question: string, thread: AskThread[]) => Promise<ExplainAnswer>) | null;
  /** A question handed in from outside (words selected on the page); asked once per `n`. */
  queued?: { question: string; n: number } | null;
  /** Where this idea is taught again in the course — other lectures, other pages. */
  related?: { idea: string; links: { label: string; detail: string; href: string }[] } | null;
}

interface Turn {
  id: number;
  question: string;
  status: 'thinking' | 'ready' | 'failed';
  answer?: ExplainAnswer;
}

/** How long one block takes to "arrive". */
const BLOCK_MS = 520;

const STARTERS = ['Show me how this works', 'Give me an example to try', 'What do people get wrong here?'];

export function ExplainPanel({ answerKey, answer, fallback = false, page, onSpot, onAsk, ask, queued, related }: Props) {
  const reduce = useReducedMotion();
  const seen = useRef(new Set<string>());
  const first = !seen.current.has(answerKey);
  const count = answer?.blocks.length ?? 0;
  const [shown, setShown] = useState(first && !reduce ? 0 : count);
  const scroller = useRef<HTMLDivElement>(null);

  /* The conversation, per page: turning back to a page finds it where you left it. */
  const [threads, setThreads] = useState<Record<string, Turn[]>>({});
  const turns = threads[answerKey] ?? [];
  const turnId = useRef(0);
  const [draft, setDraft] = useState('');
  const lastTurn = useRef<HTMLDivElement>(null);
  const [scrollTo, setScrollTo] = useState(0);

  /* A new page: start composing, unless this page has been composed before. */
  const [keyNow, setKeyNow] = useState(answerKey);
  if (keyNow !== answerKey) {
    setKeyNow(answerKey);
    setShown(seen.current.has(answerKey) || reduce ? count : 0);
  }

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    onSpot(null);
  }, [answerKey, onSpot]);

  useEffect(() => {
    if (!answer) return;
    if (shown >= count) {
      seen.current.add(answerKey);
      return;
    }
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 380 : BLOCK_MS);
    return () => clearTimeout(t);
  }, [shown, count, answer, answerKey]);

  useEffect(() => {
    if (scrollTo) lastTurn.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [scrollTo, reduce]);

  const composing = !answer || shown < count;

  const update = useCallback(
    (key: string, id: number, patch: Partial<Turn>) =>
      setThreads((all) => ({ ...all, [key]: (all[key] ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
    [],
  );

  const send = useCallback(
    (raw: string) => {
      const question = raw.trim().slice(0, 400);
      if (question.length < 2) return;
      if (!ask) {
        onAsk(question);
        return;
      }
      const key = answerKey;
      const id = ++turnId.current;
      const history: AskThread[] = (threads[key] ?? [])
        .filter((t) => t.status === 'ready' && t.answer)
        .map((t) => ({ question: t.question, title: t.answer!.title }));
      setThreads((all) => ({ ...all, [key]: [...(all[key] ?? []), { id, question, status: 'thinking' }] }));
      setDraft('');
      setScrollTo((n) => n + 1);
      ask(question, history)
        .then((a) => update(key, id, { status: 'ready', answer: a }))
        .catch(() => update(key, id, { status: 'failed' }));
    },
    [ask, onAsk, answerKey, threads, update],
  );

  /* Asked from the page: each handed-in question once, as soon as it arrives. */
  const askedN = useRef(0);
  useEffect(() => {
    if (!queued || queued.n === askedN.current) return;
    askedN.current = queued.n;
    send(queued.question);
  }, [queued, send]);

  const retry = (t: Turn) => {
    setThreads((all) => ({ ...all, [answerKey]: (all[answerKey] ?? []).filter((x) => x.id !== t.id) }));
    send(t.question);
  };

  const suggestions = [...(answer?.next ?? []), ...STARTERS].slice(0, 3);

  return (
    <div className="flex h-full flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-6 pb-10 pt-7">
          <motion.div
            key={`${answerKey}-${answer ? 'a' : 'w'}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: timing.card }}
          >
            <p className="mb-2 flex items-center gap-2 text-[12.5px] text-quiet">
              <Sparkles aria-hidden className="h-3.5 w-3.5" style={{ color: 'var(--reader-accent,hsl(var(--secondary)))' }} />
              Page {page}
              <span aria-hidden className="text-faint">·</span>
              {answer ? answer.format : 'Composing an answer for this page…'}
            </p>
            {answer ? (
              <h2 className="mb-6 text-[24px] font-medium leading-[1.2] tracking-[-0.015em] text-foreground">{answer.title}</h2>
            ) : (
              <Shimmer className="mb-8 mt-3 h-[24px] w-4/5" />
            )}
            {fallback && (
              <p className="-mt-3 mb-6 text-[12.5px] text-quiet">
                Explain couldn’t reach the model just now, so this is built from the page’s own text.
              </p>
            )}
          </motion.div>

          <div className="space-y-5" aria-live="polite" aria-busy={composing}>
            {(answer?.blocks ?? []).slice(0, shown).map((b, i) => (
              <motion.div
                key={`${answerKey}-${i}`}
                initial={first && !reduce ? { opacity: 0, y: 12 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: timing.card }}
              >
                <BlockView block={b} onSpot={onSpot} onAsk={send} />
              </motion.div>
            ))}
            <AnimatePresence>
              {composing && (
                <motion.div
                  key="composing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: timing.mark }}
                  className="space-y-2.5"
                >
                  <Shimmer className="w-2/3" />
                  <Shimmer className="w-11/12" />
                  <Shimmer className="w-1/2" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* The idea, elsewhere in the course: lectures connect. */}
          {!composing && related && related.links.length > 0 && (
            <motion.nav
              aria-label="Also taught in this Space"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: timing.card }}
              className="mt-8 rounded-2xl border border-white/[0.07] p-4"
            >
              <p className="mb-2.5 text-[12.5px] text-quiet">
                <span className="text-foreground">{related.idea}</span> also appears elsewhere in the Space
              </p>
              <ul className="space-y-1">
                {related.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      to={l.href}
                      className="console-focusable group flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/[0.05]"
                    >
                      <span className="w-28 shrink-0 text-[12.5px] text-quiet">{l.label}</span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground">{l.detail}</span>
                      <ArrowUpRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-faint transition-colors group-hover:text-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </motion.nav>
          )}

          {/* The conversation about this page. */}
          {turns.map((t, i) => (
            <div key={t.id} ref={i === turns.length - 1 ? lastTurn : undefined} className="mt-10 scroll-mt-4">
              <div className="mb-5 flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-white/[0.08] px-4 py-2.5 text-[14.5px] leading-[1.45] text-foreground">
                  {t.question}
                </p>
              </div>
              {t.status === 'thinking' && (
                <div aria-live="polite" className="space-y-3">
                  <p className="flex items-center gap-2 text-[12.5px] text-quiet">
                    <Sparkles aria-hidden className="h-3.5 w-3.5" style={{ color: 'var(--reader-accent,hsl(var(--secondary)))' }} />
                    Choosing how to show this…
                  </p>
                  <Shimmer className="h-[20px] w-3/4" />
                  <Shimmer className="w-11/12" />
                  <Shimmer className="w-2/3" />
                </div>
              )}
              {t.status === 'failed' && (
                <div role="alert" className="flex items-center gap-3 text-[13.5px] text-quiet">
                  That one didn’t come through.
                  <button
                    type="button"
                    onClick={() => retry(t)}
                    className="console-focusable flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-[12.5px] text-foreground transition-colors hover:bg-white/[0.1]"
                  >
                    <RotateCcw aria-hidden className="h-3.5 w-3.5" />
                    Try again
                  </button>
                </div>
              )}
              {t.status === 'ready' && t.answer && (
                <TurnAnswer answer={t.answer} onSpot={onSpot} onAsk={send} reduce={!!reduce} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Ask anything about the page. */}
      <div className="shrink-0 border-t border-white/[0.06] bg-[#0b0b0c] px-4 pb-4 pt-3">
        {turns.length === 0 && !composing && (
          <div className="mb-2.5 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
            {suggestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                className="console-focusable h-8 shrink-0 rounded-full border border-white/[0.1] px-3.5 text-[12.5px] text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          className="flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] py-1 pl-4 pr-1 focus-within:border-white/[0.22]"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={400}
            placeholder={ask ? 'Ask about this page — or ask for a tool…' : 'Ask the tutor about this page…'}
            aria-label="Ask about this page"
            className="h-9 min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-faint"
          />
          <button
            type="submit"
            disabled={draft.trim().length < 2}
            aria-label="Ask"
            className="console-focusable flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-background transition-colors disabled:bg-white/[0.12] disabled:text-faint"
          >
            <ArrowUp aria-hidden className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

function TurnAnswer({
  answer,
  onSpot,
  onAsk,
  reduce,
}: {
  answer: ExplainAnswer;
  onSpot: (w: string | null) => void;
  onAsk: (q: string) => void;
  reduce: boolean;
}) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-[12.5px] text-quiet">
        <Sparkles aria-hidden className="h-3.5 w-3.5" style={{ color: 'var(--reader-accent,hsl(var(--secondary)))' }} />
        {answer.format}
      </p>
      <h3 className="mb-5 text-[20px] font-medium leading-[1.25] tracking-[-0.01em] text-foreground">{answer.title}</h3>
      <motion.div
        className="space-y-5"
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.12 } } }}
      >
        {answer.blocks.map((b, i) => (
          <motion.div
            key={i}
            variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
            transition={{ duration: timing.card }}
          >
            <BlockView block={b} onSpot={onSpot} onAsk={onAsk} />
          </motion.div>
        ))}
      </motion.div>
      {answer.next && answer.next.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {answer.next.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onAsk(q)}
              className="console-focusable h-9 rounded-full border border-white/[0.1] px-4 text-[13px] text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Shimmer({ className }: { className?: string }) {
  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 0.35 }}
      animate={{ opacity: [0.35, 0.7, 0.35] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      className={cn('h-3 rounded-full bg-white/[0.1]', className)}
    />
  );
}
