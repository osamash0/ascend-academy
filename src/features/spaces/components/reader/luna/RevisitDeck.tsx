import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { lunaApi, type DueCard } from '../../../data/lunaSession';

/** Questions made in an earlier session, back when they're due. One at a time. */
export function RevisitDeck({ lectureId, onDone }: { lectureId: string; onDone: () => void }) {
  const { t } = useTranslation('v4Luna');
  const [cards, setCards] = useState<DueCard[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    lunaApi.due(lectureId).then((r) => live && setCards(r.cards)).catch(() => live && setCards([]));
    return () => {
      live = false;
    };
  }, [lectureId]);

  if (!cards) return null;
  const card = cards[0];
  if (!card) return <p className="text-[13px] text-quiet">{t('revisit.done')}</p>;
  const next = async (rating: 1 | 3) => {
    await lunaApi.grade(card.card_id, rating).catch(() => undefined);
    setPicked(null);
    const rest = cards.slice(1);
    setCards(rest);
    if (!rest.length) onDone();
  };
  return (
    <section aria-label={t('revisit.title')} className="flex flex-col gap-2 rounded-2xl border border-white/10 p-4">
      <p className="text-[11.5px] text-quiet">{t('revisit.count', { count: cards.length })}</p>
      <p className="text-[14px]">{card.front.question}</p>
      {card.front.options.map((o, i) => (
        <button
          key={i}
          type="button"
          disabled={picked !== null}
          onClick={() => setPicked(i)}
          className={cn(
            'console-focusable rounded-xl border px-3 py-2 text-left text-[13px]',
            picked === null && 'border-white/15 hover:border-white/40',
            picked !== null && i === card.back.correct && 'border-success/60 bg-success/10',
            picked === i && i !== card.back.correct && 'border-destructive/50 bg-destructive/10',
            picked !== null && i !== card.back.correct && picked !== i && 'border-white/10',
          )}
        >
          {o}
          {picked !== null && (i === picked || i === card.back.correct) && (
            <span className="mt-1 block text-[12px] text-quiet">{card.back.why[i]}</span>
          )}
        </button>
      ))}
      {picked !== null && (
        <div className="flex gap-2">
          <button type="button" onClick={() => next(1)} className="console-focusable rounded-full border border-white/15 px-3 py-1 text-[12.5px]">
            {t('revisit.again')}
          </button>
          <button type="button" onClick={() => next(picked === card.back.correct ? 3 : 1)} className="console-focusable rounded-full bg-white px-3 py-1 text-[12.5px] text-slate-900">
            {t('revisit.good')}
          </button>
        </div>
      )}
    </section>
  );
}
