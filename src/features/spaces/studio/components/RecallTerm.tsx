import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { TermState } from '../recall';

const PAIR_MS = 4000;
const pad =
  'relative rounded px-1 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 before:absolute before:-inset-1 before:content-[""]';

/** A key term as a blank you can fill in your head first: reveal it, then say whether you knew it. */
export function RecallTerm({
  text,
  state,
  page,
  onReveal,
  onMark,
}: {
  text: string;
  state: TermState;
  page: number;
  onReveal(): void;
  onMark(t: 'knew' | 'notYet'): void;
}) {
  const reduce = useReducedMotion();
  const [pairOpen, setPairOpen] = useState(true);
  useEffect(() => {
    if (state !== 'seen') return;
    setPairOpen(true);
    const t = setTimeout(() => setPairOpen(false), PAIR_MS);
    return () => clearTimeout(t);
  }, [state]);

  if (state === 'blank') {
    return (
      <button
        type="button"
        aria-label={`Reveal term, page ${page}`}
        onClick={onReveal}
        className="select-none rounded-md bg-[rgb(var(--studio-term)/0.14)] px-0.5 text-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
      >
        {text}
      </button>
    );
  }

  const underline =
    state === 'knew'
      ? 'underline decoration-[rgb(var(--studio-woven)/0.55)] decoration-1 underline-offset-4'
      : state === 'notYet'
        ? 'underline decoration-[hsl(var(--studio-mark)/0.6)] decoration-1 underline-offset-4'
        : '';
  const reveal = state === 'seen' && !reduce;
  return (
    <span className="inline">
      <motion.span
        className={underline}
        style={{ color: 'rgb(var(--studio-term))' }}
        initial={reveal ? { filter: 'blur(6px)', opacity: 0.4 } : false}
        animate={reveal ? { filter: 'blur(0px)', opacity: 1 } : undefined}
        transition={{ duration: 0.35 }}
      >
        {text}
      </motion.span>
      {state === 'seen' && pairOpen && (
        <span className="ml-1 inline-flex gap-0.5 align-baseline">
          <button type="button" className={pad} onClick={() => onMark('knew')}>
            Knew it
          </button>
          <button type="button" className={pad} onClick={() => onMark('notYet')}>
            Not yet
          </button>
        </span>
      )}
    </span>
  );
}
