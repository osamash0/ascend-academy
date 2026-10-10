import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  current: number | null;
  last: number | null;
  canBack: boolean;
  canForward: boolean;
  hint: string | null;
  onStep(delta: -1 | 1): void;
}

const turn =
  'console-focusable flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-quiet transition-colors hover:bg-[rgb(var(--studio-chip-hover))] hover:text-foreground disabled:pointer-events-none disabled:opacity-30';

/** The reader's page line: where you are, and the turn. A quiet hint above it until you've turned once. */
export function PagerPill({ current, last, canBack, canForward, hint, onStep }: Props) {
  return (
    <div className="flex flex-col items-center gap-2">
      <AnimatePresence initial={false}>
        {hint && (
          <motion.p
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto hidden text-center text-[12px] text-quiet sm:block"
          >
            {hint}
          </motion.p>
        )}
      </AnimatePresence>
      <div
        role="group"
        aria-label="Page"
        className="pointer-events-auto flex items-center gap-1 rounded-full bg-[rgb(var(--studio-chip))] p-1 text-[12.5px] backdrop-blur-md"
      >
        <button type="button" onClick={() => onStep(-1)} disabled={!canBack} aria-label="Previous page" className={turn}>
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </button>
        <span className="min-w-[4.5rem] shrink-0 text-center tabular-nums text-quiet">
          <span className="text-foreground">{current ?? '–'}</span>
          {last !== null && <span className="text-faint"> / {last}</span>}
        </span>
        <button type="button" onClick={() => onStep(1)} disabled={!canForward} aria-label="Next page" className={turn}>
          <ChevronRight aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
