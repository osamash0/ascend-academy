import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ShelfItem } from '../studio/shelf';
import { FLIGHT_EASE } from '../studio/motion';
import { inDialog } from '../studio/keys';
import { shelfActions } from '../data/useShelf';
import { ShareSheet } from './ShareSheet';
import { ABOVE_SELECT_BAR } from './toasts';

/**
 * Select's bar (One Library spec §5.8; a labelled group of actions) — the one dense moment on the shelf,
 * on purpose. It slides up from the bottom while you are choosing, and goes
 * when you are done (Done, or Esc).
 *
 * `selected` is in shelf order: Remove takes them top to bottom, so Undo can
 * put them back bottom to top, each into the slot it left.
 */

const ACTION =
  'console-focusable h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40';
const QUIET = cn(ACTION, 'text-quiet hover:bg-white/[0.08] hover:text-foreground');
const PLAIN = cn(ACTION, 'border border-white/15 text-foreground hover:bg-white/[0.08]');

export function SelectBar({
  open,
  selected,
  total,
  onSelectAll,
  onClear,
  onDone,
}: {
  /** Selecting: the bar slides up; done, it slides away. */
  open: boolean;
  selected: ShelfItem[];
  /** How many covers Select all would check. */
  total: number;
  onSelectAll: () => void;
  /** After an action that leaves nothing worth keeping selected. */
  onClear: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation('v4Library', { keyPrefix: 'library.shelf.bar' });
  const reduce = useReducedMotion();
  const [sharing, setSharing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const n = selected.length;
  const drafts = selected.filter((i) => i.share.kind === 'draft' && i.stage === 'ready');
  /* After an action empties the selection, focus moves to the bar's first action still enabled. */
  const barRef = useRef<HTMLDivElement>(null);
  const firstEnabled = () => barRef.current?.querySelector<HTMLElement>('button:not(:disabled)') ?? null;
  const justRemoved = useRef(false);

  /* Esc leaves Select — unless a dialog of ours has it, which closes first. */
  const done = useRef(onDone);
  done.current = onDone;
  const busy = useRef(false);
  busy.current = sharing || confirming;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (busy.current || inDialog(e.target)) return;
      done.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const publish = () => {
    for (const d of drafts) shelfActions.publish(d.id);
    toast(t('published', { count: drafts.length }), ABOVE_SELECT_BAR);
  };

  const remove = () => {
    const removed = selected.flatMap((i) => {
      const r = shelfActions.remove(i.id);
      return r ? [r] : [];
    });
    justRemoved.current = true;
    setConfirming(false);
    onClear();
    toast(t('removed', { n: removed.length }), {
      ...ABOVE_SELECT_BAR,
      action: {
        label: t('undo'),
        onClick: () => {
          for (const r of [...removed].reverse()) shelfActions.restore(r);
        },
      },
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={barRef}
          key="selection"
          role="group"
          aria-label={t('label')}
          className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-[calc(100%-2rem)] max-w-[760px] items-center gap-1 overflow-x-auto rounded-full border border-white/12 bg-[#0b0b0b]/95 px-2 py-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.55)] backdrop-blur-md"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 32 }}
          transition={{ duration: reduce ? 0.15 : 0.32, ease: FLIGHT_EASE }}
        >
          <span
            role="status"
            aria-label={t('countLabel')}
            aria-live="polite"
            className="shrink-0 px-3 text-[13px] font-medium tabular-nums text-foreground"
          >
            {t('count', { count: n })}
          </span>
          <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-white/12" />
          <button type="button" disabled={n === 0} onClick={() => setSharing(true)} className={PLAIN}>
            {t('share')}
          </button>
          <button type="button" disabled={drafts.length === 0} onClick={publish} className={PLAIN}>
            {t('publish')}
          </button>
          <button type="button" disabled={n === 0} onClick={() => setConfirming(true)} className={PLAIN}>
            {t('remove')}
          </button>
          <span className="flex-1" />
          <button type="button" disabled={total === 0 || n === total} onClick={onSelectAll} className={QUIET}>
            {t('all')}
          </button>
          <button
            type="button"
            onClick={onDone}
            className={cn(ACTION, 'bg-foreground text-background hover:opacity-90')}
          >
            {t('done')}
          </button>

          <ShareSheet
            items={selected}
            open={sharing}
            onOpenChange={setSharing}
            onShared={onClear}
            returnFocus={firstEnabled}
          />
          <Dialog open={confirming} onOpenChange={setConfirming}>
            <DialogContent
              className="max-w-sm"
              onCloseAutoFocus={(e) => {
                if (!justRemoved.current) return;
                justRemoved.current = false;
                e.preventDefault();
                firstEnabled()?.focus();
              }}
            >
              <DialogHeader>
                <DialogTitle>{t('confirmTitle', { n })}</DialogTitle>
                <DialogDescription>{t('confirmBody')}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="console-focusable h-10 rounded-full border border-border px-5 text-[14px]"
                >
                  {t('keep')}
                </button>
                <button
                  type="button"
                  onClick={remove}
                  className="console-focusable h-10 rounded-full bg-foreground px-5 text-[14px] font-medium text-background"
                >
                  {t('confirm', { n })}
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
