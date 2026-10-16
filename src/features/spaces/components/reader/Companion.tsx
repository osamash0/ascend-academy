import { useRef, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { timing } from './Planes';
import { useSummoned } from './useSummoned';

/**
 * A companion card, anchored to the mark that opened it.
 *
 * It replaces the rail. The rail had a permanent place on the screen and two
 * tabs; this has neither — it appears beside the passage you were reading,
 * titled after what you selected or which idea you pressed, and goes away
 * when you are done. What it keeps from the rail is the focus contract
 * (`useSummoned`): focus moves in on open and back to the opener on close,
 * and Escape closes it unless you are typing.
 *
 * Chrome only. What is in it — the tutor, your notes — arrives as children,
 * so a third companion is a third caller and not a third tab.
 */

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Companion({ open, title, onClose, children, footer, className }: Props) {
  const { t } = useTranslation('v4Reader');
  const ref = useRef<HTMLElement>(null);
  useSummoned(open, onClose, ref, { takeFocus: false });
  if (!open) return null;

  return (
    <motion.aside
      ref={ref}
      tabIndex={-1}
      aria-label={title}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: timing.card }}
      className={cn(
        'flex max-h-[min(70vh,640px)] flex-col overflow-hidden rounded-xl outline-none',
        'border border-white/[0.08] bg-[#0b1020]/95 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.6)] backdrop-blur-md',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-white/[0.06] py-2 pl-4 pr-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{title}</p>
        <button
          type="button"
          aria-label={t('companion.close')}
          onClick={onClose}
          className="console-focusable flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && <div className="border-t border-white/[0.06] px-4 py-2.5">{footer}</div>}
    </motion.aside>
  );
}
