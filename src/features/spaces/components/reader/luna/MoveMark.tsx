import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LunaMove } from '../../../data/lunaSession';

/** Where Luna took the page — pressable, so you can always go back there. */
export function MoveMark({ move, onGo }: { move: LunaMove; onGo: (lectureId: string, page: number, spot?: string) => void }) {
  const { t } = useTranslation('v4Luna');
  return (
    <button
      type="button"
      onClick={() => onGo(move.lecture_id, move.page, move.spot)}
      className="console-focusable inline-flex items-center gap-1 self-start text-[12px] text-quiet hover:text-foreground"
    >
      <ArrowRight aria-hidden className="h-3 w-3" />
      {t('move.to', { page: move.page })}
    </button>
  );
}
