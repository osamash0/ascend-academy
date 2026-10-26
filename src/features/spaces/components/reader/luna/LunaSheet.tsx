import { useRef, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { timing } from '../Planes';
import { useSummoned } from '../useSummoned';

/** The sheet's height: under half the window, never too short to talk in. */
export const LUNA_SHEET_HEIGHT = 'max(280px, 45dvh)';

/**
 * Luna on a narrow window: a sheet from the bottom, the page still in view
 * and still yours above it. Wide windows dock the column beside the page instead.
 */
export function LunaSheet({
  open, label, onClose, children,
}: { open: boolean; label: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation('v4Reader');
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  useSummoned(open, onClose, ref, { takeFocus: false });
  const away = reduce ? { opacity: 0 } : { opacity: 0, y: 40 };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          ref={ref}
          tabIndex={-1}
          aria-label={label}
          data-luna-sheet=""
          initial={away}
          animate={{ opacity: 1, y: 0 }}
          exit={away}
          transition={{ duration: reduce ? 0 : timing.card }}
          style={{ height: LUNA_SHEET_HEIGHT }}
          className="fixed inset-x-0 bottom-0 z-[42] flex flex-col rounded-t-2xl border-t border-white/[0.08] bg-[#0b0b0c] outline-none"
        >
          <div className="relative flex h-6 shrink-0 items-center justify-center">
            <span aria-hidden className="h-1 w-9 rounded-full bg-white/20" />
            <button
              type="button"
              aria-label={t('studio.closeNamed', { name: label })}
              onClick={onClose}
              className="console-focusable absolute right-2 top-1 flex h-8 w-8 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
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
