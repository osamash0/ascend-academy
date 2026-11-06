import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Show more, show less.
 *
 * A big Space folds only what needs nothing from the owner: questions past the
 * first few, a Lesson's quieter findings, long lists of names. What needs the
 * owner is never behind one of these. The control carries no count; the rows
 * it reveals show how many there are. Pair it with `useStepped`.
 */

export function ShowMore({
  more,
  less,
  moreLabel,
  className,
}: {
  more?: () => void;
  less?: () => void;
  /** "Show all" where one tap reveals the rest. */
  moreLabel?: string;
  className?: string;
}) {
  const { t } = useTranslation('v4Landing');
  if (!more && !less) return null;
  return (
    <div className={cn('flex flex-wrap gap-x-5', className)}>
      {more && (
        <button type="button" onClick={more} className={fold}>
          {moreLabel ?? t('fold.more')}
          <ChevronDown aria-hidden className="h-3.5 w-3.5" />
        </button>
      )}
      {less && (
        <button type="button" onClick={less} className={fold}>
          {t('fold.less')}
          <ChevronDown aria-hidden className="h-3.5 w-3.5 rotate-180" />
        </button>
      )}
    </div>
  );
}

const fold =
  'console-focusable -mx-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13.5px] text-quiet transition-colors hover:text-foreground';
