import { useTranslation } from 'react-i18next';
import type { LunaWrap, WrapItem } from '../../../data/lunaSession';

/** What today was: covered, clicked, still shaky — each a way back into the page. */
export function WrapCard({
  wrap, kept, practiceAdded, onKeep, onPractise, onOpenPage,
}: {
  wrap: LunaWrap;
  kept: boolean;
  practiceAdded: number | null;
  onKeep: () => void;
  onPractise: () => void;
  onOpenPage: (lectureId: string, page: number) => void;
}) {
  const { t } = useTranslation('v4Luna');
  const item = (it: WrapItem, i: number) =>
    it.lecture_id && it.page ? (
      <li key={i}>
        <button type="button" onClick={() => onOpenPage(it.lecture_id!, it.page!)} className="console-focusable text-left hover:underline">
          {it.text} <span className="text-quiet">· {t('move.to', { page: it.page })}</span>
        </button>
      </li>
    ) : (
      <li key={i}>{it.text}</li>
    );
  const section = (key: 'covered' | 'clicked' | 'shaky') =>
    wrap[key].length ? (
      <div key={key}>
        <p className="text-[11.5px] text-quiet">{t(`wrap.${key}`)}</p>
        <ul className="mt-1 flex flex-col gap-1 text-[13.5px]">{wrap[key].map(item)}</ul>
      </div>
    ) : null;
  return (
    <section aria-label={t('wrap.title')} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="text-[14px] font-medium">{t('wrap.title')}</h3>
      {section('covered')}
      {section('clicked')}
      {section('shaky')}
      <div className="flex flex-wrap gap-2 pt-1">
        {kept ? (
          <p className="text-[12.5px] text-quiet">{t('wrap.kept')}</p>
        ) : (
          <button type="button" onClick={onKeep} className="console-focusable rounded-full bg-white px-3 py-1 text-[12.5px] text-slate-900">
            {t('wrap.keep')}
          </button>
        )}
        {practiceAdded === null ? (
          <button type="button" onClick={onPractise} className="console-focusable rounded-full border border-white/15 px-3 py-1 text-[12.5px]">
            {t('wrap.practice')}
          </button>
        ) : (
          <p className="text-[12.5px] text-quiet">{t('wrap.practiceDone', { count: practiceAdded })}</p>
        )}
      </div>
    </section>
  );
}
