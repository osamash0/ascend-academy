import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { Markdown } from './Markdown';
import {
  COLLAPSE_S, FLIGHT_EASE, GROW_S, RULE_S, WORD_BUDGET_S, WORD_LIMIT, WORD_S, WORD_STAGGER_S,
} from '../motion';
import { plainText } from '../text';
import { useKeepPlace } from '../useKeepPlace';
import type { GeneratedBlock } from '../types';

interface Props {
  block: GeneratedBlock;
  fresh: boolean;
  onSettled(id: string): void;
  onRemove(id: string): void;
  onOpenPeek?(blockId: string): void;
}

/** Per-word start delays: word by word up to WORD_LIMIT, then in groups; never past WORD_BUDGET_S. */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests
export function wordDelays(count: number): number[] {
  const step = Math.min(WORD_STAGGER_S, WORD_BUDGET_S / Math.max(count - 1, 1));
  const head = Math.min(count, WORD_LIMIT);
  const out = Array.from({ length: head }, (_, i) => i * step);
  if (count > head) {
    const start = head * step;
    const groups = Math.ceil((count - head) / 12);
    const g = groups > 1 ? (WORD_BUDGET_S - start) / (groups - 1) : 0;
    for (let i = head; i < count; i++) out.push(Math.min(WORD_BUDGET_S, start + Math.floor((i - head) / 12) * g));
  }
  return out;
}

/**
 * An answer, woven under the paragraph it is about — Living Learn spec §4.3–4.6.
 *
 * Fresh: space opens, a teal rule draws down, words settle from blurred to
 * sharp; then the plain words give way to the rendered Markdown (the key
 * terms light up last). Not fresh, or reduced motion: it is simply there.
 * Remove collapses it, then asks the screen to take it out (Undo lives there).
 */
export function WovenAnswer({ block, fresh, onSettled, onRemove, onOpenPeek }: Props) {
  const reduce = useReducedMotion();
  const animate = fresh && !reduce;
  const [settled, setSettled] = useState(!animate);
  const [leaving, setLeaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [justSettled, setJustSettled] = useState(false);
  // keep your place one more frame: the swap to rendered Markdown can change the height
  useKeepPlace(ref, animate && (!settled || justSettled));
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const onRemoveRef = useRef(onRemove);
  onRemoveRef.current = onRemove;

  const words = useMemo(() => plainText(block.markdown).split(' '), [block.markdown]);
  const delays = useMemo(() => wordDelays(words.length), [words.length]);
  const total = GROW_S * 0.2 + (delays[delays.length - 1] ?? 0) + WORD_S;

  useEffect(() => {
    if (!animate) {
      onSettledRef.current(block.id);
      return;
    }
    let raf = 0;
    const t = setTimeout(() => {
      setSettled(true);
      setJustSettled(true);
      raf = requestAnimationFrame(() => setJustSettled(false));
      onSettledRef.current(block.id);
    }, total * 1000);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
    };
    // once per mount: a fresh answer grows once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => onRemoveRef.current(block.id), (reduce ? 0.15 : COLLAPSE_S) * 1000);
    return () => clearTimeout(t);
  }, [leaving, reduce, block.id]);

  return (
    <motion.div
      ref={ref}
      data-block-id={block.id}
      data-extracted="false"
      data-woven="true"
      initial={animate ? { height: 0, opacity: 1 } : reduce && fresh ? { opacity: 0 } : false}
      animate={leaving ? { height: 0, opacity: reduce ? 0 : 1 } : { height: 'auto', opacity: 1 }}
      transition={{
        height: { duration: reduce ? 0 : leaving ? COLLAPSE_S : GROW_S, ease: FLIGHT_EASE },
        opacity: { duration: 0.15 },
      }}
      className="group/woven relative overflow-hidden"
    >
      <div className="relative mb-4 mt-0.5 py-1 pl-[18px]">
        <motion.span
          aria-hidden
          initial={animate ? { scaleY: 0 } : false}
          animate={{ scaleY: 1 }}
          transition={{ duration: RULE_S, ease: FLIGHT_EASE, delay: 0.15 }}
          style={{ originY: 0 }}
          className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full bg-gradient-to-b from-[rgb(var(--studio-woven))] to-[rgb(var(--studio-woven)/0.15)]"
        />
        <motion.p
          initial={animate ? { opacity: 0 } : false}
          animate={{ opacity: 0.85 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mb-1 text-[12px] text-[rgb(var(--studio-woven))]"
        >
          From your question
        </motion.p>
        <p className="mb-1.5 text-[13px] text-quiet">{block.askedAs}</p>

        {settled ? (
          <motion.div initial={animate ? { opacity: 0.6 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
            <Markdown className="studio-woven-text">{block.markdown}</Markdown>
          </motion.div>
        ) : (
          <p className="studio-prose studio-woven-text">
            <span className="sr-only">{words.join(' ')}</span>
            <span data-woven-words aria-hidden="true">
              {words.map((w, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  transition={{ duration: WORD_S, delay: GROW_S * 0.2 + delays[i] }}
                >
                  {w}{' '}
                </motion.span>
              ))}
            </span>
          </p>
        )}

        {block.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {block.citations.map((c, i) => (
              c.blockId ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => c.blockId && onOpenPeek?.(c.blockId)}
                  className="console-focusable min-h-6 rounded-full bg-[rgb(var(--studio-chip))] px-2.5 text-[11.5px] tabular-nums text-quiet transition-colors hover:bg-[rgb(var(--studio-chip-hover))] hover:text-foreground"
                >
                  {c.label}
                </button>
              ) : (
                <span
                  key={i}
                  className="inline-flex min-h-6 items-center rounded-full bg-[rgb(var(--studio-chip))] px-2.5 text-[11.5px] tabular-nums text-quiet"
                >
                  {c.label}
                </span>
              )
            ))}
          </div>
        )}

        <button
          type="button"
          aria-label="Remove this answer"
          onClick={() => setLeaving(true)}
          className="console-focusable absolute right-0 top-0 flex h-7 w-7 items-center justify-center rounded-full text-faint opacity-0 transition-opacity hover:bg-[rgb(var(--studio-chip))] hover:text-foreground focus-visible:opacity-100 group-hover/woven:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
