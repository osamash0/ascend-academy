import { useEffect, useId, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { TermState } from '../recall';

const PAIR_MS = 4000;
const pad =
  'relative rounded px-1 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 before:absolute before:-inset-1 before:content-[""]';

/**
 * A key term as a blank you can fill in your head first: reveal it, then say
 * whether you knew it. The reveal (blur to sharp, then Knew it · Not yet for
 * 4 s) plays only when this term turns from blank to seen in front of you; a
 * term that was already seen (a remount, a reload, a depth change) is simply
 * there.
 */
export function RecallTerm({
  text,
  termKey,
  state,
  page,
  onReveal,
  onMark,
}: {
  text: string;
  /** `blockId:n`, on the blank, so Try again can find it. */
  termKey?: string;
  state: TermState;
  page: number;
  onReveal(): void;
  onMark(t: 'knew' | 'notYet'): void;
}) {
  const { t } = useTranslation('v4Library', { keyPrefix: 'studio.canvas.recall' });
  const reduce = useReducedMotion();
  const id = useId();
  // Derived from the last state this instance saw: only blank → seen is a reveal.
  const [seen, setSeen] = useState({ state, fresh: false });
  let fresh = seen.fresh;
  if (seen.state !== state) {
    fresh = seen.state === 'blank' && state === 'seen';
    setSeen({ state, fresh });
  }
  // A seen term you never marked can be asked again: tap it and the pair comes back (no replayed blur).
  const [reopened, setReopened] = useState(false);
  if (reopened && state !== 'seen') setReopened(false);
  const asking = state === 'seen' && (fresh || reopened);
  const termRef = useRef<HTMLSpanElement>(null);
  const pairRef = useRef<HTMLSpanElement>(null);
  const knewRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!asking) return;
    // Focus follows the reveal: the term's button is gone, so go to the first mark.
    knewRef.current?.focus();
    const timer = setTimeout(() => {
      // Only pull focus back when it was in the pair that is about to vanish.
      if (pairRef.current?.contains(document.activeElement)) termRef.current?.focus();
      setSeen((s) => (s.fresh ? { ...s, fresh: false } : s));
      setReopened(false);
    }, PAIR_MS);
    return () => clearTimeout(timer);
  }, [asking]);
  const mark = (verdict: 'knew' | 'notYet') => {
    termRef.current?.focus();
    onMark(verdict);
  };

  if (state === 'blank') {
    return (
      <button
        type="button"
        aria-label={t('reveal', { page })}
        data-term-key={termKey}
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
  const reveal = fresh && state === 'seen' && !reduce;
  return (
    <span className="inline">
      <motion.span
        ref={termRef}
        id={id}
        tabIndex={state === 'seen' && !asking ? 0 : -1}
        role={state === 'seen' && !asking ? 'button' : undefined}
        aria-label={state === 'seen' && !asking ? t('markIt', { text }) : t('revealed', { text })}
        onClick={state === 'seen' && !asking ? () => setReopened(true) : undefined}
        onKeyDown={
          state === 'seen' && !asking
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setReopened(true);
                }
              }
            : undefined
        }
        className={cn(underline, state === 'seen' && !asking && 'cursor-pointer', 'rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1')}
        style={{ color: 'rgb(var(--studio-term))' }}
        initial={reveal ? { filter: 'blur(6px)', opacity: 0.4 } : false}
        animate={reveal ? { filter: 'blur(0px)', opacity: 1 } : undefined}
        transition={{ duration: 0.35 }}
      >
        {text}
      </motion.span>
      {asking && (
        <span ref={pairRef} className="ml-1 inline-flex gap-0.5 align-baseline">
          {/* Described by the term: a screen reader hears what it is asked about. */}
          <button ref={knewRef} type="button" aria-describedby={id} className={pad} onClick={() => mark('knew')}>
            {t('knew')}
          </button>
          <button type="button" aria-describedby={id} className={pad} onClick={() => mark('notYet')}>
            {t('notYet')}
          </button>
        </span>
      )}
    </span>
  );
}
