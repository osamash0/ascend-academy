import { useEffect, type RefObject } from 'react';

/**
 * The focus contract of anything summoned.
 *
 * Lifted out of `ReaderRail` so the anchored companion card can keep the same
 * two promises without a second copy of them:
 *
 *   • Focus moves into the region when it opens, and returns to whatever had
 *     it when it closes — read from `document.activeElement` at open time, so
 *     the region never has to be told which control summoned it, and every
 *     way of closing is the same code path.
 *   • Escape closes it, unless a text field has focus. `NoteEditor` cancels an
 *     edit with Escape and one key must not both discard what you were writing
 *     and take the panel away. The second press, with the editor closed,
 *     closes the region.
 */
export function useSummoned(
  open: boolean,
  onClose: () => void,
  ref: RefObject<HTMLElement>,
  /**
   * Whether opening moves keyboard focus into the region. The rail does — it
   * is a landmark you arrive in. The companion card does not (Abi,
   * 2026-09-18): it appears beside the sentence you were reading, and taking
   * focus away from the text was the wrong beat. Escape still closes it.
   */
  { takeFocus = true }: { takeFocus?: boolean } = {},
) {
  useEffect(() => {
    if (!open || !takeFocus) return;
    const opener = document.activeElement;
    /*
     * `preventScroll`, because the region may sit inside a scrolling face —
     * the companion hangs off a block — and a plain `focus()` scrolls that
     * face until the region is in view. Measured: a citation that landed the
     * Material on page 2 was immediately scrolled off it to show the card.
     * The card is beside the passage; the passage is what must stay put.
     */
    ref.current?.focus({ preventScroll: true });
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open, ref, takeFocus]);

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
}
