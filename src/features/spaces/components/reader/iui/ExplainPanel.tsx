import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { timing } from '../Planes';
import { BlockView } from './Blocks';
import type { ExplainAnswer } from './spec';

/**
 * Explain: the page, answered as an interface.
 *
 * The answer arrives the way a generated one would — headline first, then
 * one block at a time, a quiet "composing" line holding the place of the
 * next — so the panel is useful before it is finished. A page is composed
 * once; turning back to it shows the finished answer, not the performance.
 *
 * What the reader does inside a block stays there (an edited table, a
 * closure half-stepped), and an `explore` part reaches out to the slide
 * through `onSpot`, lighting the same words on the page.
 */

interface Props {
  /** Identifies the answer — a page — so it composes once. */
  answerKey: string;
  answer: ExplainAnswer;
  page: number;
  onSpot: (words: string | null) => void;
  /** A follow-up pressed: handed to the tutor. */
  onAsk: (text: string) => void;
}

/** How long one block takes to "arrive". */
const BLOCK_MS = 520;

export function ExplainPanel({ answerKey, answer, page, onSpot, onAsk }: Props) {
  const reduce = useReducedMotion();
  const seen = useRef(new Set<string>());
  const first = !seen.current.has(answerKey);
  const [shown, setShown] = useState(first && !reduce ? 0 : answer.blocks.length);
  const scroller = useRef<HTMLDivElement>(null);

  /* A new page: start composing, unless this page has been composed before. */
  const [keyNow, setKeyNow] = useState(answerKey);
  if (keyNow !== answerKey) {
    setKeyNow(answerKey);
    setShown(seen.current.has(answerKey) || reduce ? answer.blocks.length : 0);
  }

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    onSpot(null);
  }, [answerKey, onSpot]);

  useEffect(() => {
    if (shown >= answer.blocks.length) {
      seen.current.add(answerKey);
      return;
    }
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 380 : BLOCK_MS);
    return () => clearTimeout(t);
  }, [shown, answer.blocks.length, answerKey]);

  const composing = shown < answer.blocks.length;

  return (
    <div ref={scroller} className="h-full overflow-y-auto">
      <div className="px-6 pb-24 pt-7">
        <motion.div
          key={answerKey}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: timing.card }}
        >
          <p className="mb-2 flex items-center gap-2 text-[12.5px] text-quiet">
            <Sparkles aria-hidden className="h-3.5 w-3.5" style={{ color: 'var(--reader-accent,hsl(var(--secondary)))' }} />
            Page {page}
            <span aria-hidden className="text-faint">·</span>
            {answer.format}
          </p>
          <h2 className="mb-6 text-[24px] font-medium leading-[1.2] tracking-[-0.015em] text-foreground">{answer.title}</h2>
        </motion.div>

        <div className="space-y-5" aria-live="polite" aria-busy={composing}>
          {answer.blocks.slice(0, shown).map((b, i) => (
            <motion.div
              key={`${answerKey}-${i}`}
              initial={first && !reduce ? { opacity: 0, y: 12 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: timing.card }}
            >
              <BlockView block={b} onSpot={onSpot} />
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

        {!composing && answer.next && answer.next.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: timing.card }}
            className="mt-8 flex flex-wrap gap-2"
          >
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
          </motion.div>
        )}
      </div>
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
