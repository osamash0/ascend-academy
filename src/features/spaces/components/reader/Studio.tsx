import { useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { timing } from './Planes';
import { useSummoned } from './useSummoned';

/**
 * The studio: a layer above the document.
 *
 * The Material is the ground — the whole file, every page, scrolled like a
 * document — and it never leaves. Everything the reader can add to it sits
 * in this one layer over it: the parsed text of the page you are at, the
 * tutor, your notes, the way into practice. Summoned from the words (a verb
 * on a selection, the Concept's name in the page line, `\`) and dismissed the
 * same way; closed, there is nothing here at all.
 *
 * Chrome only. What is in the layer arrives as children, so a new companion
 * is a new caller and not a new tab.
 */

interface Props {
  open: boolean;
  /** "Functional dependency · Page 6" — where the layer is looking. */
  where: string;
  onClose: () => void;
  children: ReactNode;
  /** Whether the layer is a panel beside the document, or covers it. */
  panel: boolean;
}

/** The panel's width, and the distance the document steps aside by half. */
export const STUDIO_WIDTH = 440;

export function Studio({ open, where, onClose, children, panel }: Props) {
  const ref = useRef<HTMLElement>(null);
  useSummoned(open, onClose, ref, { takeFocus: false });

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          ref={ref}
          tabIndex={-1}
          aria-label="Studio"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: timing.card }}
          style={{ width: panel ? STUDIO_WIDTH : undefined }}
          className={cn(
            'fixed inset-y-0 right-0 z-30 flex flex-col outline-none',
            'border-l border-white/[0.07] bg-[#070b14]/88 backdrop-blur-md',
            !panel && 'w-full',
          )}
        >
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] px-4">
            <p className="min-w-0 flex-1 truncate text-[12.5px] text-quiet">{where}</p>
            <button
              type="button"
              aria-label="Close the studio"
              onClick={onClose}
              className="console-focusable flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          </div>
          <div className="relative min-h-0 flex-1">{children}</div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
