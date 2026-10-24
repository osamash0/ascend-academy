import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BlockView } from '../iui/Blocks';
import type { LunaCheck } from '../../../data/lunaSession';
import type { useLunaSession } from '../../../data/useLunaSession';
import { MoveMark } from './MoveMark';
import { PlanStrip } from './PlanStrip';
import { RevisitDeck } from './RevisitDeck';
import { WrapCard } from './WrapCard';

type Luna = ReturnType<typeof useLunaSession>;

function Check({ check, onAnswer }: { check: LunaCheck; onAnswer: (correct: boolean) => void }) {
  const { t } = useTranslation('v4Luna');
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-[11.5px] text-quiet">{t('check.label')}</p>
      <p className="text-[13.5px]">{check.question}</p>
      {check.options.map((o, i) => (
        <button
          key={i}
          type="button"
          disabled={picked !== null}
          aria-pressed={picked === i}
          onClick={() => {
            setPicked(i);
            onAnswer(o.correct);
          }}
          className={cn(
            'console-focusable rounded-xl border px-3 py-2 text-left text-[13px]',
            picked === null && 'border-white/15 hover:border-white/40',
            picked !== null && o.correct && 'border-success/60 bg-success/10',
            picked === i && !o.correct && 'border-destructive/50 bg-destructive/10',
          )}
        >
          {o.text}
          {picked === i && <span className="mt-1 block text-[12px] text-quiet">{t(o.correct ? 'check.right' : 'check.wrong')}</span>}
          {picked !== null && (picked === i || o.correct) && <span className="mt-1 block text-[12px] text-quiet">{o.why}</span>}
        </button>
      ))}
    </div>
  );
}

/** The conversation beside the page. The page stays the centre; this column follows it. */
export function SessionColumn({
  luna, lessonId, onOpenPage, onClose, onSpot,
}: {
  luna: Luna;
  lessonId: string;
  onOpenPage: (lectureId: string, page: number, spot?: string) => void;
  onClose: () => void;
  onSpot: (words: string | null) => void;
}) {
  const { t } = useTranslation('v4Luna');
  const { state } = luna;
  const [draft, setDraft] = useState('');
  const [revisit, setRevisit] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  const accepted = state.plan.some((s) => s.status !== 'todo');

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [state.thread.length, state.wrap]);

  const submit = () => {
    const text = draft.trim();
    if (!text || state.busy) return;
    setDraft('');
    if (state.sessionId) void luna.send(text);
    else void luna.start(text);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pt-5">
        <span className="text-[13px] font-medium">{t('column.label')}</span>
        <button type="button" onClick={onClose} className="console-focusable text-[12.5px] text-quiet hover:text-foreground">
          {t('column.close')}
        </button>
      </div>

      <div className="px-5 pt-3">
        <PlanStrip
          plan={state.plan}
          accepted={accepted}
          onAccept={() => void luna.act('accept_plan')}
          onSkip={() => void luna.act('skip_step')}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4" aria-live="polite">
        {!state.sessionId && (
          <div className="flex flex-col gap-3">
            {revisit && <RevisitDeck lectureId={lessonId} onDone={() => setRevisit(false)} />}
            <p className="text-[13.5px] text-quiet">{t('start.intro')}</p>
            <div className="flex flex-wrap gap-2">
              {(['examFriday', 'stuck'] as const).map((k) => (
                <button key={k} type="button" onClick={() => void luna.start(t(`start.${k}`))}
                  className="console-focusable rounded-full border border-white/15 px-3 py-1 text-[12.5px]">
                  {t(`start.${k}`)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {state.thread.map((item) => {
            if (item.kind === 'move') return <MoveMark key={item.id} move={item.move} onGo={onOpenPage} />;
            if (item.kind === 'learner')
              return (
                <p key={item.id} className="self-end rounded-2xl bg-white/[0.08] px-3 py-2 text-[13.5px]">
                  {item.text}
                </p>
              );
            return (
              <div key={item.id} className="text-[13.5px] leading-relaxed">
                <p>{item.md}</p>
                {item.blocks.map((b, i) => (
                  <BlockView key={i} block={b} onSpot={onSpot} onAsk={(q) => void luna.send(q)} />
                ))}
                {item.check && <Check check={item.check} onAnswer={(correct) => void luna.answerCheck(item.check!.question, correct)} />}
              </div>
            );
          })}
          {state.busy && <p className="text-[12.5px] text-quiet">{t('column.thinking')}</p>}
          {state.error && <p className="text-[12.5px] text-quiet">{state.error}</p>}
          {state.offerWrap && !state.wrap && (
            <button type="button" onClick={() => void luna.wrapUp()} className="console-focusable self-start rounded-full bg-white px-3 py-1 text-[12.5px] text-slate-900">
              {t('wrap.offer')}
            </button>
          )}
          {state.wrap && (
            <WrapCard
              wrap={state.wrap}
              kept={state.kept}
              practiceAdded={state.practiceAdded}
              onKeep={() => void luna.keep()}
              onPractise={() => void luna.practise()}
              onOpenPage={(l, p) => onOpenPage(l, p)}
            />
          )}
          <div ref={end} />
        </div>
      </div>

      {!state.wrap && (
        <form
          className="flex items-center gap-2 border-t border-white/10 px-5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('column.placeholder')}
            maxLength={2000}
            className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-quiet"
          />
          <button type="submit" aria-label={t('column.send')} disabled={state.busy}
            className="console-focusable flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-900 disabled:opacity-40">
            <ArrowUp aria-hidden className="h-4 w-4" />
          </button>
        </form>
      )}
    </div>
  );
}
