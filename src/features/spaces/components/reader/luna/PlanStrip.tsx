import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { PlanStep } from '../../../data/lunaSession';

/** The plan, one quiet line: what's done, what's lit, what's next. */
export function PlanStrip({
  plan, accepted, onAccept, onChange, onSkip,
}: { plan: PlanStep[]; accepted: boolean; onAccept?: () => void; onChange?: () => void; onSkip?: () => void }) {
  const { t } = useTranslation('v4Luna');
  if (!plan.length) return null;
  return (
    <div role="group" aria-label={t('plan.label')} className="flex flex-col gap-2">
      <ol className="flex flex-wrap gap-1.5">
        {plan.map((s) => (
          <li
            key={s.id}
            aria-current={s.status === 'current' ? 'step' : undefined}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px]',
              s.status === 'current' && 'border-white/60 text-foreground',
              s.status === 'done' && 'border-white/10 text-quiet',
              s.status === 'skipped' && 'border-white/10 text-quiet line-through',
              s.status === 'todo' && 'border-white/15 text-quiet',
            )}
          >
            {s.status === 'done' && <Check aria-hidden className="h-3 w-3" />}
            {s.title}
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        {!accepted && onAccept && (
          <button type="button" onClick={onAccept} className="console-focusable rounded-full bg-white px-3 py-1 text-[12.5px] text-slate-900">
            {t('plan.accept')}
          </button>
        )}
        {onChange && (
          <button type="button" onClick={onChange} className="console-focusable rounded-full border border-white/15 px-3 py-1 text-[12.5px] text-quiet hover:text-foreground">
            {t('plan.change')}
          </button>
        )}
        {accepted && onSkip && (
          <button type="button" onClick={onSkip} className="console-focusable rounded-full px-2 py-1 text-[12.5px] text-quiet hover:text-foreground">
            {t('plan.skip')}
          </button>
        )}
      </div>
    </div>
  );
}
