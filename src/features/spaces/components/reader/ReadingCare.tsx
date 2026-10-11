import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Coffee, Target, X } from 'lucide-react';

/**
 * Care for a long session.
 *
 * Attention on slides fades well before an hour does, and a short break —
 * eyes off the screen — helps what was read settle more than another ten
 * pages would. So the reader counts *active* reading time (the tab visible
 * and someone actually there in the last minute and a half) and, after about
 * twenty-five minutes, offers a break or a quick check of what stuck. Once,
 * quietly, in a corner; "Not now" gives another stretch.
 */

const BREAK_AFTER_S = 25 * 60;
const AWAY_AFTER_MS = 90_000;
const BREAK_LENGTH_S = 5 * 60;

/** Development only: `?breakAfter=20` makes the nudge testable without waiting. */
function breakAfter(): number {
  if (!import.meta.env.DEV) return BREAK_AFTER_S;
  const v = Number(new URLSearchParams(window.location.search).get('breakAfter'));
  return Number.isFinite(v) && v > 0 ? v : BREAK_AFTER_S;
}

export interface ReadingCare {
  due: boolean;
  minutes: number;
  pages: number;
  snooze: () => void;
  resting: boolean;
  rest: () => void;
  back: () => void;
}

export function useReadingCare(page: number, enabled: boolean): ReadingCare {
  const [active, setActive] = useState(0);
  const [nextAt, setNextAt] = useState(breakAfter);
  const [resting, setResting] = useState(false);
  const pages = useRef(new Set<number>());
  const lastInput = useRef(Date.now());
  const activeRef = useRef(0);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const snooze = useCallback(() => setNextAt(activeRef.current + breakAfter()), []);
  const rest = useCallback(() => setResting(true), []);
  const back = useCallback(() => {
    setResting(false);
    setNextAt(activeRef.current + breakAfter());
  }, []);

  useEffect(() => {
    pages.current.add(page);
  }, [page]);

  useEffect(() => {
    if (!enabled) return;
    const touch = () => {
      lastInput.current = Date.now();
    };
    const events = ['pointermove', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    const tick = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastInput.current > AWAY_AFTER_MS) return;
      setActive((s) => s + 1);
    }, 1000);
    return () => {
      window.clearInterval(tick);
      for (const e of events) window.removeEventListener(e, touch);
    };
  }, [enabled]);

  return {
    due: enabled && !resting && active >= nextAt,
    minutes: Math.max(1, Math.round(active / 60)),
    pages: pages.current.size,
    snooze,
    resting,
    rest,
    back,
  };
}

export function BreakNudge({ care, checkHref }: { care: ReadingCare; checkHref?: string }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {care.due && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : 10 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-5 left-5 right-5 z-[45] rounded-3xl sm:left-auto sm:w-80 border border-white/[0.09] bg-[#0b0b0c] p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]"
        >
          <button
            type="button"
            onClick={care.snooze}
            aria-label="Not now"
            className="console-focusable absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
          <p className="text-[13px] tabular-nums text-quiet">
            {care.minutes} {care.minutes === 1 ? 'minute' : 'minutes'} · {care.pages} {care.pages === 1 ? 'page' : 'pages'}
          </p>
          <p className="mt-1.5 pr-6 text-[15px] leading-[1.45] text-foreground">
            A short break now helps what you read settle.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={care.rest}
              className="console-focusable inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[13px] font-medium text-background transition-colors"
            >
              <Coffee aria-hidden className="h-3.5 w-3.5" />
              Take 5 minutes
            </button>
            {checkHref && (
              <Link
                to={checkHref}
                className="console-focusable inline-flex h-9 items-center gap-2 rounded-full bg-white/[0.07] px-4 text-[13px] text-foreground transition-colors hover:bg-white/[0.12]"
              >
                <Target aria-hidden className="h-3.5 w-3.5" />
                Check what stuck
              </Link>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The break itself: the screen goes still, and a circle breathes slowly. */
export function BreakRoom({ care, page }: { care: ReadingCare; page: number }) {
  const reduce = useReducedMotion();
  const [left, setLeft] = useState(BREAK_LENGTH_S);
  const backRef = useRef<HTMLButtonElement>(null);
  const { resting, back } = care;

  useEffect(() => {
    if (!resting) return;
    setLeft(BREAK_LENGTH_S);
    backRef.current?.focus();
    const t = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') back();
      /* The reader's own keys must not turn pages behind the break. */
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [resting, back]);

  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');

  return (
    <AnimatePresence>
      {resting && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Break"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black px-6 text-center"
        >
          <div aria-hidden className="relative mb-12 flex h-48 w-48 items-center justify-center">
            <motion.span
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  'radial-gradient(circle, color-mix(in srgb, var(--reader-accent, hsl(var(--secondary))) 38%, transparent), transparent 70%)',
              }}
              animate={reduce ? { opacity: 0.8 } : { scale: [0.72, 1, 0.72], opacity: [0.55, 1, 0.55] }}
              transition={reduce ? { duration: 0 } : { duration: 11, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span className="relative text-[40px] font-light tabular-nums tracking-[-0.02em] text-foreground">
              {mm}:{ss}
            </span>
          </div>
          <p className="max-w-sm text-[17px] leading-[1.5] text-foreground">
            {left > 0 ? 'Look away from the screen — at something far away.' : 'Ready when you are.'}
          </p>
          {!reduce && left > 0 && <p className="mt-2 text-[13.5px] text-quiet">Breathe in as the light grows, out as it fades.</p>}
          <button
            ref={backRef}
            type="button"
            onClick={back}
            className="console-focusable mt-10 h-11 rounded-full bg-white/[0.08] px-6 text-[14px] text-foreground transition-colors hover:bg-white/[0.14]"
          >
            Back to page {page}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
