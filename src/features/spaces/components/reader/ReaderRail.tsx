import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RailTab } from './ReaderHeader';

/**
 * The companions, when they are asked for.
 *
 * Chrome and nothing else: the tabs, the close button, the scroll, and the
 * rules about focus. Both panels arrive as nodes from `ReaderScreen`, so the
 * tutor can land in the rail without this file learning what a tutor is.
 *
 * Three decisions worth naming:
 *
 *   • **Closed is unmounted, not hidden.** A rail translated off the right
 *     edge still sits in the accessibility tree and still takes a Tab — so
 *     "summoned, never squatting" would be true of the pixels and false of
 *     the keyboard, which is the worst place for a rule to be half-kept. The
 *     cost is that there is no slide-out on close; on a focus surface that is
 *     a fair trade, and `AnimatePresence` can buy it back later without
 *     touching the rule.
 *   • **It carries the focus contract, rather than its caller.** The rail
 *     remembers what was focused when it opened and hands focus back on the
 *     way out. Putting that here means every way of closing it — Escape, the
 *     close button, and pressing the same header toggle a second time — is
 *     the same code path, so none of the three can be the one that was
 *     forgotten.
 *   • **A field owns Escape.** `NoteEditor` cancels an edit with Escape, and
 *     one key must not both discard what you were writing and take the panel
 *     away. So the document-level handler steps aside inside a text field;
 *     the second press, with the editor closed, closes the rail.
 *
 * No scrim under the overlay at narrow widths, deliberately. The article is
 * still the thing being read, and dimming it to announce a panel the reader
 * just asked for would be the chrome talking over the content.
 */

interface Props {
  open: boolean;
  tab: RailTab;
  onTabChange: (t: RailTab) => void;
  onClose: () => void;
  tutor: React.ReactNode;
  notes: React.ReactNode;
}

const TABS: { tab: RailTab; label: string }[] = [
  { tab: 'tutor', label: 'Tutor' },
  { tab: 'notes', label: 'Notes' },
];

export function ReaderRail({ open, tab, onTabChange, onClose, tutor, notes }: Props) {
  const ref = useRef<HTMLElement>(null);

  /*
   * Focus in on the way up, and back where it came from on the way down.
   *
   * The landmark itself takes the focus rather than the first control: it is
   * announced with its name, so a screen reader says which region you have
   * arrived in, and one Tab reaches the tabs. Focusing the close button
   * instead would put "leave" under the hand of somebody who just asked to
   * arrive.
   *
   * The opener is read from `document.activeElement` before that move, which
   * is why the return survives all three exits — the rail never has to be
   * told which button summoned it.
   */
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    ref.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside
      ref={ref}
      /* Programmatic focus target only — it is a region, not a control. */
      tabIndex={-1}
      aria-label="Reader companions"
      className={cn(
        /*
          `top-14` is the header's height, spelled out rather than reached
          through `inset-y-0`: the two would collide and which one won would
          depend on Tailwind's utility order rather than on this line.
        */
        'fixed bottom-0 right-0 top-14 z-30 flex w-full flex-col outline-none',
        'border-l border-white/[0.07] bg-[#070b14]/95 backdrop-blur-md sm:w-96',
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.07] px-3">
        <div
          role="tablist"
          aria-label="Companions"
          className="flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.04] p-0.5"
        >
          {TABS.map(({ tab: t, label }) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`reader-rail-tab-${t}`}
              aria-selected={tab === t}
              aria-controls="reader-rail-panel"
              onClick={() => onTabChange(t)}
              className={cn(
                'console-focusable h-8 rounded-full px-4 text-[13px] font-medium transition-colors',
                tab === t
                  ? 'bg-white/[0.10] text-foreground'
                  : 'text-quiet hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          aria-label="Close companions"
          onClick={onClose}
          className="console-focusable ml-auto flex h-9 w-9 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>

      {/*
        The rail scrolls itself. The article behind it keeps its own scroll
        position — reading and asking are two things happening at once, and a
        panel that dragged the page around underneath it would make the second
        one cost the first.
      */}
      <div
        id="reader-rail-panel"
        role="tabpanel"
        aria-labelledby={`reader-rail-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {tab === 'tutor' ? tutor : notes}
      </div>
    </aside>
  );
}
