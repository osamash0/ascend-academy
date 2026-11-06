import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * The Layout switch: a chip at the end of the view tabs, in their shape, but a
 * switch rather than a fourth view. It exists only where the page can be shown
 * re-set; elsewhere there is nothing, not a disabled ghost.
 *
 * Named by its visible word; the title says what it does.
 */
export function LayoutSwitch({ on, available, onToggle }: { on: boolean; available: boolean; onToggle: () => void }) {
  const { t } = useTranslation('v4Reader');
  if (!available) return null;
  return (
    <button
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
