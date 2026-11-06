import { useCallback, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * The Layout switch: a chip at the end of the view tabs, in their shape, but a
 * switch rather than a fourth view. It exists only where the page can be shown
 * re-set; elsewhere there is nothing, not a disabled ghost.
 *
 * Named by its visible word; the title says what it does.
 *
 * It can go while it holds focus (a page turn by key to a page with no Layout,
 * or the first check failing as it is switched on). Focus then goes to the view
 * tab in use, in the same row, rather than dropping to the page's body.
 */
export function LayoutSwitch({ on, available, onToggle }: { on: boolean; available: boolean; onToggle: () => void }) {
  const { t } = useTranslation('v4Reader');
  const node = useRef<HTMLButtonElement | null>(null);
  /* The row the switch stood in, when it went while focused. */
  const lostIn = useRef<Element | null>(null);

  /* React detaches the ref before it removes the button, so the focus is still there to see. */
  const attach = useCallback((el: HTMLButtonElement | null) => {
    const was = node.current;
    if (!el && was && was.ownerDocument.activeElement === was) lostIn.current = was.parentElement;
    node.current = el;
  }, []);

  useLayoutEffect(() => {
    const row = lostIn.current;
    if (!row) return;
    lostIn.current = null;
    const now = row.ownerDocument.activeElement;
    if (now && now !== row.ownerDocument.body) return;
    row.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  });

  if (!available) return null;
  return (
    <button
      ref={attach}
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      title={t('layout.switchLabel')}
      className={cn(
        'console-focusable relative h-8 rounded-full px-4 text-[13px] transition-colors',
        on ? 'bg-white/[0.14] text-foreground' : 'text-quiet hover:text-foreground',
      )}
    >
      {t('layout.switch')}
    </button>
  );
}
